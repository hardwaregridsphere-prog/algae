import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../utils/errors';

const prisma = new PrismaClient();

// Helper to convert JWT duration strings ('30d', '24h', '15m') to milliseconds
function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return 30 * 24 * 60 * 60 * 1000; // Fallback to 30 days
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 30 * 24 * 60 * 60 * 1000;
  }
}

export class AuthService {
  static async login(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.is_active) throw new AppError(401, 'AUTH_FAILED', 'Invalid credentials');

    const valid = await argon2.verify(user.password_hash, password);
    if (!valid) throw new AppError(401, 'AUTH_FAILED', 'Invalid credentials');

    const { accessToken, refreshToken } = await this.generateTokens(user);
    await prisma.user.update({ where: { id: user.id }, data: { last_login: new Date() } });

    return { accessToken, refreshToken, user: { id: user.id, email: user.email, role: user.role } };
  }

  static async refresh(token: string) {
    // 1. Verify JWT signature & 2. Extract sub
    let decoded: any;
    try {
      decoded = jwt.verify(token, env.JWT_REFRESH_SECRET);
    } catch (err) {
      throw new AppError(401, 'TOKEN_INVALID', 'Invalid or expired refresh token');
    }

    const userId = decoded.sub;

    // 7. Verify user still active
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.is_active) {
      throw new AppError(401, 'USER_NOT_FOUND', 'User no longer exists or is inactive');
    }

    // 3. Fetch all active/recently expired tokens for this user
    // We must fetch revoked ones too to detect reuse!
    const candidateTokens = await prisma.refreshToken.findMany({
      where: { user_id: userId }
    });

    // 4. Locate the exact token record via Argon2 verification
    let matchingRecord = null;
    for (const record of candidateTokens) {
      if (await argon2.verify(record.token_hash, token)) {
        matchingRecord = record;
        break;
      }
    }

    if (!matchingRecord) {
      throw new AppError(401, 'TOKEN_INVALID', 'Invalid refresh token');
    }

    // 5 & 6. Verify expiration and revocation (REUSE DETECTION)
    if (matchingRecord.revoked_at !== null) {
      // SECURITY TRIPWIRE: A revoked token was used again! 
      // This means the token was likely stolen. Revoke the entire token family.
      logger.warn({ userId }, 'Refresh token reuse detected! Revoking all sessions.');
      await prisma.refreshToken.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: new Date() }
      });
      throw new AppError(401, 'TOKEN_REUSED', 'Token reuse detected. All sessions revoked for security. Please log in again.');
    }

    if (matchingRecord.expires_at < new Date()) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Refresh token has expired');
    }

    // 8. Revoke old token
    await prisma.refreshToken.update({
      where: { id: matchingRecord.id },
      data: { revoked_at: new Date() }
    });

    // 9 & 10. Issue new refresh token & Store new hash
    return await this.generateTokens(user);
  }

  static async logout(userId: number, token: string) {
    // Graceful logout: Find and revoke the specific token the user is holding
    const candidateTokens = await prisma.refreshToken.findMany({
      where: { user_id: userId, revoked_at: null }
    });

    for (const record of candidateTokens) {
      if (await argon2.verify(record.token_hash, token)) {
        await prisma.refreshToken.update({
          where: { id: record.id },
          data: { revoked_at: new Date() }
        });
        break;
      }
    }
  }

  private static async generateTokens(user: any) {
    const accessToken = jwt.sign(
      { sub: user.id, role: user.role }, 
      env.JWT_ACCESS_SECRET, 
      { expiresIn: env.JWT_ACCESS_EXPIRES_IN as any }
    );
    const refreshTokenStr = jwt.sign(
      { sub: user.id }, 
      env.JWT_REFRESH_SECRET, 
      { expiresIn: env.JWT_REFRESH_EXPIRES_IN as any }
    );

    // Single source of truth: Derive DB expiration directly from the env variable
    const expiresInMs = parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN);

    await prisma.refreshToken.create({
      data: { 
        user_id: user.id, 
        token_hash: await argon2.hash(refreshTokenStr), 
        expires_at: new Date(Date.now() + expiresInMs) 
      }
    });

    return { accessToken, refreshToken: refreshTokenStr };
  }
}