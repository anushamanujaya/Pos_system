import { Router } from 'express';
import { z } from 'zod';
import { can } from '../../config/permissions';
import { HeldSale, Sale, SaleReturn } from '../../database/models';
import { authenticate, requirePermission } from '../../middleware/auth';
import { body, idParam, query } from '../../middleware/validate';
import { getSettings } from '../../services/common';
import { toCsv } from '../../utils/csv';
import { forbidden, notFound } from '../../utils/errors';
import { ok, wrap } from '../../utils/http';
import { escapeRegex, pageMeta, pageQuery, sortSpec } from '../../utils/pagination';
import { rangeForDays } from '../../utils/time';
import * as svc from './sales.service';

export const salesRouter = Router();
salesRouter.use(authenticate);
const oidStr = z.string().regex(/^[a-f\d]{24}$/i);

/** Authoritative cart pricing for the POS screen (no side effects). */
salesRouter.post(
  '/calculate',
  requirePermission('sales.create'),
  wrap(async (req, res) => {
    const d = body(svc.checkoutInput.pick({ items: true, orderDiscount: true }), req);
    const settings = await getSettings();
    const { lines, totals, orderNote } = await svc.priceRequest(d, req.user!, settings);
    ok(res, {
      ...totals,
      orderDiscountNote: orderNote,
      lines: totals.lines.map((l, i) => ({
        ...l,
        name: lines[i].p.name,
        note: lines[i].note,
        qtyMilli: lines[i].qtyMilli,
        unitPriceCents: lines[i].p.priceCents,
      })),
    });
  }),
);

salesRouter.post(
  '/',
  requirePermission('sales.create'),
  wrap(async (req, res) => {
    const input = body(svc.checkoutInput, req);
    const r = await svc.checkout(req.user!, input, String(req.headers['idempotency-key'] ?? ''));
    const receipt = await svc.buildReceipt(r.saleId);
    ok(res, { ...r, ...receipt }, undefined, r.replayed ? 200 : 201);
  }),
);

// ---- held (suspended) sales: persisted server-side so they survive reloads and can move between terminals ----
salesRouter.get(
  '/held',
  requirePermission('sales.create'),
  wrap(async (req, res) => {
    ok(res, await HeldSale.find({ cashier: req.user!.id }).sort({ createdAt: -1 }).limit(50).lean());
  }),
);
salesRouter.post(
  '/held',
  requirePermission('sales.create'),
  wrap(async (req, res) => {
    const d = body(
      z.object({
        label: z.string().trim().max(60).optional(),
        customer: oidStr.optional(),
        cart: z.record(z.unknown()),
      }),
      req,
    );
    const h = await HeldSale.create({ ...d, cashier: req.user!.id });
    ok(res, h, undefined, 201);
  }),
);
salesRouter.delete(
  '/held/:id',
  requirePermission('sales.create'),
  wrap(async (req, res) => {
    const r = await HeldSale.deleteOne({ _id: idParam(req), cashier: req.user!.id });
    if (!r.deletedCount) throw notFound('Held sale');
    ok(res, { deleted: true });
  }),
);

const listQ = pageQuery.extend({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  cashier: oidStr.optional(),
  method: z.enum(['CASH', 'CARD']).optional(),
  status: z.enum(['COMPLETED', 'VOIDED']).optional(),
  customer: oidStr.optional(),
});
async function salesFilter(q: z.infer<typeof listQ>, req: import('express').Request) {
  const f: Record<string, unknown> = {};
  if (!can(req.user!.role, 'sales.read.all')) f.cashier = req.user!.id;
  else if (q.cashier) f.cashier = q.cashier;
  if (q.q) f.receiptNo = new RegExp(escapeRegex(q.q), 'i');
  if (q.method) f['payments.method'] = q.method;
  if (q.status) f.status = q.status;
  if (q.customer) f.customer = q.customer;
  if (q.from || q.to) {
    const r = rangeForDays(q.from ?? q.to!, q.to ?? q.from!, (await getSettings()).timezone);
    f.createdAt = { $gte: r.start, $lt: r.end };
  }
  return f;
}

salesRouter.get(
  '/',
  requirePermission('sales.read'),
  wrap(async (req, res) => {
    const q = query(listQ, req);
    const f = await salesFilter(q, req);
    const [rows, total] = await Promise.all([
      Sale.find(f)
        .select('-items')
        .sort(sortSpec(q.sort, ['createdAt', 'totalCents', 'receiptNo'], { createdAt: -1 }))
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Sale.countDocuments(f),
    ]);
    ok(res, rows, pageMeta(q.page, q.limit, total));
  }),
);

salesRouter.get(
  '/export',
  requirePermission('sales.read.all'),
  wrap(async (req, res) => {
    const f = await salesFilter(query(listQ, req), req);
    const rows = await Sale.find(f).select('-items').sort({ createdAt: -1 }).limit(20000).lean();
    const csv = toCsv(
      rows.map((s) => ({
        receipt: s.receiptNo,
        date: s.createdAt,
        cashier: s.cashierName,
        register: s.registerName,
        customer: s.customerName,
        subtotal: s.subtotalCents / 100,
        discount: s.discountCents / 100,
        tax: s.taxCents / 100,
        total: s.totalCents / 100,
        refunded: s.refundedCents / 100,
        methods: s.payments.map((p) => p.method).join('+'),
        status: s.status,
      })),
    );
    res
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader('Content-Disposition', 'attachment; filename="sales.csv"')
      .send(csv);
  }),
);

async function loadSale(req: import('express').Request) {
  const sale = await Sale.findById(idParam(req)).lean();
  if (!sale) throw notFound('Sale');
  if (String(sale.cashier) !== req.user!.id && !can(req.user!.role, 'sales.read.all')) throw forbidden();
  return sale;
}

salesRouter.get(
  '/lookup/:receiptNo',
  requirePermission('sales.refund'),
  wrap(async (req, res) => {
    const sale = await Sale.findOne({ receiptNo: String(req.params.receiptNo).trim() }).lean();
    if (!sale) throw notFound('Sale');
    if (String(sale.cashier) !== req.user!.id && !can(req.user!.role, 'sales.read.all')) throw forbidden();
    ok(res, sale);
  }),
);

salesRouter.get(
  '/:id',
  requirePermission('sales.read'),
  wrap(async (req, res) => {
    const sale = await loadSale(req);
    const returns = await SaleReturn.find({ sale: sale._id }).sort({ createdAt: 1 }).lean();
    ok(res, { ...sale, returns });
  }),
);

salesRouter.get(
  '/:id/receipt',
  requirePermission('sales.read'),
  wrap(async (req, res) => {
    const sale = await loadSale(req);
    ok(res, await svc.buildReceipt(String(sale._id)));
  }),
);
