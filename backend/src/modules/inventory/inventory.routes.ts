import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import {
  InventoryBatch,
  InventoryBalance,
  Product,
  StockMovement,
  MOVEMENT_TYPES,
} from '../../database/models';
import { authenticate, requirePermission } from '../../middleware/auth';
import { body, query } from '../../middleware/validate';
import { audit, getSettings, raiseNotification, withTx } from '../../services/common';
import { addStock, checkStockAlerts, removeStock, scanExpiry } from '../../services/stock';
import { toCsv } from '../../utils/csv';
import { notFound, unprocessable } from '../../utils/errors';
import { ok, wrap } from '../../utils/http';
import { pageMeta, pageQuery } from '../../utils/pagination';
import { toMilli } from '../../utils/money';
import { listProducts, listQuery } from '../products/products.service';
import { rangeForDays } from '../../utils/time';

export const inventoryRouter = Router();
inventoryRouter.use(authenticate);
const oidStr = z.string().regex(/^[a-f\d]{24}$/i);

/** Stock overview (products joined with balances) */
inventoryRouter.get(
  '/',
  requirePermission('inventory.read'),
  wrap(async (req, res) => {
    const { rows, meta } = await listProducts(query(listQuery, req));
    ok(res, rows, meta);
  }),
);

inventoryRouter.get(
  '/valuation',
  requirePermission('inventory.read'),
  wrap(async (_req, res) => {
    const rows = await InventoryBalance.aggregate([
      { $match: { onHandMilli: { $gt: 0 } } },
      { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'p' } },
      { $unwind: '$p' },
      { $lookup: { from: 'categories', localField: 'p.category', foreignField: '_id', as: 'c' } },
      {
        $group: {
          _id: { $first: '$c.name' },
          items: { $sum: 1 },
          costValueCents: { $sum: { $divide: [{ $multiply: ['$onHandMilli', '$p.costCents'] }, 1000] } },
          retailValueCents: { $sum: { $divide: [{ $multiply: ['$onHandMilli', '$p.priceCents'] }, 1000] } },
        },
      },
      {
        $project: {
          category: '$_id',
          _id: 0,
          items: 1,
          costValueCents: { $round: ['$costValueCents', 0] },
          retailValueCents: { $round: ['$retailValueCents', 0] },
        },
      },
      { $sort: { category: 1 } },
    ]);
    const totals = rows.reduce(
      (a, r) => ({
        costValueCents: a.costValueCents + r.costValueCents,
        retailValueCents: a.retailValueCents + r.retailValueCents,
        items: a.items + r.items,
      }),
      { costValueCents: 0, retailValueCents: 0, items: 0 },
    );
    ok(res, { byCategory: rows, totals });
  }),
);

