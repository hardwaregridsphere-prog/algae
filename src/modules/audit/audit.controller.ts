import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class AuditController {
  static async getLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const logs = await prisma.auditLog.findMany({
        take: 100,
        orderBy: { created_at: 'desc' },
        include: { User: { select: { email: true } } }
      });
      res.json({ success: true, data: logs });
    } catch (error) { next(error); }
  }

  static async getCommandHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const commands = await prisma.deviceCommand.findMany({
        where: { device_id: Number(req.params.deviceId) },
        orderBy: { created_at: 'desc' },
        take: 50
      });
      res.json({ success: true, data: commands });
    } catch (error) { next(error); }
  }
}