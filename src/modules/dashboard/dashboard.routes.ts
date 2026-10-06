import { Router } from 'express';
import { DashboardController } from './dashboard.controller';
import { authenticateJWT } from '../../middlewares/auth.middleware';

const router = Router();
router.use(authenticateJWT);
router.get('/summary', DashboardController.getSummary);

export default router;