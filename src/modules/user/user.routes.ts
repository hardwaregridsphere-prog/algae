import { Router } from 'express';
import { UserController } from './user.controller';
import { authenticateJWT } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/rbac.middleware';


const router = Router();
router.use(authenticateJWT);
router.get('/me', UserController.getMe);
router.get('/', requireRole(['SUPER_ADMIN', 'ADMIN']), UserController.getUsers);
router.post('/', requireRole(['SUPER_ADMIN']), UserController.createUser);

export default router;