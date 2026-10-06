import { PrismaClient } from '@prisma/client';
import { MqttService } from '../mqtt/mqtt.service';
import { AppError } from '../../utils/errors';
import { randomUUID } from 'crypto';
import { logger } from '../../config/logger';

const prisma = new PrismaClient();

export class FirmwareService {
  static async triggerOtaUpdate(deviceId: number, firmwareId: number, userId: number) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new AppError(404, 'DEVICE_NOT_FOUND', 'Target device not found');

    if (device.status === 'DECOMMISSIONED') {
      throw new AppError(403, 'DEVICE_DECOMMISSIONED', 'Cannot deploy firmware to decommissioned device');
    }
    if (device.status !== 'ONLINE') {
      throw new AppError(400, 'DEVICE_OFFLINE', 'Device must be ONLINE to initiate OTA update');
    }

    const firmware = await prisma.firmware.findUnique({ where: { id: firmwareId } });
    if (!firmware) throw new AppError(404, 'FIRMWARE_NOT_FOUND', 'Specified firmware release does not exist');
    if (!firmware.is_published) {
      throw new AppError(400, 'FIRMWARE_UNPUBLISHED', 'Firmware must be published before deployment');
    }

    // Hardware Compatibility Verification
    if (firmware.target_model !== device.hardware_model) {
      throw new AppError(
        400,
        'INCOMPATIBLE_HARDWARE_MODEL',
        `Incompatible model. Firmware requires ${firmware.target_model}, device is ${device.hardware_model}`
      );
    }

    // Check for an active, unresolved OTA update to prevent concurrent flashing
    const existingActiveOta = await prisma.otaUpdate.findFirst({
      where: {
        device_id: deviceId,
        status: { in: ['PENDING', 'DOWNLOADING', 'INSTALLING'] },
      },
    });
    if (existingActiveOta) {
      throw new AppError(409, 'OTA_ALREADY_IN_PROGRESS', 'An OTA update is currently executing on this device');
    }

    const requestId = `OTA-${randomUUID()}`;

    const otaRecord = await prisma.$transaction(async (tx) => {
      const record = await tx.otaUpdate.create({
        data: {
          request_id: requestId,
          device_id: device.id,
          firmware_id: firmware.id,
          target_version: firmware.version,
          status: 'PENDING',
          progress: 0,
        },
      });

      await tx.auditLog.create({
        data: {
          user_id: userId,
          device_id: device.id,
          action: 'FIRMWARE_OTA_INITIATED',
          details: {
            request_id: requestId,
            firmware_version: firmware.version,
            sha256: firmware.checksum_sha256,
          },
        },
      });

      return record;
    });

    const payload = {
      request_id: requestId,
      command: 'ota_update',
      version: firmware.version,
      url: firmware.download_url,
      checksum_sha256: firmware.checksum_sha256,
    };

    const published = MqttService.getInstance().publish(`algaetree/${device.device_uid}/command`, payload, 1);

    if (!published) {
      await prisma.otaUpdate.update({
        where: { id: otaRecord.id },
        data: { status: 'FAILED', error_message: 'Transport publish failed: MQTT broker offline' },
      });
      throw new AppError(503, 'MQTT_UNAVAILABLE', 'Broker unreachable: OTA command not dispatched');
    }

    logger.info({ deviceUid: device.device_uid, requestId, targetVersion: firmware.version }, 'OTA update dispatched');
    return otaRecord;
  }
}