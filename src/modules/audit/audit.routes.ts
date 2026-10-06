import { Router } from 'express';
import { AuditController } from './audit.controller';
import { authenticateJWT } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/rbac.middleware';


const router = Router();
router.use(authenticateJWT);
router.get('/', requireRole(['SUPER_ADMIN', 'ADMIN']), AuditController.getLogs);
router.get('/commands/:deviceId', AuditController.getCommandHistory);

export default router;