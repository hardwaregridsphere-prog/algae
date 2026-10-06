import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

export class UserController {
  static async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: (req as any).user.sub },
        select: { id: true, email: true, name: true, role: true, last_login: true }
      });
      res.json({ success: true, data: user });
    } catch (error) { next(error); }
  }

  static async getUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const users = await prisma.user.findMany({ select: { id: true, email: true, name: true, role: true, is_active: true }});
      res.json({ success: true, data: users });
    } catch (error) { next(error); }
  }

  static async createUser(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password, name, role } = req.body;
      const password_hash = await argon2.hash(password);
      const user = await prisma.user.create({
        data: { email, password_hash, name, role },
        select: { id: true, email: true, role: true }
      });
      res.json({ success: true, data: user });
    } catch (error) { next(error); }
  }
}