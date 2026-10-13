import type { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from '../utils/errors.js';
import { verifyAccessToken, type AccessClaims } from '../services/tokens.js';
import { User, type Role } from '../models/User.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AccessClaims & { id: string };
  }
}

/** Verify the bearer access token and confirm the account is still active. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  let claims: AccessClaims;
  try {
    claims = verifyAccessToken(header.slice(7));
  } catch {
    return next(unauthorized('Session expired or invalid'));
  }
  // A deactivated user or changed role must lose access immediately, not at token expiry.
  const user = await User.findById(claims.sub).select('status role name email').lean();
  if (!user || user.status !== 'active') return next(unauthorized('Account is not active'));
  req.user = { ...claims, role: user.role as Role, id: String(user._id) };
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export const isAdmin = (req: Request) => req.user?.role === 'admin';
export const isInspector = (req: Request) => req.user?.role === 'inspector';
