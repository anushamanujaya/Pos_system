import { Router } from 'express';
import { z } from 'zod';
import { AuditLog, Notification, Promotion, StoreSettings } from '../../database/models';
import { authenticate, requirePermission } from '../../middleware/auth';
import { body, idParam, query } from '../../middleware/validate';
import { audit, getSettings } from '../../services/common';
import { badRequest, notFound } from '../../utils/errors';
import { ok, wrap } from '../../utils/http';
import { pageMeta, pageQuery } from '../../utils/pagination';
import { imageUpload, requirePersistentUploadStorage } from '../products/products.routes';

// ---------------- Settings ----------------
export const settingsRouter = Router();
settingsRouter.use(authenticate);

/** Settings needed by every signed-in user (receipt rendering, currency, tax list for display). */
settingsRouter.get(
  '/',
  wrap(async (_req, res) => ok(res, (await getSettings()).toObject())),
);

const settingsInput = z.object({
  store: z
    .object({
      name: z.string().trim().min(1).max(100),
      address: z.string().max(300),
      phone: z.string().max(40),
      email: z.string().max(100),
      taxId: z.string().max(50),
    })
    .partial()
    .optional(),
  timezone: z
    .string()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown timezone')
    .optional(),
  currency: z.object({ code: z.string().length(3), symbol: z.string().max(5) }).optional(),
  taxRates: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(20),
        name: z.string().trim().min(1).max(60),
        rateBps: z.number().int().min(0).max(10000),
      }),
    )
    .max(20)
    .optional(),
  priceIncludesTax: z.boolean().optional(),
  receipt: z
    .object({
      footer: z.string().max(300),
      paperSize: z.enum(['58mm', '80mm', 'A4']),
      invoicePrefix: z.string().trim().min(1).max(10),
      numberFormat: z
        .string()
        .max(60)
        .refine((s) => /\{SEQ:\d+\}/.test(s), 'Format must contain {SEQ:n}'),
    })
    .partial()
    .optional(),
  stock: z
    .object({
      lowStockDefaultMilli: z.number().int().min(0),
      expiryAlertDays: z.number().int().min(0).max(365),
      allowNegativeStock: z.boolean(),
      allowExpiredSales: z.boolean(),
    })
    .partial()
    .optional(),
  discounts: z
    .object({
      cashierMaxPercentBps: z.number().int().min(0).max(10000),
      maxPercentBps: z.number().int().min(0).max(10000),
    })
    .partial()
    .optional(),
  checkout: z
    .object({
      requireOpenShift: z.boolean(),
      refundRequiresManager: z.boolean(),
      refundWindowDays: z.number().int().min(0).max(3650),
    })
    .partial()
    .optional(),
});

function flatten(prefix: string, obj: Record<string, unknown>, out: Record<string, unknown>) {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v))
      flatten(`${prefix}${k}.`, v as Record<string, unknown>, out);
    else if (v !== undefined) out[`${prefix}${k}`] = v;
  }
}

settingsRouter.put(
  '/',
  requirePermission('settings.manage'),
  wrap(async (req, res) => {
    const d = body(settingsInput, req);
    const codes = d.taxRates?.map((t) => t.code);
    if (codes && new Set(codes).size !== codes.length) throw badRequest('Tax codes must be unique');
    await getSettings();
    const $set: Record<string, unknown> = {};
    flatten('', d as Record<string, unknown>, $set);
    const before = (await getSettings()).toObject();
    const updated = await StoreSettings.findOneAndUpdate(
      { key: 'store' },
      { $set },
      { new: true, runValidators: true },
    );
    await audit(req.user, 'settings.update', 'StoreSettings', updated!._id, 'Store settings changed', {
      fields: Object.keys($set),
      taxBefore: before.taxRates,
    });
    ok(res, updated!.toObject());
  }),
);

settingsRouter.post(
  '/logo',
  requirePermission('settings.manage'),
  requirePersistentUploadStorage,
  imageUpload.single('image'),
  wrap(async (req, res) => {
    if (!req.file) throw badRequest('Upload a JPEG, PNG or WebP image up to 2MB');
    await getSettings();
    await StoreSettings.updateOne(
      { key: 'store' },
      { $set: { 'store.logoUrl': `/uploads/${req.file.filename}` } },
    );
    await audit(req.user, 'settings.logo', 'StoreSettings', undefined, 'Store logo updated');
    ok(res, { logoUrl: `/uploads/${req.file.filename}` });
  }),
);

// ---------------- Notifications ----------------
export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get(
  '/',
  wrap(async (req, res) => {
    const q = query(
      pageQuery.extend({
        type: z.string().optional(),
        unread: z.literal('true').optional(),
        includeResolved: z.literal('true').optional(),
      }),
      req,
    );
    const f: Record<string, unknown> = {};
    if (q.type) f.type = q.type;
    if (!q.includeResolved) f.resolvedAt = null;
    if (q.unread) f.readBy = { $ne: req.user!.id };
    const [rows, total, unread] = await Promise.all([
      Notification.find(f)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Notification.countDocuments(f),
      Notification.countDocuments({ resolvedAt: null, readBy: { $ne: req.user!.id } }),
    ]);
    ok(
      res,
      rows.map((n) => ({ ...n, read: n.readBy.some((u) => String(u) === req.user!.id) })),
      { ...pageMeta(q.page, q.limit, total), unread },
    );
  }),
);

