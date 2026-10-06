import http from 'http';
import app from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { MqttService } from './modules/mqtt/mqtt.service';
import { RealtimeHub } from './realtime/socket';
import { SystemWorkers } from './workers/system.workers';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const server = http.createServer(app);

// Initialize Realtime Websockets
RealtimeHub.getInstance().initialize(server);

// Initialize Edge MQTT Client & Ingestion Listeners
MqttService.getInstance();

// Initialize Background Workers
const workers = new SystemWorkers();
workers.start();

const PORT = env.PORT;
server.listen(PORT, () => {
  logger.info(`[Bootstrap] Algae-Tree IoT Engine active on port ${PORT} [Mode: ${env.NODE_ENV}]`);
});

// Graceful Shutdown Coordinator
let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.warn(`[Shutdown] Received ${signal}. Executing controlled shutdown sequence...`);

  // 1. Stop background workers
  workers.stop();

  // 2. Cease accepting new incoming HTTP connections
  server.close(async () => {
    logger.info('[Shutdown] HTTP server closed.');

    // 3. Close Realtime Socket Channels
    await RealtimeHub.getInstance().close();

    // 4. Disconnect MQTT Broker Connection
    try {
      await MqttService.getInstance().disconnect();
      logger.info('[Shutdown] MQTT connection terminated.');
    } catch (err) {
      logger.error({ err }, '[Shutdown] Error during MQTT disconnection');
    }

    // 5. Release Prisma Client Pool
    try {
      await prisma.$disconnect();
      logger.info('[Shutdown] PostgreSQL connection pool safely drained.');
    } catch (err) {
      logger.error({ err }, '[Shutdown] Error disconnecting PostgreSQL');
    }

    logger.info('[Shutdown] All subsystem handles released cleanly. Exiting.');
    process.exit(0);
  });

  // Failsafe timeout to prevent hanging zombie processes
  setTimeout(() => {
    logger.error('[Shutdown] Forceful process exit triggered after timeout expiration.');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));