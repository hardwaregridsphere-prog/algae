import { Router } from 'express';
import { FirmwareController } from './firmware.controller';
import { authenticateJWT } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/rbac.middleware';


const router = Router();
router.post('/:deviceId/trigger', authenticateJWT, requireRole(['SUPER_ADMIN', 'ADMIN']), FirmwareController.triggerOTA);

export default router;