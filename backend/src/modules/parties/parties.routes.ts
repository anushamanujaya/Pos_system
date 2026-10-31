import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Customer, GoodsReceipt, PurchaseOrder, Sale, Supplier } from '../../database/models';
import { authenticate, requirePermission } from '../../middleware/auth';
import { body, idParam, query } from '../../middleware/validate';
import { audit, nextSeq } from '../../services/common';
import { notFound } from '../../utils/errors';
import { ok, wrap } from '../../utils/http';
import { escapeRegex, pageMeta, pageQuery } from '../../utils/pagination';

// ---------------- Suppliers ----------------
export const suppliersRouter = Router();
suppliersRouter.use(authenticate);

const supplierInput = z.object({
  name: z.string().trim().min(1).max(150),
  contactPerson: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
  address: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(1000).optional(),
  active: z.boolean().optional(),
});

suppliersRouter.get(
  '/',
  requirePermission('suppliers.read'),
  wrap(async (req, res) => {
    const q = query(
      pageQuery.extend({ active: z.enum(['true', 'false']).optional(), all: z.literal('true').optional() }),
      req,
    );
    const f: Record<string, unknown> = {};
    if (q.active) f.active = q.active === 'true';
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      f.$or = [{ name: rx }, { contactPerson: rx }, { phone: rx }];
    }
    const limit = q.all ? 1000 : q.limit;
    const [rows, total] = await Promise.all([
      Supplier.find(f)
        .sort({ name: 1 })
        .skip(q.all ? 0 : (q.page - 1) * limit)
        .limit(limit)
        .lean(),
      Supplier.countDocuments(f),
    ]);
    ok(res, rows, pageMeta(q.page, limit, total));
  }),
);

suppliersRouter.get(
  '/:id',
  requirePermission('suppliers.read'),
  wrap(async (req, res) => {
    const id = new mongoose.Types.ObjectId(idParam(req));
    const s = await Supplier.findById(id).lean();
    if (!s) throw notFound('Supplier');
    const [orders, totals, receipts] = await Promise.all([
      PurchaseOrder.find({ supplier: id }).sort({ createdAt: -1 }).limit(20).lean(),
      PurchaseOrder.aggregate([
        { $match: { supplier: id, status: { $ne: 'CANCELLED' } } },
        { $group: { _id: null, orders: { $sum: 1 }, totalCents: { $sum: '$totalCents' } } },
      ]),
      GoodsReceipt.aggregate([
        { $match: { supplier: id } },
        { $group: { _id: null, receipts: { $sum: 1 }, receivedCents: { $sum: '$totalCents' } } },
      ]),
    ]);
    ok(res, {
      ...s,
      orders,
      summary: {
        ...(totals[0] ?? { orders: 0, totalCents: 0 }),
        ...(receipts[0] ?? { receipts: 0, receivedCents: 0 }),
      },
    });
  }),
);

suppliersRouter.post(
  '/',
  requirePermission('suppliers.manage'),
  wrap(async (req, res) => {
    const s = await Supplier.create(body(supplierInput, req));
    await audit(req.user, 'supplier.create', 'Supplier', s._id, `Created supplier ${s.name}`);
    ok(res, s, undefined, 201);
  }),
);

suppliersRouter.patch(
  '/:id',
  requirePermission('suppliers.manage'),
  wrap(async (req, res) => {
    const s = await Supplier.findByIdAndUpdate(
      idParam(req),
      { $set: body(supplierInput.partial(), req) },
      { new: true, runValidators: true },
    );
    if (!s) throw notFound('Supplier');
    await audit(req.user, 'supplier.update', 'Supplier', s._id, `Updated supplier ${s.name}`);
    ok(res, s);
  }),
);

// ---------------- Customers ----------------
export const customersRouter = Router();
customersRouter.use(authenticate);

const customerInput = z.object({
  name: z.string().trim().min(1).max(150),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  email: z.string().trim().email().optional().or(z.literal('')),
  address: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(1000).optional(),
  active: z.boolean().optional(),
});
const clean = <T extends Record<string, unknown>>(d: T) => ({
  ...d,
  phone: d.phone || undefined,
  email: d.email || undefined,
});

customersRouter.get(
  '/',
  requirePermission('customers.read'),
  wrap(async (req, res) => {
    const q = query(pageQuery.extend({ sort: z.string().optional() }), req);
    const f: Record<string, unknown> = {};
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      f.$or = [{ name: rx }, { phone: rx }, { code: rx }];
    }
    const [rows, total] = await Promise.all([
      Customer.find(f)
        .sort(q.sort === '-totalSpentCents' ? { totalSpentCents: -1 } : { name: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Customer.countDocuments(f),
    ]);
    ok(
      res,
      rows.map((c) => ({ ...c, returning: c.visitCount > 1 })),
      pageMeta(q.page, q.limit, total),
    );
  }),
);

customersRouter.get(
  '/:id',
  requirePermission('customers.read'),
  wrap(async (req, res) => {
    const c = await Customer.findById(idParam(req)).lean();
    if (!c) throw notFound('Customer');
    const sales = await Sale.find({ customer: c._id })
      .sort({ createdAt: -1 })
      .limit(25)
      .select('receiptNo totalCents refundedCents createdAt status')
      .lean();
    ok(res, { ...c, returning: c.visitCount > 1, recentSales: sales });
  }),
);

customersRouter.post(
  '/',
  requirePermission('customers.manage'),
  wrap(async (req, res) => {
    const d = clean(body(customerInput, req));
    const code = `C${String(await nextSeq('customer')).padStart(5, '0')}`;
    const c = await Customer.create({ ...d, code });
    await audit(req.user, 'customer.create', 'Customer', c._id, `Created customer ${c.code}`);
    ok(res, c, undefined, 201);
  }),
);

customersRouter.patch(
  '/:id',
  requirePermission('customers.manage'),
  wrap(async (req, res) => {
    const d = body(customerInput.partial(), req);
    const set = clean(d);
    const unset: Record<string, 1> = {};
    if ('phone' in d && !d.phone) unset.phone = 1;
    if ('email' in d && !d.email) unset.email = 1;
    const c = await Customer.findByIdAndUpdate(
      idParam(req),
      {
        $set: Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined)),
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      },
      { new: true, runValidators: true },
    );
    if (!c) throw notFound('Customer');
    await audit(req.user, 'customer.update', 'Customer', c._id, `Updated customer ${c.code}`);
    ok(res, c);
  }),
);
