import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../config/logger';
import { metrics } from '../observability/metrics';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);

  metrics.incrementApiRequests();

  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const userId = (req as any).user?.sub ?? null;

    if (res.statusCode >= 400) {
      metrics.incrementApiErrors();
    }

    logger.info({
      operation: 'HTTP_REQUEST',
      requestId,
      userId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: Number(elapsedMs.toFixed(2)),
      ip: req.ip,
    });
  });

  next();
};