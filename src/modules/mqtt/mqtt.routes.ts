import { Router } from 'express';
import { MqttController } from './mqtt.controller';

const router = Router();

// Endpoint for EMQX HTTP Authentication Plugin
router.post('/webhook/auth', MqttController.emqxWebhookAuth);

export default router;