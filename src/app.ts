import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { requestLogger } from './middlewares/request-logger.middleware';
import { AppError } from './utils/errors';
import { metrics } from './observability/metrics';
import { PrismaClient } from '@prisma/client';

import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/user/user.routes';
import deviceRoutes from './modules/device/device.routes';
import mqttRoutes from './modules/mqtt/mqtt.routes';
import firmwareRoutes from './modules/firmware/firmware.routes';
import swaggerUi from 'swagger-ui-express';
import { swaggerDocument } from './config/swagger';

const prisma = new PrismaClient();
const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN === '*' ? false : env.CORS_ORIGIN.split(','),
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

// Health Check Endpoints
app.get('/health/live', (_req, res) => {
  res.status(200).json({ status: 'live', timestamp: new Date().toISOString() });
});

app.get('/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: 'ready',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'unavailable',
      database: 'disconnected',
      error: 'Database connection failed',
    });
  }
});

// Production Observability Endpoint
app.get('/api/metrics', async (_req, res) => {
  try {
    const [onlineDevices, offlineDevices, activeAlerts, rtcInvalidDevices] = await Promise.all([
      prisma.device.count({ where: { status: 'ONLINE' } }),
      prisma.device.count({ where: { status: 'OFFLINE' } }),
      prisma.alert.count({ where: { status: 'OPEN' } }),
      prisma.device.count({ where: { rtc_valid: false, status: { not: 'DECOMMISSIONED' } } }),
    ]);

    const snapshot = metrics.getSnapshot({
      onlineDevices,
      offlineDevices,
      activeAlerts,
      rtcInvalidDevices,
    });

    res.status(200).json({ success: true, data: snapshot });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to aggregate system metrics' });
  }
});

// ===============================================
// Swagger Interactive API Docs
// (MUST be placed before the 404 handler)
// ===============================================
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Feature Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/mqtt', mqttRoutes);
app.use('/api/firmware', firmwareRoutes);

// ===============================================
// 404 Catch-All Handler 
// (Must be the very last route in the file)
// ===============================================
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Resource does not exist' },
  });
});

// Centralized Production Error Handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
  }

  // Never expose internal database/system stack traces in production
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: env.NODE_ENV === 'production' ? 'An unexpected internal error occurred' : err.message,
    },
  });
});

export default app;