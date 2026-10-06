import { PrismaClient } from '@prisma/client';
import { logger } from '../../config/logger';
import { metrics } from '../../observability/metrics';
import { RealtimeHub } from '../../realtime/socket';

const prisma = new PrismaClient();

export class MqttHandler {
  public static async handleMessage(topic: string, rawPayload: Buffer) {
    metrics.incrementMqttReceived();
    const parts = topic.split('/');
    if (parts.length < 3 || parts[0] !== 'algaetree') {
      logger.warn({ topic }, 'MQTT dropped: malformed topic structure');
      return;
    }

    const deviceUid = parts[1];
    const subTopic = parts.slice(2).join('/');

    let payload: any;
    try {
      payload = JSON.parse(rawPayload.toString('utf-8'));
    } catch (err) {
      logger.error({ topic, err }, 'MQTT parse failure: Invalid JSON payload');
      return;
    }

    // Defense-in-depth device UID payload spoofing check
    if (payload.device_uid && payload.device_uid !== deviceUid) {
      logger.warn({ topic, payloadUid: payload.device_uid, deviceUid }, 'MQTT Security Alert: device_uid mismatch');
      return;
    }

    const device = await prisma.device.findUnique({ where: { device_uid: deviceUid } });
    if (!device) {
      logger.warn({ deviceUid }, 'MQTT dropped: Device not found in registry');
      return;
    }

    if (device.status === 'DECOMMISSIONED') {
      logger.warn({ deviceUid }, 'MQTT rejected: Decommissioned device activity');
      return;
    }

    // Route based on sub-topic
    switch (subTopic) {
      case 'telemetry':
        await this.processTelemetry(device, payload);
        break;
      case 'status':
        await this.processStatus(device, payload);
        break;
      case 'events':
        await this.processEvents(device, payload);
        break;
      case 'time/ack':
        await this.processRtcAck(device, payload);
        break;
      case 'schedule/ack':
        await this.processScheduleAck(device, payload);
        break;
      case 'ota/progress':
        await this.processOtaProgress(device, payload);
        break;
      default:
        logger.debug({ topic, subTopic }, 'MQTT message arrived on unhandled subtopic');
    }
  }

  private static async processTelemetry(device: any, payload: any) {
    metrics.incrementTelemetry();
    const messageId = payload.message_id || null;
    const deviceTime = payload.timestamp ? new Date(payload.timestamp * 1000) : new Date();

    try {
      await prisma.$transaction([
        prisma.telemetry.create({
          data: {
            device_id: device.id,
            device_timestamp: deviceTime,
            message_id: messageId,
            payload: payload.data || payload,
          },
        }),
        prisma.device.update({
          where: { id: device.id },
          data: { last_seen: new Date(), status: 'ONLINE' },
        }),
      ]);

      RealtimeHub.getInstance().emitToDevice(device.device_uid, 'telemetry:new', {
        device_uid: device.device_uid,
        timestamp: deviceTime,
        data: payload.data || payload,
      });
    } catch (err: any) {
      // Prisma P2002: unique constraint hit on [device_id, message_id]
      if (err.code === 'P2002') {
        logger.info({ deviceUid: device.device_uid, messageId }, 'MQTT duplicate telemetry dropped via idempotency key');
        return;
      }
      logger.error({ err, deviceUid: device.device_uid }, 'Error storing telemetry payload');
    }
  }

  private static async processStatus(device: any, payload: any) {
    const isOnline = payload.status === 'online';
    const newStatus = isOnline ? 'ONLINE' : 'OFFLINE';

    await prisma.$transaction(async (tx) => {
      await tx.device.update({
        where: { id: device.id },
        data: {
          status: newStatus,
          last_seen: new Date(),
          rtc_valid: payload.rtc_valid !== undefined ? Boolean(payload.rtc_valid) : device.rtc_valid,
          firmware_version: payload.firmware_version || device.firmware_version,
        },
      });

      if (isOnline) {
        // Resolve outstanding offline alert if one exists
        await tx.alert.updateMany({
          where: { device_id: device.id, type: 'DEVICE_OFFLINE', status: 'OPEN' },
          data: { status: 'RESOLVED', resolved_at: new Date() },
        });
      }
    });

    RealtimeHub.getInstance().emitToDevice(device.device_uid, 'device:status', {
      device_uid: device.device_uid,
      status: newStatus,
      rtc_valid: payload.rtc_valid,
    });
  }

