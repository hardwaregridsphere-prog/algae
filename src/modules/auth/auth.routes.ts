import { Router } from 'express';
import { AuthController } from './auth.controller';
import { authenticateJWT } from '../../middlewares/auth.middleware';

const router = Router();

// Public routes
router.post('/login', AuthController.login);
router.post('/refresh', AuthController.refresh);

// Protected routes (requires valid Access JWT)
router.post('/logout', authenticateJWT, AuthController.logout);
router.get('/me', authenticateJWT, AuthController.getMe);

export default router;