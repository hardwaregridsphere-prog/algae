import { Router } from 'express';
import { TelemetryController } from './telemetry.controller';
import { authenticateJWT } from '../../middlewares/auth.middleware';

const router = Router();
router.use(authenticateJWT);
router.get('/device/:deviceId', TelemetryController.getDeviceTelemetry);

export default router;