import { Request, Response, NextFunction } from 'express';
import { DeviceService } from './device.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class DeviceController {
  
  static async getDevices(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await DeviceService.getDevices(req.query);
      res.json({ success: true, ...result });
    } catch (error) { next(error); }
  }

  static async getDeviceById(req: Request, res: Response, next: NextFunction) {
    try {
      const device = await DeviceService.getDeviceById(Number(req.params.id));
      res.json({ success: true, data: device });
    } catch (error) { next(error); }
  }

  static async provisionDevice(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, location, timezone } = req.body;
      const userId = (req as any).user.sub;
      
      if (!name) {
        return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'Device name is required.' } });
      }

      const provisionedData = await DeviceService.provisionDevice(name, location, timezone || 'Asia/Kolkata', userId);
      
      res.status(201).json({ 
        success: true, 
        message: 'Device successfully provisioned. STORE THESE CREDENTIALS SECURELY.',
        data: provisionedData 
      });
    } catch (error) { next(error); }
  }

  static async updateDevice(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.sub;
      const device = await DeviceService.updateDevice(Number(req.params.id), req.body, userId);
      res.json({ success: true, data: device });
    } catch (error) { next(error); }
  }

  static async getDeviceStatus(req: Request, res: Response, next: NextFunction) {
    try {
      // Isolates just the operational state for quick dashboard polling
      const device = await prisma.device.findUnique({
        where: { id: Number(req.params.id) },
        select: { status: true, last_seen: true, actual_maintenance_mode: true, rtc_valid: true, firmware_version: true }
      });
      res.json({ success: true, data: device });
    } catch (error) { next(error); }
  }

  static async getDeviceRelays(req: Request, res: Response, next: NextFunction) {
    try {
      const relays = await prisma.relayState.findMany({
        where: { device_id: Number(req.params.id) }
      });
      res.json({ success: true, data: relays });
    } catch (error) { next(error); }
  }

  static async toggleMaintenance(req: Request, res: Response, next: NextFunction) {
    try {
      const { enable, durationMinutes } = req.body;
      const userId = (req as any).user.sub; // Extracting user from JWT
      const updated = await DeviceService.toggleMaintenance(Number(req.params.id), enable, userId, durationMinutes);
      res.json({ success: true, data: updated });
    } catch (error) { next(error); }
  }

  static async controlRelay(req: Request, res: Response, next: NextFunction) {
    try {
      const { state } = req.body;
      const userId = (req as any).user.sub;
      const reqId = await DeviceService.sendRelayCommand(Number(req.params.id), Number(req.params.relay), state, userId);
      res.json({ success: true, data: { request_id: reqId }});
    } catch (error) { next(error); }
  }

  static async rotateCredentials(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.sub;
      const credentials = await DeviceService.rotateCredentials(Number(req.params.id), userId);
      res.json({ success: true, message: 'Credentials rotated successfully. STORE THIS PASSWORD.', data: credentials });
    } catch (error) { next(error); }
  }

  static async decommissionDevice(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.sub;
      const result = await DeviceService.decommissionDevice(Number(req.params.id), userId);
      res.json(result);
    } catch (error) { next(error); }
  }
}