import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { can, type Permission, type Role } from '../config/permissions';
import { User } from '../database/models';
import { forbidden, unauthorized } from '../utils/errors';
import { wrap } from '../utils/http';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  ip?: string;
}
declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export interface AccessClaims {
  sub: string;
  role: Role;
  tv: number;
}

export const signAccessToken = (c: AccessClaims) =>
  jwt.sign(c, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'] });

/**
 * Verifies the bearer token AND re-checks the user in the database, so disabling an account or resetting
 * its password (tokenVersion bump) takes effect immediately instead of when the token expires.
 */
export const authenticate = wrap(async (req: Request, _res: Response, next: NextFunction) => {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw unauthorized();
  let claims: AccessClaims;
  try {
    claims = jwt.verify(h.slice(7), env.JWT_ACCESS_SECRET) as unknown as AccessClaims;
  } catch {
    throw unauthorized('Session expired');
  }
  const user = await User.findById(claims.sub).select('name email role active tokenVersion').lean();
  if (!user || !user.active || user.tokenVersion !== claims.tv)
    throw unauthorized('Session is no longer valid');
  req.user = { id: String(user._id), name: user.name, email: user.email, role: user.role, ip: req.ip };
  next();
});

/** Reusable server-side permission guard. Pass several permissions to require any one of them. */
export const requirePermission =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    const user = req.user;
    if (!perms.some((p) => can(user.role, p))) return next(forbidden());
    next();
  };

export const hasPermission = (req: Request, p: Permission) => !!req.user && can(req.user.role, p);
