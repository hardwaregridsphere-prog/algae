import { PrismaClient } from '@prisma/client';
import { MqttService } from '../mqtt/mqtt.service';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

export class ScheduleService {
  
  static async updateDeviceSchedules(deviceId: number, relaySchedules: any[], userId: number) {
    const device = await prisma.$transaction(async (tx) => {
      // Wipe old schedules to support atomic replacement
      await tx.schedule.deleteMany({ where: { device_id: deviceId } });
      
      const newSchedules = relaySchedules.flatMap(r => r.schedules.map((s: any) => ({
        device_id: deviceId,
        relay_number: r.relay,
        enabled: s.enabled ?? true,
        days_of_week: s.days,
        start_time: s.start_time,
        end_time: s.end_time,
        priority: s.priority ?? 0
      })));

      await tx.schedule.createMany({ data: newSchedules });

      for (const r of relaySchedules) {
        await tx.relayConfig.update({
          where: { device_id_relay_number: { device_id: deviceId, relay_number: r.relay } },
          data: { enabled: r.enabled }
        });
      }

      const updatedDevice = await tx.device.update({
        where: { id: deviceId },
        data: { current_schedule_version: { increment: 1 } },
        include: { RelayConfigs: true, Schedules: true }
      });

      // Maintain immutable audit trail of what was actually sent
      const snapshot = this.buildSchedulePayload(updatedDevice);
      await tx.scheduleRevision.create({
        data: {
          device_id: deviceId,
          version: updatedDevice.current_schedule_version,
          schedule_snapshot: snapshot,
          created_by: userId
        }
      });

      return updatedDevice;
    });

    await this.syncScheduleToDevice(deviceId, device);
    return device;
  }

  static async syncScheduleToDevice(deviceId: number, deviceRecord?: any) {
    const device = deviceRecord || await prisma.device.findUnique({
      where: { id: deviceId },
      include: { RelayConfigs: true, Schedules: true }
    });
    if (!device) return;

    const payload = this.buildSchedulePayload(device);
    MqttService.getInstance().publish(`algaetree/${device.device_uid}/config/schedule`, payload, 1, true);
  }

  private static buildSchedulePayload(device: any) {
    const relays = device.RelayConfigs.map((rc: any) => {
      const schedules = device.Schedules.filter((s: any) => s.relay_number === rc.relay_number);
      return {
        relay: rc.relay_number,
        enabled: rc.enabled,
        schedules: schedules.map((s: any) => ({
          days: s.days_of_week,
          start: s.start_time,
          end: s.end_time
        }))
      };
    });

    return {
      request_id: `SCH-${randomUUID()}`,
      version: device.current_schedule_version,
      timezone: device.timezone,
      updated_at: Math.floor(Date.now() / 1000),
      relays
    };
  }
}