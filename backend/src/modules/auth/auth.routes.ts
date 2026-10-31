import { Router, type Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { User } from '../../database/models';
import { authenticate } from '../../middleware/auth';
import { loginLimiter } from '../../middleware/rateLimit';
import { body } from '../../middleware/validate';
import { badRequest } from '../../utils/errors';
import { ok, wrap } from '../../utils/http';
import * as svc from './auth.service';

export const authRouter = Router();
const COOKIE = 'pos_refresh';

const setCookie = (res: Response, token: string) =>
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400_000,
  });
const clearCookie = (res: Response) => res.clearCookie(COOKIE, { path: '/api/v1/auth' });

/** CSRF defence for cookie-authenticated endpoints: SameSite=Strict plus a required custom header a cross-site form cannot send. */
const csrfGuard = (req: import('express').Request) => {
  if (req.headers['x-requested-with'] !== 'pos-web') throw badRequest('Missing CSRF header');
};

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

authRouter.post(
  '/login',
  loginLimiter,
  wrap(async (req, res) => {
    const { email, password } = body(loginSchema, req);
    const r = await svc.login(email, password, { userAgent: req.headers['user-agent'], ip: req.ip });
    setCookie(res, r.refreshToken);
    ok(res, { accessToken: r.accessToken, user: r.user });
  }),
);

authRouter.post(
  '/refresh',
  wrap(async (req, res) => {
    csrfGuard(req);
    try {
      const r = await svc.refresh(req.cookies?.[COOKIE], {
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      });
      setCookie(res, r.refreshToken);
      ok(res, { accessToken: r.accessToken, user: r.user });
    } catch (e) {
      clearCookie(res);
      throw e;
    }
  }),
);

authRouter.post(
  '/logout',
  wrap(async (req, res) => {
    csrfGuard(req);
    await svc.logout(req.cookies?.[COOKIE]);
    clearCookie(res);
    ok(res, { loggedOut: true });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  wrap(async (req, res) => {
    const u = await User.findById(req.user!.id);
    ok(res, svc.publicUser(u!));
  }),
);

const pwSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) });
authRouter.post(
  '/change-password',
  authenticate,
  wrap(async (req, res) => {
    const { currentPassword, newPassword } = body(pwSchema, req);
    const r = await svc.changePassword(req.user!, currentPassword, newPassword);
    setCookie(res, r.refreshToken);
    ok(res, { accessToken: r.accessToken, user: r.user });
  }),
);

const profileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).optional(),
});
authRouter.patch(
  '/profile',
  authenticate,
  wrap(async (req, res) => {
    const data = body(profileSchema, req);
    const u = await User.findByIdAndUpdate(req.user!.id, { $set: data }, { new: true });
    ok(res, svc.publicUser(u!));
  }),
);