  private static async processEvents(device: any, payload: any) {
    const { event, request_id, success, relay, state, reason } = payload;

    if (event === 'command_ack' && request_id) {
      await prisma.deviceCommand.updateMany({
        where: { request_id },
        data: { status: 'ACKNOWLEDGED', acknowledged_at: new Date() },
      });
      RealtimeHub.getInstance().emitToDevice(device.device_uid, 'command:state', { request_id, status: 'ACKNOWLEDGED' });
      return;
    }

    if (event === 'relay_executed' && request_id) {
      await prisma.$transaction([
        prisma.deviceCommand.updateMany({
          where: { request_id },
          data: {
            status: success ? 'EXECUTED' : 'FAILED',
            executed_at: success ? new Date() : null,
            failed_at: !success ? new Date() : null,
            failure_reason: reason || null,
          },
        }),
        ...(success && relay !== undefined
          ? [
              prisma.relayState.upsert({
                where: { device_id_relay_number: { device_id: device.id, relay_number: relay } },
                update: { state: Boolean(state), last_updated: new Date() },
                create: { device_id: device.id, relay_number: relay, state: Boolean(state) },
              }),
            ]
          : []),
      ]);

      if (success) {
        metrics.incrementCommandExecuted();
      } else {
        metrics.incrementCommandFailed();
      }

      RealtimeHub.getInstance().emitToDevice(device.device_uid, 'command:state', {
        request_id,
        status: success ? 'EXECUTED' : 'FAILED',
        relay,
        state,
      });
      return;
    }

    if (event === 'maintenance_applied') {
      const confirmedState = Boolean(payload.actual_maintenance_mode);
      await prisma.device.update({
        where: { id: device.id },
        data: { actual_maintenance_mode: confirmedState },
      });

      RealtimeHub.getInstance().emitToDevice(device.device_uid, 'maintenance:state', {
        device_uid: device.device_uid,
        actual_maintenance_mode: confirmedState,
      });
    }
  }

  private static async processRtcAck(device: any, payload: any) {
    const rtcValid = Boolean(payload.success);
    await prisma.$transaction(async (tx) => {
      await tx.device.update({
        where: { id: device.id },
        data: { rtc_valid: rtcValid },
      });

      if (rtcValid) {
        await tx.alert.updateMany({
          where: { device_id: device.id, type: 'RTC_INVALID', status: 'OPEN' },
          data: { status: 'RESOLVED', resolved_at: new Date() },
        });
      }
    });

    RealtimeHub.getInstance().emitToDevice(device.device_uid, 'rtc:sync_result', { success: rtcValid });
  }

  private static async processScheduleAck(device: any, payload: any) {
    const ackedRev = Number(payload.schedule_revision);
    if (!ackedRev) return;

    // Strict version ordering: prevent old ACKs from overriding newer schedule revisions
    const currentDevice = await prisma.device.findUnique({ where: { id: device.id } });
    if (!currentDevice || ackedRev < currentDevice.acknowledged_schedule_rev) {
      logger.warn({ deviceUid: device.device_uid, ackedRev }, 'Stale schedule ACK rejected');
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.device.update({
        where: { id: device.id },
        data: { acknowledged_schedule_rev: ackedRev },
      });

      if (ackedRev === currentDevice.schedule_revision) {
        await tx.alert.updateMany({
          where: { device_id: device.id, type: 'SCHEDULE_OUT_OF_SYNC', status: 'OPEN' },
          data: { status: 'RESOLVED', resolved_at: new Date() },
        });
      }
    });

    RealtimeHub.getInstance().emitToDevice(device.device_uid, 'schedule:acknowledged', { revision: ackedRev });
  }

  private static async processOtaProgress(device: any, payload: any) {
    const { request_id, status, progress, error_message, firmware_version } = payload;
    if (!request_id) return;

    const validStatus = ['DOWNLOADING', 'INSTALLING', 'SUCCESS', 'FAILED'].includes(status) ? status : 'FAILED';

    await prisma.$transaction(async (tx) => {
      await tx.otaUpdate.updateMany({
        where: { request_id },
        data: {
          status: validStatus,
          progress: progress !== undefined ? Number(progress) : 0,
          error_message: error_message || null,
        },
      });

      if (validStatus === 'SUCCESS') {
        await tx.device.update({
          where: { id: device.id },
          data: {
            firmware_version: firmware_version || device.firmware_version,
          },
        });
      } else if (validStatus === 'FAILED') {
        metrics.incrementOtaFailures();
      }
    });

    RealtimeHub.getInstance().emitToDevice(device.device_uid, 'ota:status', {
      request_id,
      status: validStatus,
      progress,
    });
  }
}