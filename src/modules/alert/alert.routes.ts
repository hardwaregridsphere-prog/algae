import { Router } from 'express';
import { AlertController } from './alert.controller';
import { authenticateJWT } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/rbac.middleware';

const router = Router();
router.use(authenticateJWT);
router.get('/', AlertController.getAlerts);
router.patch('/:id/status', requireRole(['SUPER_ADMIN', 'ADMIN', 'OPERATOR']), AlertController.updateAlertStatus);

export default router;