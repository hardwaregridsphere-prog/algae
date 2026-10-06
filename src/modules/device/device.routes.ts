import { Router } from 'express';
import { DeviceController } from './device.controller';
import { authenticateJWT } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/rbac.middleware';

const router = Router();

// Base Security
router.use(authenticateJWT);

// --- 1. Queries & Retrievals (VIEWER and up) ---
router.get('/', requireRole(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER']), DeviceController.getDevices);
router.get('/:id', requireRole(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER']), DeviceController.getDeviceById);
router.get('/:id/status', requireRole(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER']), DeviceController.getDeviceStatus);
router.get('/:id/relays', requireRole(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER']), DeviceController.getDeviceRelays);

// --- 2. Operational Control (OPERATOR and up) ---
router.post('/:id/relay/:relay', requireRole(['SUPER_ADMIN', 'ADMIN', 'OPERATOR']), DeviceController.controlRelay);
router.patch('/:id/maintenance', requireRole(['SUPER_ADMIN', 'ADMIN', 'OPERATOR']), DeviceController.toggleMaintenance);

// --- 3. Provisioning & Management (ADMIN and up) ---
router.post('/', requireRole(['SUPER_ADMIN', 'ADMIN']), DeviceController.provisionDevice);
router.patch('/:id', requireRole(['SUPER_ADMIN', 'ADMIN']), DeviceController.updateDevice);
router.post('/:id/credentials/rotate', requireRole(['SUPER_ADMIN', 'ADMIN']), DeviceController.rotateCredentials);

// --- 4. Dangerous Actions (SUPER_ADMIN only) ---
router.delete('/:id', requireRole(['SUPER_ADMIN']), DeviceController.decommissionDevice);

export default router;