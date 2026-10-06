import { AuthService } from '../../src/modules/auth/auth.service';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { env } from '../../src/config/env';

jest.mock('@prisma/client');
jest.mock('argon2');
jest.mock('jsonwebtoken');

describe('AuthService Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should authenticate user and issue accessToken + refreshToken', async () => {
    const mockUser = {
      id: 1,
      email: 'admin@algaetree.com',
      password_hash: 'hashedPassword',
      role: 'ADMIN',
      is_active: true,
    };

    (PrismaClient.prototype.user as any) = {
      findUnique: jest.fn().mockResolvedValue(mockUser),
      update: jest.fn().mockResolvedValue(mockUser),
    };
    (PrismaClient.prototype.refreshToken as any) = {
      create: jest.fn().mockResolvedValue({ id: 1 }),
    };

    (argon2.verify as jest.Mock).mockResolvedValue(true);
    (argon2.hash as jest.Mock).mockResolvedValue('tokenHash');
    (jwt.sign as jest.Mock).mockReturnValue('mock.jwt.token');

    const result = await AuthService.login('admin@algaetree.com', 'SuperSecret123');

    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(result.user.email).toBe('admin@algaetree.com');
  });

  it('should trip reuse detection when a revoked refresh token is presented', async () => {
    (jwt.verify as jest.Mock).mockReturnValue({ sub: 1 });
    (PrismaClient.prototype.user as any) = {
      findUnique: jest.fn().mockResolvedValue({ id: 1, is_active: true }),
    };

    const staleTokenRecord = {
      id: 99,
      user_id: 1,
      token_hash: 'hash',
      revoked_at: new Date(), // Already revoked!
      expires_at: new Date(Date.now() + 10000),
    };

    (PrismaClient.prototype.refreshToken as any) = {
      findMany: jest.fn().mockResolvedValue([staleTokenRecord]),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    };
    (argon2.verify as jest.Mock).mockResolvedValue(true);

    await expect(AuthService.refresh('compromised.token')).rejects.toThrow(
      'Token reuse detected. All sessions revoked for security. Please log in again.'
    );

    expect(PrismaClient.prototype.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { user_id: 1, revoked_at: null },
      data: { revoked_at: expect.any(Date) },
    });
  });
});