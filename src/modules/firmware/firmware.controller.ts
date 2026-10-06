import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { MqttService } from '../mqtt/mqtt.service';
import { AppError } from '../../utils/errors';

const prisma = new PrismaClient();

export class FirmwareController {
  static async triggerOTA(req: Request, res: Response, next: NextFunction) {
    try {
      const { version, firmware_url, md5_checksum } = req.body;
      const device = await prisma.device.findUnique({ where: { id: Number(req.params.deviceId) } });
      
      if (!device) throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found');

      const payload = { version, url: firmware_url, md5: md5_checksum };
      MqttService.getInstance().publish(`algaetree/${device.device_uid}/ota`, payload, 1);

      res.json({ success: true, message: `OTA triggered for ${device.device_uid}`, data: payload });
    } catch (error) { next(error); }
  }
}