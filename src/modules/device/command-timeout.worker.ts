import { PrismaClient } from '@prisma/client';
import { logger } from '../../config/logger';

const prisma = new PrismaClient();

export class CommandTimeoutWorker {
  private timer: NodeJS.Timeout | null = null;
  private timeoutMs: number;
  private pollIntervalMs: number;

  /**
   * @param timeoutSeconds How long a command can sit in PENDING/SENT before timing out
   * @param pollIntervalMs How often the worker checks the database
   */
  constructor(timeoutSeconds: number = 10, pollIntervalMs: number = 5000) {
    this.timeoutMs = timeoutSeconds * 1000;
    this.pollIntervalMs = pollIntervalMs;
  }

  start() {
    if (this.timer) return;
    logger.info(`[Worker] Starting Command Timeout Worker (Timeout: ${this.timeoutMs / 1000}s)`);
    
    this.timer = setInterval(async () => {
      try {
        const cutoff = new Date(Date.now() - this.timeoutMs);
        
        // Atomically update any command that is stuck in transit
        const result = await prisma.deviceCommand.updateMany({
          where: {
            status: { in: ['PENDING', 'SENT'] },
            created_at: { lt: cutoff }
          },
          data: {
            status: 'TIMEOUT'
          }
        });

        if (result.count > 0) {
          logger.warn(`[Worker] Swept ${result.count} stale device command(s) to TIMEOUT`);
          
          // Optional future enhancement: You could trigger a database insert here 
          // to generate an Alert record for the dashboard if a timeout occurs.
        }
      } catch (error) {
        logger.error({ error }, '[Worker] Error in Command Timeout Worker');
      }
    }, this.pollIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('[Worker] Command Timeout Worker stopped');
    }
  }
}