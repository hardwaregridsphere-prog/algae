import { Request, Response, NextFunction } from 'express';
import { ScheduleService } from './schedule.service';

export class ScheduleController {
  static async updateSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      const { relays } = req.body; // Expects array of relay schedules
      const userId = (req as any).user.sub;
      
      const updatedDevice = await ScheduleService.updateDeviceSchedules(Number(req.params.id), relays, userId);
      res.json({ success: true, data: updatedDevice });
    } catch (error) {
      next(error);
    }
  }
}