import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { metrics } from '../observability/metrics';
import { MqttService } from '../modules/mqtt/mqtt.service';
import { RealtimeHub } from '../realtime/socket';

const prisma = new PrismaClient();

export class SystemWorkers {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  public start() {
    if (this.timer) return;
    logger.info('[Workers] Initializing automated reliability sweepers...');

    this.timer = setInterval(async () => {
      if (this.isProcessing) return; // Prevent tick overlap
      this.isProcessing = true;
      try {
        await Promise.all([
          this.sweepCommandTimeouts(),
          this.sweepOfflineDevices(),
          this.sweepMaintenanceExpirations(),
          this.reconcileAlertStates(),
        ]);
      } catch (err) {
        logger.error({ err }, '[Workers] Execution cycle encountered an unhandled error');
      } finally {
        this.isProcessing = false;
      }
    }, env.WORKER_POLL_INTERVAL_MS);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('[Workers] Background worker loop cleanly halted.');
    }
  }

  // Task 1: Command Timeout Sweeper
  private async sweepCommandTimeouts() {
    const cutoff = new Date(Date.now() - env.COMMAND_TIMEOUT_SECONDS * 1000);

    const timedOutCommands = await prisma.deviceCommand.findMany({
      where: {
        status: { in: ['PENDING', 'SENT'] },
        created_at: { lt: cutoff },
      },
      select: { id: true, request_id: true, device_id: true, Device: { select: { device_uid: true } } },
    });

    if (timedOutCommands.length === 0) return;

    for (const cmd of timedOutCommands) {
      await prisma.deviceCommand.update({
        where: { id: cmd.id },
        data: { status: 'TIMEOUT' },
      });
      metrics.incrementCommandTimedOut();

      RealtimeHub.getInstance().emitToDevice(cmd.Device.device_uid, 'command:state', {
        request_id: cmd.request_id,
        status: 'TIMEOUT',
      });
    }

    logger.warn({ count: timedOutCommands.length }, '[Worker] Swept stuck commands to TIMEOUT');
  }

  // Task 2: Offline Device Heartbeat Sweeper
  private async sweepOfflineDevices() {
    const offlineCutoff = new Date(Date.now() - env.DEVICE_OFFLINE_THRESHOLD_SECONDS * 1000);

    const staleDevices = await prisma.device.findMany({
      where: {
        status: 'ONLINE',
        last_seen: { lt: offlineCutoff },
      },
      select: { id: true, device_uid: true },
    });

    for (const dev of staleDevices) {
      await prisma.$transaction(async (tx) => {
        await tx.device.update({
          where: { id: dev.id },
          data: { status: 'OFFLINE' },
        });

        // Avoid duplicate open offline alerts
        const existingAlert = await tx.alert.findFirst({
          where: { device_id: dev.id, type: 'DEVICE_OFFLINE', status: 'OPEN' },
        });

        if (!existingAlert) {
          await tx.alert.create({
            data: {
              device_id: dev.id,
              type: 'DEVICE_OFFLINE',
              severity: 'CRITICAL',
              message: `Device ${dev.device_uid} missed telemetry heartbeat and is marked OFFLINE.`,
            },
          });
        }
      });

      RealtimeHub.getInstance().emitToDevice(dev.device_uid, 'device:status', {
        device_uid: dev.device_uid,
        status: 'OFFLINE',
      });

      logger.warn({ deviceUid: dev.device_uid }, '[Worker] Transitioned device to OFFLINE');
    }
  }

  // Task 3: Maintenance Expiration Reconciliation
  private async sweepMaintenanceExpirations() {
    const now = new Date();
    const expiredMaintenanceDevices = await prisma.device.findMany({
      where: {
        requested_maintenance_mode: true,
        maintenance_expires_at: { lte: now },
      },
    });

    for (const device of expiredMaintenanceDevices) {
      await prisma.device.update({
        where: { id: device.id },
        data: {
          requested_maintenance_mode: false,
          maintenance_started_at: null,
          maintenance_expires_at: null,
          maintenance_started_by: null,
        },
      });

      // Issue exit command over MQTT
      MqttService.getInstance().publish(
        `algaetree/${device.device_uid}/command`,
        {
          request_id: `MNT-EXP-${Date.now()}`,
          command: 'maintenance_mode',
          state: false,
          timeout_minutes: 0,
        },
        1
      );

      RealtimeHub.getInstance().emitToDevice(device.device_uid, 'maintenance:state', {
        device_uid: device.device_uid,
        requested_maintenance_mode: false,
        expired: true,
      });

      logger.info({ deviceUid: device.device_uid }, '[Worker] Maintenance window expired; revert dispatched');
    }
  }

  // Task 4: Dynamic Alert State Reconciliation
  private async reconcileAlertStates() {
    // 1. Devices that regained online status -> clear orphan offline alerts
    const onlineWithAlerts = await prisma.device.findMany({
      where: { status: 'ONLINE' },
      select: { id: true },
    });

    if (onlineWithAlerts.length > 0) {
      await prisma.alert.updateMany({
        where: {
          device_id: { in: onlineWithAlerts.map((d) => d.id) },
          type: 'DEVICE_OFFLINE',
          status: 'OPEN',
        },
        data: { status: 'RESOLVED', resolved_at: new Date() },
      });
    }
  }
}