notificationsRouter.get(
  '/unread-count',
  wrap(async (req, res) => {
    ok(res, {
      unread: await Notification.countDocuments({ resolvedAt: null, readBy: { $ne: req.user!.id } }),
    });
  }),
);

notificationsRouter.post(
  '/read-all',
  wrap(async (req, res) => {
    await Notification.updateMany(
      { resolvedAt: null, readBy: { $ne: req.user!.id } },
      { $addToSet: { readBy: req.user!.id } },
    );
    ok(res, { done: true });
  }),
);

notificationsRouter.post(
  '/:id/read',
  wrap(async (req, res) => {
    const n = await Notification.findByIdAndUpdate(
      idParam(req),
      { $addToSet: { readBy: req.user!.id } },
      { new: true },
    );
    if (!n) throw notFound('Notification');
    ok(res, { read: true });
  }),
);

// ---------------- Promotions ----------------
export const promotionsRouter = Router();
promotionsRouter.use(authenticate);
const oidStr = z.string().regex(/^[a-f\d]{24}$/i);
const promoInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: z.enum(['PERCENT', 'FIXED']),
    value: z.number().int().min(1),
    scope: z.enum(['PRODUCT', 'CATEGORY', 'CART']),
    products: z.array(oidStr).default([]),
    categories: z.array(oidStr).default([]),
    minCartCents: z.number().int().min(0).default(0),
    startsAt: z.coerce.date().optional().nullable(),
    endsAt: z.coerce.date().optional().nullable(),
    priority: z.number().int().default(0),
    active: z.boolean().default(true),
  })
  .superRefine((d, ctx) => {
    if (d.type === 'PERCENT' && d.value > 10000)
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Percent is in basis points (max 10000 = 100%)',
      });
    if (d.scope === 'PRODUCT' && d.products.length === 0)
      ctx.addIssue({ code: 'custom', path: ['products'], message: 'Select at least one product' });
    if (d.scope === 'CATEGORY' && d.categories.length === 0)
      ctx.addIssue({ code: 'custom', path: ['categories'], message: 'Select at least one category' });
    if (d.startsAt && d.endsAt && d.endsAt < d.startsAt)
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End must be after start' });
  });

promotionsRouter.get(
  '/',
  requirePermission('sales.create', 'promotions.manage'),
  wrap(async (_req, res) => {
    ok(
      res,
      await Promotion.find()
        .sort({ active: -1, priority: -1, createdAt: -1 })
        .populate('products', 'name sku')
        .populate('categories', 'name')
        .lean(),
    );
  }),
);
promotionsRouter.post(
  '/',
  requirePermission('promotions.manage'),
  wrap(async (req, res) => {
    const p = await Promotion.create(body(promoInput, req));
    await audit(req.user, 'promotion.create', 'Promotion', p._id, `Created promotion ${p.name}`);
    ok(res, p, undefined, 201);
  }),
);
promotionsRouter.put(
  '/:id',
  requirePermission('promotions.manage'),
  wrap(async (req, res) => {
    const p = await Promotion.findByIdAndUpdate(idParam(req), { $set: body(promoInput, req) }, { new: true });
    if (!p) throw notFound('Promotion');
    await audit(req.user, 'promotion.update', 'Promotion', p._id, `Updated promotion ${p.name}`);
    ok(res, p);
  }),
);
promotionsRouter.delete(
  '/:id',
  requirePermission('promotions.manage'),
  wrap(async (req, res) => {
    const p = await Promotion.findByIdAndDelete(idParam(req));
    if (!p) throw notFound('Promotion');
    await audit(req.user, 'promotion.delete', 'Promotion', p._id, `Deleted promotion ${p.name}`);
    ok(res, { deleted: true });
  }),
);

// ---------------- Audit log ----------------
export const auditRouter = Router();
auditRouter.use(authenticate, requirePermission('audit.read'));
auditRouter.get(
  '/',
  wrap(async (req, res) => {
    const q = query(pageQuery.extend({ action: z.string().optional(), actor: oidStr.optional() }), req);
    const f: Record<string, unknown> = {};
    if (q.action) f.action = new RegExp(`^${q.action.replace(/[^\w.]/g, '')}`);
    if (q.actor) f.actor = q.actor;
    if (q.q) f.summary = new RegExp(q.q.replace(/[^\w\s.-]/g, ''), 'i');
    const [rows, total] = await Promise.all([
      AuditLog.find(f)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      AuditLog.countDocuments(f),
    ]);
    ok(res, rows, pageMeta(q.page, q.limit, total));
  }),
);
