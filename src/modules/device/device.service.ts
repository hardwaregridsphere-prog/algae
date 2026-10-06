import { PrismaClient } from '@prisma/client';
import { MqttService } from '../mqtt/mqtt.service';
import { randomUUID } from 'crypto';
import { AppError } from '../../utils/errors';
import * as argon2 from 'argon2';
import crypto from 'crypto';

const prisma = new PrismaClient();

export class DeviceService {
  
  static async sendRelayCommand(deviceId: number, relay: number, state: boolean, userId: number) {
    // Include RelayConfigs in the query so we can validate hardware mapping
    const device = await prisma.device.findUnique({ 
      where: { id: deviceId },
      include: { RelayConfigs: true }
    });
    
    if (!device) throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found');

    // --- Validation Layer 1: Device Lifecycle & Network State ---
    if (device.status === 'DECOMMISSIONED') {
      throw new AppError(403, 'DEVICE_DECOMMISSIONED', 'Cannot send commands to a decommissioned device.');
    }
    if (device.status !== 'ONLINE') {
      throw new AppError(400, 'DEVICE_OFFLINE', 'Device is currently offline. Relay command aborted.');
    }

    // --- Validation Layer 2: Hardware Mapping & Configuration ---
    const relayConfig = device.RelayConfigs.find(r => r.relay_number === relay);
    if (!relayConfig) {
      throw new AppError(404, 'RELAY_NOT_FOUND', `Relay ${relay} does not exist on this device.`);
    }
    if (!relayConfig.enabled) {
      throw new AppError(403, 'RELAY_DISABLED', `Relay ${relay} is administratively disabled.`);
    }

    // --- Validation Layer 3: Strict Offline-First Safety bounds ---
    const isExpired = device.maintenance_expires_at && device.maintenance_expires_at < new Date();
    if (!device.actual_maintenance_mode || isExpired) {
      throw new AppError(403, 'NOT_IN_MAINTENANCE', 'Device is not in confirmed maintenance mode. Manual control rejected.');
    }

    const requestId = `REQ-${randomUUID()}`;
    const payload = { request_id: requestId, command: 'relay', relay, state };

    // 1. Create as PENDING
    const commandRecord = await prisma.deviceCommand.create({
      data: {
        request_id: requestId,
        device_id: deviceId,
        command: 'relay',
        payload: payload,
        created_by: userId,
        status: 'PENDING'
      }
    });

    // 2. Attempt the actual transport
    const published = MqttService.getInstance().publish(`algaetree/${device.device_uid}/command`, payload, 1);

    // 3. Reconcile database state with transport reality
    if (published) {
      await prisma.deviceCommand.update({
        where: { id: commandRecord.id },
        data: { status: 'SENT', sent_at: new Date() }
      });
    } else {
      await prisma.deviceCommand.update({
        where: { id: commandRecord.id },
        data: { status: 'FAILED' }
      });
      throw new AppError(503, 'MQTT_PUBLISH_FAILED', 'Failed to dispatch command. MQTT broker connection unavailable.');
    }

    return requestId;
  }

  static async toggleMaintenance(deviceId: number, enable: boolean, userId: number, durationMinutes: number = 60) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found');

    const now = new Date();
    const expiresAt = enable ? new Date(now.getTime() + durationMinutes * 60000) : null;

    // We only update the REQUESTED state. The ACTUAL state updates via the MQTT ACK from the ESP32.
    const updated = await prisma.device.update({
      where: { id: deviceId },
      data: { 
        requested_maintenance_mode: enable,
        maintenance_started_at: enable ? now : null,
        maintenance_expires_at: expiresAt,
        maintenance_started_by: enable ? userId : null
      }
    });

    MqttService.getInstance().publish(`algaetree/${device.device_uid}/command`, {
      request_id: `MNT-${randomUUID()}`,
      command: 'maintenance_mode',
      state: enable,
      timeout_minutes: enable ? durationMinutes : 0
    }, 1);

