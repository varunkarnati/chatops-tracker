import { Request, Response, NextFunction } from 'express';
import { DashboardAuth } from './auth.js';

/**
 * JWT verification middleware for protected API routes.
 */
export function createAuthMiddleware(auth: DashboardAuth) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const user = token ? auth.verifyToken(token) : null;

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    (req as any).user = user;
    next();
  };
}

/**
 * Role-based permission check.
 */
export function requireRole(sender: { role: string }, minRole: 'admin' | 'member' | 'viewer'): boolean {
  const hierarchy: Record<string, number> = { admin: 3, member: 2, viewer: 1 };
  return (hierarchy[sender.role] || 0) >= hierarchy[minRole];
}
