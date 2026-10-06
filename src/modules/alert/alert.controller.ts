import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class AlertController {
  static async getAlerts(req: Request, res: Response, next: NextFunction) {
    try {
      const status = req.query.status as any; // OPEN, ACKNOWLEDGED, RESOLVED
      const alerts = await prisma.alert.findMany({
        where: status ? { status } : undefined,
        include: { Device: { select: { name: true, device_uid: true } } },
        orderBy: { created_at: 'desc' },
      });
      res.json({ success: true, data: alerts });
    } catch (error) { next(error); }
  }

  static async updateAlertStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = req.body;
      const updateData: any = { status };
      
      if (status === 'ACKNOWLEDGED') updateData.acknowledged_at = new Date();
      if (status === 'RESOLVED') updateData.resolved_at = new Date();

      const alert = await prisma.alert.update({
        where: { id: Number(req.params.id) },
        data: updateData,
      });
      res.json({ success: true, data: alert });
    } catch (error) { next(error); }
  }
}