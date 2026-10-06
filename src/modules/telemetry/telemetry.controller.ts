import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class TelemetryController {
  static async getDeviceTelemetry(req: Request, res: Response, next: NextFunction) {
    try {
      const deviceId = Number(req.params.deviceId);
      const limit = Number(req.query.limit) || 100;
      const offset = Number(req.query.offset) || 0;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      const telemetry = await prisma.telemetry.findMany({
        where: {
          device_id: deviceId,
          device_timestamp: {
            ...(startDate && { gte: startDate }),
            ...(endDate && { lte: endDate }),
          },
        },
        orderBy: { device_timestamp: 'desc' },
        take: limit,
        skip: offset,
      });

      const total = await prisma.telemetry.count({ where: { device_id: deviceId } });

      res.json({ success: true, data: { total, limit, offset, telemetry } });
    } catch (error) {
      next(error);
    }
  }
}