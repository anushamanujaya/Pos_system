import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS } from '../../config/permissions';
import { CashShift, Sale, User } from '../../database/models';
import { authenticate, requirePermission } from '../../middleware/auth';
import { body, idParam, query } from '../../middleware/validate';
import { audit } from '../../services/common';
import { assertStrongPassword, hashPassword, revokeAllSessions } from '../auth/auth.service';
import { badRequest, conflict, notFound } from '../../utils/errors';
import { ok, wrap } from '../../utils/http';
import { escapeRegex, pageMeta, pageQuery, sortSpec } from '../../utils/pagination';
import mongoose from 'mongoose';

export const usersRouter = Router();
usersRouter.use(authenticate);

const view = (u: {
  _id: unknown;
  name: string;
  email: string;
  role: string;
  phone?: string | null;
  active: boolean;
  lastLoginAt?: Date | null;
  createdAt?: Date;
  mustChangePassword?: boolean | null;
}) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
  phone: u.phone,
  active: u.active,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
  mustChangePassword: !!u.mustChangePassword,
});

usersRouter.get(
  '/roles',
  requirePermission('employees.read'),
  wrap(async (_req, res) => {
    ok(
      res,
      ROLES.map((r) => ({ role: r, permissions: [...ROLE_PERMISSIONS[r]] })),
      { allPermissions: PERMISSIONS },
    );
  }),
);

usersRouter.get(
  '/',
  requirePermission('employees.read'),
  wrap(async (req, res) => {
    const q = query(
      pageQuery.extend({ role: z.enum(ROLES).optional(), active: z.enum(['true', 'false']).optional() }),
      req,
    );
    const f: Record<string, unknown> = {};
    if (q.role) f.role = q.role;
    if (q.active) f.active = q.active === 'true';
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      f.$or = [{ name: rx }, { email: rx }];
    }
    const [rows, total] = await Promise.all([
      User.find(f)
        .sort(sortSpec(q.sort, ['name', 'email', 'role', 'lastLoginAt', 'createdAt'], { name: 1 }))
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      User.countDocuments(f),
    ]);
    ok(res, rows.map(view), pageMeta(q.page, q.limit, total));
  }),
);

usersRouter.get(
  '/:id',
  requirePermission('employees.read'),
  wrap(async (req, res) => {
    const u = await User.findById(idParam(req)).lean();
    if (!u) throw notFound('Employee');
    const id = new mongoose.Types.ObjectId(String(u._id));
    const [sales] = await Sale.aggregate([
      { $match: { cashier: id, status: 'COMPLETED' } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalCents: { $sum: '$totalCents' },
          refundedCents: { $sum: '$refundedCents' },
        },
      },
    ]);
    const shifts = await CashShift.find({ cashier: id })
      .sort({ openedAt: -1 })
      .limit(5)
      .populate('register', 'name')
      .lean();
    ok(res, {
      ...view(u),
      salesSummary: sales ?? { count: 0, totalCents: 0, refundedCents: 0 },
      recentShifts: shifts,
    });
  }),
);

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  phone: z.string().trim().max(30).optional(),
  role: z.enum(ROLES),
  password: z.string().min(8).max(200),
});

usersRouter.post(
  '/',
  requirePermission('employees.manage'),
  wrap(async (req, res) => {
    const d = body(createSchema, req);
    assertStrongPassword(d.password);
    if (await User.exists({ email: d.email.toLowerCase() }))
      throw conflict('An employee with this email already exists');
    const u = await User.create({
      ...d,
      passwordHash: await hashPassword(d.password),
      mustChangePassword: true,
    });
    await audit(req.user, 'employee.create', 'User', u._id, `Created ${d.role} ${d.email}`);
    ok(res, view(u), undefined, 201);
  }),
);

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
});

usersRouter.patch(
  '/:id',
  requirePermission('employees.manage'),
  wrap(async (req, res) => {
    const id = idParam(req);
    const d = body(updateSchema, req);
    const u = await User.findById(id);
    if (!u) throw notFound('Employee');
    const self = id === req.user!.id;
    if (self && (d.active === false || (d.role && d.role !== u.role)))
      throw badRequest('You cannot change your own role or disable your own account');
    const changedRole = d.role && d.role !== u.role;
    const disabling = d.active === false && u.active;
    Object.assign(u, d);
    if (changedRole || disabling) u.tokenVersion += 1; // kill existing access tokens immediately
    await u.save();
    if (changedRole || disabling) await revokeAllSessions(id);
    await audit(
      req.user,
      disabling ? 'employee.disable' : 'employee.update',
      'User',
      u._id,
      `Updated ${u.email}`,
      d,
    );
    ok(res, view(u));
  }),
);

usersRouter.post(
  '/:id/reset-password',
  requirePermission('employees.manage'),
  wrap(async (req, res) => {
    const { password } = body(z.object({ password: z.string().min(8).max(200) }), req);
    assertStrongPassword(password);
    const u = await User.findById(idParam(req));
    if (!u) throw notFound('Employee');
    u.passwordHash = await hashPassword(password);
    u.mustChangePassword = true;
    u.tokenVersion += 1;
    u.failedLogins = 0;
    u.lockedUntil = undefined;
    await u.save();
    await revokeAllSessions(String(u._id));
    await audit(req.user, 'employee.password_reset', 'User', u._id, `Password reset for ${u.email}`);
    ok(res, { reset: true });
  }),
);
