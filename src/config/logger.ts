import pino from 'pino';
import { env } from './env';

const SENSITIVE_KEYS = [
  'password',
  'password_hash',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'jwt',
  'secret',
  'plainTextPassword',
  'credentials',
];

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: SENSITIVE_KEYS.flatMap((key) => [
      key,
      `*.${key}`,
      `*.*.${key}`,
      `body.${key}`,
      `headers.${key}`,
      `headers.authorization`,
    ]),
    censor: '[REDACTED]',
  },
});