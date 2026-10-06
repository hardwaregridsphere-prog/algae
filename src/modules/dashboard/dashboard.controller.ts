import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class DashboardController {
  static async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const [totalDevices, onlineDevices, openAlerts, totalUsers] = await Promise.all([
        prisma.device.count(),
        prisma.device.count({ where: { status: 'ONLINE' } }),
        prisma.alert.count({ where: { status: 'OPEN' } }),
        prisma.user.count({ where: { is_active: true } })
      ]);

      res.json({
        success: true,
        data: { totalDevices, onlineDevices, offlineDevices: totalDevices - onlineDevices, openAlerts, totalUsers }
      });
    } catch (error) { next(error); }
  }
}