    return updated;
  }

  static async provisionDevice(name: string, location: string | null, timezone: string, userId: number) {
    // Generate a unique 8-character hex UID (e.g., ALGAE-A1B2C3D4)
    const deviceUid = `ALGAE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    
    // Generate a secure 12-byte plaintext password for the ESP32
    const plainTextPassword = crypto.randomBytes(12).toString('base64url');
    
    // Hash it for EMQX to query securely
    const passwordHash = await argon2.hash(plainTextPassword);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create the base device
      const device = await tx.device.create({
        data: {
          device_uid: deviceUid,
          name,
          location,
          timezone,
          status: 'PROVISIONING',
        }
      });

      // 2. Provision EMQX MQTT Credentials
      await tx.deviceCredential.create({
        data: {
          device_id: device.id,
          username: deviceUid, // Username strictly matches UID for ACL %u enforcement
          password_hash: passwordHash,
        }
      });

      // 3. Provision Default Relays and Blank Schedules (Assuming 5 relays per ESP32)
      const defaultRelays = Array.from({ length: 5 }, (_, i) => ({
        device_id: device.id,
        relay_number: i + 1,
        name: `Relay ${i + 1}`,
        enabled: true,
        active_low: false,
        failsafe_state: false,
      }));
      await tx.relayConfig.createMany({ data: defaultRelays });

      const defaultSchedules = Array.from({ length: 5 }, (_, i) => ({
        device_id: device.id,
        relay_number: i + 1,
        enabled: false, // Disabled by default until admin configures them
        days_of_week: [1, 2, 3, 4, 5, 6, 7],
        start_time: "00:00",
        end_time: "00:00",
        priority: 0
      }));
      await tx.schedule.createMany({ data: defaultSchedules });

      // 4. Log the provisioning action
      await tx.auditLog.create({
        data: {
          user_id: userId,
          device_id: device.id,
          action: 'DEVICE_PROVISIONED',
          details: { device_uid: deviceUid }
        }
      });

      return device;
    });

    // Return the plaintext credentials EXACTLY ONCE. They cannot be retrieved again.
    return {
      device: result,
      mqtt_credentials: {
        username: deviceUid,
        password: plainTextPassword,
        client_id: `${deviceUid}-backend-provisioned`
      }
    };
  }

  static async getDevices(filters: { page?: number; limit?: number; search?: string; status?: any; sortBy?: string; sortOrder?: string }) {
    const page = Number(filters.page) || 1;
    const limit = Number(filters.limit) || 20;
    const skip = (page - 1) * limit;
    const { search, status, sortBy = 'created_at', sortOrder = 'desc' } = filters;

    const where: any = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { device_uid: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [total, devices] = await Promise.all([
      prisma.device.count({ where }),
      prisma.device.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: { RelayConfigs: true }
      })
    ]);

    return { total, page, limit, totalPages: Math.ceil(total / limit), data: devices };
  }

  static async getDeviceById(id: number) {
    const device = await prisma.device.findUnique({
      where: { id },
      include: { RelayConfigs: true, Schedules: true }
    });
    if (!device) throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found');
    return device;
  }

  static async updateDevice(id: number, data: { name?: string; location?: string; timezone?: string }, userId: number) {
    const device = await prisma.device.update({
      where: { id },
      data: {
        name: data.name,
        location: data.location,
        timezone: data.timezone
      }
    });

    await prisma.auditLog.create({
      data: { user_id: userId, device_id: id, action: 'DEVICE_UPDATED', details: data }
    });

    // If timezone changed, publish a time sync event so the ESP32 updates its RTC offset
    if (data.timezone) {
      MqttService.getInstance().publish(`algaetree/${device.device_uid}/time/sync`, {
        server_timestamp: Math.floor(Date.now() / 1000),
        timezone: data.timezone,
        time_sync_version: 1
      });
    }

    return device;
  }

  static async rotateCredentials(id: number, userId: number) {
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device) throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found');

    const newPlainTextPassword = crypto.randomBytes(12).toString('base64url');
    const newPasswordHash = await argon2.hash(newPlainTextPassword);

    await prisma.$transaction([
      prisma.deviceCredential.update({
        where: { device_id: id },
        data: { password_hash: newPasswordHash, revoked_at: null }
      }),
      prisma.auditLog.create({
        data: { user_id: userId, device_id: id, action: 'CREDENTIALS_ROTATED' }
      })
    ]);

    // Force disconnect the device so it must reconnect with the new password
    MqttService.getInstance().publish(`algaetree/${device.device_uid}/command`, { command: 'reboot' }, 1);

    return {
      username: device.device_uid,
      password: newPlainTextPassword
    };
  }

  static async decommissionDevice(id: number, userId: number) {
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device) throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found');

    await prisma.$transaction([
      // 1. Mark device as decommissioned
      prisma.device.update({
        where: { id },
        data: { status: 'DECOMMISSIONED' }
      }),
      // 2. Instantly revoke MQTT access (EMQX webhook will now deny it)
      prisma.deviceCredential.update({
        where: { device_id: id },
        data: { revoked_at: new Date() }
      }),
      // 3. Disable all schedules to prevent autonomous operation if it stays powered on offline
      prisma.schedule.updateMany({
        where: { device_id: id },
        data: { enabled: false }
      }),
      prisma.auditLog.create({
        data: { user_id: userId, device_id: id, action: 'DEVICE_DECOMMISSIONED' }
      })
    ]);

    // Command the ESP32 to factory reset / halt
    MqttService.getInstance().publish(`algaetree/${device.device_uid}/command`, { command: 'factory_reset' }, 1);

    return { success: true, message: 'Device decommissioned and credentials revoked.' };
  }
}