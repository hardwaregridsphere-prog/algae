import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AppError } from '../utils/errors';

/**
 * Authoritative RBAC Middleware.
 * Must be executed AFTER authenticateJWT.
 */
export const requireRole = (allowedRoles: Role[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    // Failsafe: Ensure authenticateJWT actually ran before this
    if (!user || !user.role) {
      return next(new AppError(401, 'UNAUTHORIZED', 'Authentication required before verifying roles'));
    }

    if (!allowedRoles.includes(user.role as Role)) {
      return next(new AppError(
        403, 
        'FORBIDDEN', 
        `Insufficient permissions. Required one of: ${allowedRoles.join(', ')}`
      ));
    }

    next();
  };
};