const movementQuery = pageQuery.extend({
  product: oidStr.optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
async function movementFilter(q: z.infer<typeof movementQuery>) {
  const f: Record<string, unknown> = {};
  if (q.product) f.product = q.product;
  if (q.type) f.type = q.type;
  if (q.from || q.to) {
    const tz = (await getSettings()).timezone;
    const r = rangeForDays(q.from ?? q.to!, q.to ?? q.from!, tz);
    f.createdAt = { $gte: r.start, $lt: r.end };
  }
  return f;
}

inventoryRouter.get(
  '/movements',
  requirePermission('inventory.read'),
  wrap(async (req, res) => {
    const q = query(movementQuery, req);
    const f = await movementFilter(q);
    const [rows, total] = await Promise.all([
      StockMovement.find(f)
        .sort({ createdAt: -1, _id: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate('product', 'name sku')
        .populate('actor', 'name')
        .populate('batch', 'batchNo expiryDate')
        .lean(),
      StockMovement.countDocuments(f),
    ]);
    ok(res, rows, pageMeta(q.page, q.limit, total));
  }),
);

inventoryRouter.get(
  '/movements/export',
  requirePermission('inventory.read'),
  wrap(async (req, res) => {
    const f = await movementFilter(query(movementQuery, req));
    const rows = await StockMovement.find(f)
      .sort({ createdAt: -1 })
      .limit(20000)
      .populate('product', 'name sku')
      .populate('actor', 'name')
      .lean();
    const csv = toCsv(
      rows.map((m) => {
        const p = m.product as unknown as { name: string; sku: string };
        return {
          date: m.createdAt,
          sku: p?.sku,
          product: p?.name,
          type: m.type,
          quantity: m.qtyMilli / 1000,
          balanceAfter: (m.balanceAfterMilli ?? 0) / 1000,
          unitCost: (m.unitCostCents ?? 0) / 100,
          reference: m.refNo,
          reason: m.reason,
          by: (m.actor as unknown as { name: string })?.name,
        };
      }),
    );
    res
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader('Content-Disposition', 'attachment; filename="stock-movements.csv"')
      .send(csv);
  }),
);

inventoryRouter.get(
  '/batches',
  requirePermission('inventory.read'),
  wrap(async (req, res) => {
    const q = query(
      pageQuery.extend({
        product: oidStr.optional(),
        status: z.enum(['active', 'expiring', 'expired', 'empty']).optional(),
      }),
      req,
    );
    const settings = await getSettings();
    const now = new Date();
    const soon = new Date(now.getTime() + settings.stock.expiryAlertDays * 86400_000);
    const f: Record<string, unknown> = {};
    if (q.product) f.product = q.product;
    if (q.status === 'empty') f.remainingMilli = 0;
    else f.remainingMilli = { $gt: 0 };
    if (q.status === 'expired') f.expiryDate = { $lte: now };
    if (q.status === 'expiring') f.expiryDate = { $gt: now, $lte: soon };
    if (q.status === 'active') f.$or = [{ expiryDate: null }, { expiryDate: { $gt: now } }];
    const [rows, total] = await Promise.all([
      InventoryBatch.find(f)
        .sort({ expiryDate: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate('product', 'name sku')
        .lean(),
      InventoryBatch.countDocuments(f),
    ]);
    ok(
      res,
      rows.map((b) => ({
        ...b,
        status:
          b.expiryDate && b.expiryDate <= now
            ? 'expired'
            : b.expiryDate && b.expiryDate <= soon
              ? 'expiring'
              : 'ok',
      })),
      pageMeta(q.page, q.limit, total),
    );
  }),
);

const adjustSchema = z.object({
  product: oidStr,
  type: z.enum(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGED', 'EXPIRED']),
  quantity: z.number().positive(),
  reason: z.string().trim().min(3).max(300),
  batch: oidStr.optional(),
  batchNo: z.string().trim().max(50).optional(),
  expiryDate: z.coerce.date().optional(),
  costCents: z.number().int().min(0).optional(),
});

inventoryRouter.post(
  '/adjust',
  requirePermission('inventory.adjust'),
  wrap(async (req, res) => {
    const d = body(adjustSchema, req);
    const p = await Product.findById(d.product).populate<{ unit: { decimals: number } }>('unit', 'decimals');
    if (!p) throw notFound('Product');
    const qtyMilli = toMilli(d.quantity, p.unit.decimals);
    const actor = new mongoose.Types.ObjectId(req.user!.id);
    const prod = { id: p._id, name: p.name, trackExpiry: p.trackExpiry, costCents: p.costCents };

    const result = await withTx(async (session) => {
      const ref = { refType: 'Adjustment' as const, reason: d.reason };
      if (d.type === 'ADJUSTMENT_IN') {
        return addStock(session, prod, qtyMilli, {
          type: 'ADJUSTMENT_IN',
          unitCostCents: d.costCents,
          batchNo: d.batchNo,
          expiryDate: d.expiryDate,
          batchId: d.batch ? new mongoose.Types.ObjectId(d.batch) : undefined,
          actor,
          ref,
        });
      }
      if (d.type === 'EXPIRED' && p.trackExpiry && !d.batch) {
        throw unprocessable('BATCH_REQUIRED', 'Select the expired batch to write off');
      }
      return removeStock(session, prod, qtyMilli, {
        type: d.type,
        actor,
        ref,
        allowExpired: true,
        batchId: d.batch ? new mongoose.Types.ObjectId(d.batch) : undefined,
        allowNegative: false,
      });
    });
    await audit(
      req.user,
      'inventory.adjust',
      'Product',
      p._id,
      `${d.type} ${d.quantity} of ${p.sku}: ${d.reason}`,
      { type: d.type, qtyMilli },
    );
    if (['DAMAGED', 'EXPIRED'].includes(d.type) || qtyMilli >= 100000) {
      await raiseNotification({
        type: 'ADJUSTMENT',
        severity: 'info',
        title: `${d.type.replace('_', ' ')}: ${p.name}`,
        message: `${d.quantity} adjusted by ${req.user!.name}. ${d.reason}`,
        link: `/inventory/movements?product=${p._id}`,
        dedupeKey: `adj:${p._id}:${Date.now()}`,
      });
    }
    await checkStockAlerts([p._id]);
    ok(res, { balanceAfter: result.balanceAfterMilli / 1000 }, undefined, 201);
  }),
);

inventoryRouter.post(
  '/scan-expiry',
  requirePermission('inventory.read'),
  wrap(async (_req, res) => {
    const s = await getSettings();
    ok(res, { flagged: await scanExpiry(s.stock.expiryAlertDays) });
  }),
);
