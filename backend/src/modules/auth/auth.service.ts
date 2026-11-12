import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { env } from '../../config/env';
import { permissionsFor } from '../../config/permissions';
import { RefreshSession, User } from '../../database/models';
import { signAccessToken } from '../../middleware/auth';
import { audit, type Actor } from '../../services/common';
import { badRequest, unauthorized } from '../../utils/errors';

const BCRYPT_ROUNDS = 11;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
// Pre-computed hash so unknown-email logins cost the same as real ones (no user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

export const hashPassword = (p: string) => bcrypt.hash(p, BCRYPT_ROUNDS);
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function publicUser(u: {
  _id: unknown;
  name: string;
  email: string;
  role: 'OWNER' | 'MANAGER' | 'CASHIER';
  mustChangePassword?: boolean | null;
  phone?: string | null;
}) {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role,
    phone: u.phone ?? undefined,
    mustChangePassword: !!u.mustChangePassword,
    permissions: permissionsFor(u.role),
  };
}

async function issueSession(userId: string, family: string, meta: { userAgent?: string; ip?: string }) {
  const token = crypto.randomBytes(48).toString('base64url');
  await RefreshSession.create({
    user: userId,
    tokenHash: sha256(token),
    family,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400_000),
    userAgent: meta.userAgent?.slice(0, 200),
    ip: meta.ip,
  });
  return token;
}

export async function login(email: string, password: string, meta: { userAgent?: string; ip?: string }) {
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  const fail = () => unauthorized('Invalid email or password');
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw fail();
  }
  if (user.lockedUntil && user.lockedUntil > new Date())
    throw unauthorized('Account temporarily locked. Try again later.');
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    user.failedLogins = (user.failedLogins ?? 0) + 1;
    if (user.failedLogins >= MAX_FAILED) {
      user.lockedUntil = new Date(Date.now() + LOCK_MS);
      user.failedLogins = 0;
    }
    await user.save();
    await audit(
      { id: String(user._id), name: user.name, ip: meta.ip },
      'auth.login_failed',
      'User',
      user._id,
      'Failed login attempt',
    );
    throw fail();
  }
  if (!user.active) throw unauthorized('This account has been disabled');
  user.failedLogins = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();

  const refreshToken = await issueSession(String(user._id), crypto.randomUUID(), meta);
  const accessToken = signAccessToken({ sub: String(user._id), role: user.role, tv: user.tokenVersion });
  await audit(
    { id: String(user._id), name: user.name, ip: meta.ip },
    'auth.login',
    'User',
    user._id,
    'User logged in',
  );
  return { accessToken, refreshToken, user: publicUser(user) };
}

/** Rotating refresh tokens: each use revokes the presented token and issues a new one in the same family. A reused (already rotated) token revokes the whole family. */
export async function refresh(token: string | undefined, meta: { userAgent?: string; ip?: string }) {
  if (!token) throw unauthorized();
  const session = await RefreshSession.findOne({ tokenHash: sha256(token) });
  if (!session) throw unauthorized();
  if (session.revokedAt) {
    await RefreshSession.updateMany(
      { family: session.family, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    throw unauthorized('Session revoked');
  }
  if (session.expiresAt < new Date()) throw unauthorized('Session expired');
  const user = await User.findById(session.user);
  if (!user || !user.active) throw unauthorized('Account is not active');

  // Atomic claim: only one concurrent refresh can rotate this token.
  const claimed = await RefreshSession.findOneAndUpdate(
    { _id: session._id, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  if (!claimed) throw unauthorized('Session revoked');
  const next = await issueSession(String(user._id), session.family, meta);
  await RefreshSession.updateOne({ _id: session._id }, { $set: { replacedBy: sha256(next) } });
  return {
    accessToken: signAccessToken({ sub: String(user._id), role: user.role, tv: user.tokenVersion }),
    refreshToken: next,
    user: publicUser(user),
  };
}

export async function logout(token: string | undefined) {
  if (!token) return;
  const s = await RefreshSession.findOne({ tokenHash: sha256(token) });
  if (s)
    await RefreshSession.updateMany(
      { family: s.family, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
}

export const revokeAllSessions = (userId: string) =>
  RefreshSession.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });

export function assertStrongPassword(p: string) {
  if (p.length < 8) throw badRequest('Password must be at least 8 characters');
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) throw badRequest('Password must contain letters and numbers');
}

export async function changePassword(actor: Actor, current: string, next: string) {
  const user = await User.findById(actor.id).select('+passwordHash');
  if (!user || !(await bcrypt.compare(current, user.passwordHash)))
    throw badRequest('Current password is incorrect');
  assertStrongPassword(next);
  user.passwordHash = await hashPassword(next);
  user.mustChangePassword = false;
  user.tokenVersion += 1; // invalidates other devices' access tokens
  await user.save();
  await revokeAllSessions(actor.id);
  await audit(actor, 'auth.password_changed', 'User', user._id, 'Password changed');
  // fresh session for the caller
  const refreshToken = await issueSession(String(user._id), crypto.randomUUID(), { ip: actor.ip });
  return {
    accessToken: signAccessToken({ sub: String(user._id), role: user.role, tv: user.tokenVersion }),
    refreshToken,
    user: publicUser(user),
  };
}
