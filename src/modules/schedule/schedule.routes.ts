import { Router } from 'express';
import { ScheduleController } from './schedule.controller';
import { authenticateJWT, requireRole } from '../../middlewares/auth.middleware';

const router = Router();

// Only Admins can modify the authoritative schedules
router.put('/:id', authenticateJWT, requireRole(['SUPER_ADMIN', 'ADMIN']), ScheduleController.updateSchedule);

export default router;