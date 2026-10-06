import { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/errors';

const prisma = new PrismaClient();

export class AuthController {
  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        throw new AppError(400, 'BAD_REQUEST', 'Email and password are required');
      }
      const result = await AuthService.login(email, password);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  static async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        throw new AppError(400, 'MISSING_TOKEN', 'Refresh token is required');
      }
      const result = await AuthService.refresh(refreshToken);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  static async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;
      const userId = (req as any).user?.sub;

      if (!refreshToken) {
        throw new AppError(400, 'MISSING_TOKEN', 'Refresh token is required');
      }

      await AuthService.logout(userId, refreshToken);
      res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
      next(error);
    }
  }

  static async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.sub;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          is_active: true,
          last_login: true,
          created_at: true,
          updated_at: true,
        },
      });

      if (!user || !user.is_active) {
        throw new AppError(404, 'USER_NOT_FOUND', 'User not found or inactive');
      }

      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }
}