import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { logger } from '../../config/logger';
import { env } from '../../config/env';

const prisma = new PrismaClient();

export class MqttController {
  static async emqxWebhookAuth(req: Request, res: Response, next: NextFunction) {
    try {
      const { username, password, clientid } = req.body;

      // 1. Superuser Bypass: Allow the Node.js backend itself to connect
      if (username === env.MQTT_USERNAME && password === env.MQTT_PASSWORD) {
        return res.status(200).json({ result: 'allow', is_superuser: true });
      }

      if (!username || !password) {
        return res.status(401).json({ result: 'deny' });
      }

      // 2. Fetch Device Credentials from PostgreSQL
      const credential = await prisma.deviceCredential.findUnique({
        where: { username },
        include: { Device: true }
      });

      // 3. Security Checks (Revoked, Missing, or Decommissioned)
      if (!credential || credential.revoked_at || credential.Device.status === 'DECOMMISSIONED') {
        logger.warn({ username, clientid }, 'MQTT Auth Denied: Invalid, revoked, or decommissioned device');
        return res.status(401).json({ result: 'deny' });
      }

      // 4. Verify Argon2 Hash
      const valid = await argon2.verify(credential.password_hash, password);
      if (!valid) {
        logger.warn({ username, clientid }, 'MQTT Auth Denied: Password mismatch');
        return res.status(401).json({ result: 'deny' });
      }

      // 5. Async Update: Record the successful connection time
      prisma.deviceCredential.update({
        where: { id: credential.id },
        data: { last_used_at: new Date() }
      }).catch(err => logger.error({ err }, 'Failed to update last_used_at for device credential'));

      // 6. Approve the Connection
      return res.status(200).json({ result: 'allow', is_superuser: false });

    } catch (error) {
      logger.error({ error }, 'EMQX Auth Webhook Error');
      return res.status(500).json({ result: 'deny' }); // Fail secure on server error
    }
  }
}