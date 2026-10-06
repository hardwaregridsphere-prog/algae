import request from 'supertest';
import app from '../../src/app';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { env } from '../../src/config/env';

const prisma = new PrismaClient();

describe('Device Integration Flow', () => {
  let adminToken: string;
  let viewerToken: string;

  beforeAll(() => {
    adminToken = jwt.sign({ sub: 1, role: 'ADMIN' }, env.JWT_ACCESS_SECRET);
    viewerToken = jwt.sign({ sub: 2, role: 'VIEWER' }, env.JWT_ACCESS_SECRET);
  });

  it('RBAC Guard: VIEWER cannot provision new devices (403 Forbidden)', async () => {
    const res = await request(app)
      .post('/api/devices')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'Illegal Tree' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('ADMIN can provision devices and receive plaintext credentials ONCE', async () => {
    const res = await request(app)
      .post('/api/devices')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Integration Tree 1', timezone: 'UTC' });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('mqtt_credentials');
    expect(res.body.data.mqtt_credentials).toHaveProperty('username');
    expect(res.body.data.mqtt_credentials).toHaveProperty('password');
  });
});