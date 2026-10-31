import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { GoodsReceipt, Product, PurchaseOrder, Supplier } from '../../database/models';
import { authenticate, requirePermission } from '../../middleware/auth';
import { body, idParam, query } from '../../middleware/validate';
import { audit, getSettings, nextSeq, withTx } from '../../services/common';
import { addStock, checkStockAlerts } from '../../services/stock';
import { conflict, notFound, unprocessable } from '../../utils/errors';
import { ok, wrap } from '../../utils/http';
import { mulDiv, toMilli } from '../../utils/money';
import { pageMeta, pageQuery, escapeRegex } from '../../utils/pagination';
import { rangeForDays } from '../../utils/time';

export const purchasesRouter = Router();
purchasesRouter.use(authenticate);
const oidStr = z.string().regex(/^[a-f\d]{24}$/i);
const OID = (s: string) => new mongoose.Types.ObjectId(s);

const itemIn = z.object({
  product: oidStr,
  quantity: z.number().positive(),
  costCents: z.number().int().min(0),
});
const poInput = z.object({
  supplier: oidStr,
  items: z.array(itemIn).min(1).max(200),
  notes: z.string().trim().max(1000).optional(),
  expectedDate: z.coerce.date().optional(),
  supplierInvoiceRef: z.string().trim().max(60).optional(),
});

async function buildItems(items: z.infer<typeof itemIn>[]) {
  const ids = items.map((i) => i.product);
  if (new Set(ids).size !== ids.length)
    throw unprocessable('DUPLICATE_ITEM', 'Each product can appear once per purchase order');
  const prods = await Product.find({ _id: { $in: ids } })
    .populate<{ unit: { decimals: number } }>('unit', 'decimals')
    .lean();
  const map = new Map(prods.map((p) => [String(p._id), p]));
  return items.map((i) => {
    const p = map.get(i.product);
    if (!p) throw notFound('Product');
    return {
      product: OID(i.product),
      orderedMilli: toMilli(i.quantity, p.unit.decimals),
      costCents: i.costCents,
    };
  });
}
const total = (items: { orderedMilli: number; costCents: number }[]) =>
  items.reduce((a, i) => a + mulDiv(i.costCents, i.orderedMilli, 1000), 0);

purchasesRouter.get(
  '/',
  requirePermission('purchases.read'),
  wrap(async (req, res) => {
    const q = query(
      pageQuery.extend({
        status: z.string().optional(),
        supplier: oidStr.optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
      req,
    );
    const f: Record<string, unknown> = {};
    if (q.status) f.status = q.status;
    if (q.supplier) f.supplier = q.supplier;
    if (q.q) f.number = new RegExp(escapeRegex(q.q), 'i');
    if (q.from || q.to) {
      const r = rangeForDays(q.from ?? q.to!, q.to ?? q.from!, (await getSettings()).timezone);
      f.createdAt = { $gte: r.start, $lt: r.end };
    }
    const [rows, count] = await Promise.all([
      PurchaseOrder.find(f)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate('supplier', 'name')
        .lean(),
      PurchaseOrder.countDocuments(f),
    ]);
    ok(res, rows, pageMeta(q.page, q.limit, count));
  }),
);

purchasesRouter.get(
  '/receipts',
  requirePermission('purchases.read'),
  wrap(async (req, res) => {
    const q = query(pageQuery.extend({ supplier: oidStr.optional() }), req);
    const f: Record<string, unknown> = q.supplier ? { supplier: q.supplier } : {};
    const [rows, count] = await Promise.all([
      GoodsReceipt.find(f)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate('supplier', 'name')
        .populate('receivedBy', 'name')
        .lean(),
      GoodsReceipt.countDocuments(f),
    ]);
    ok(res, rows, pageMeta(q.page, q.limit, count));
  }),
);

purchasesRouter.get(
  '/:id',
  requirePermission('purchases.read'),
  wrap(async (req, res) => {
    const po = await PurchaseOrder.findById(idParam(req))
      .populate('supplier')
      .populate('items.product', 'name sku unit')
      .populate('createdBy', 'name')
      .lean();
    if (!po) throw notFound('Purchase order');
    const receipts = await GoodsReceipt.find({ purchaseOrder: po._id })
      .sort({ createdAt: 1 })
      .populate('receivedBy', 'name')
      .populate('items.product', 'name sku')
      .lean();
    ok(res, { ...po, receipts });
  }),
);

purchasesRouter.post(
  '/',
  requirePermission('purchases.manage'),
  wrap(async (req, res) => {
    const d = body(poInput.extend({ submit: z.boolean().default(false) }), req);
    if (!(await Supplier.exists({ _id: d.supplier, active: true }))) throw notFound('Supplier');
    const items = await buildItems(d.items);
    const seq = await nextSeq('po');
    const po = await PurchaseOrder.create({
      number: `PO-${String(seq).padStart(5, '0')}`,
      supplier: d.supplier,
      items,
      totalCents: total(items),
      notes: d.notes,
      expectedDate: d.expectedDate,
      supplierInvoiceRef: d.supplierInvoiceRef,
      status: d.submit ? 'ORDERED' : 'DRAFT',
      orderedAt: d.submit ? new Date() : undefined,
      createdBy: req.user!.id,
    });
    await audit(req.user, 'purchase.create', 'PurchaseOrder', po._id, `Created ${po.number} (${po.status})`);
    ok(res, po, undefined, 201);
  }),
);

purchasesRouter.patch(
  '/:id',
  requirePermission('purchases.manage'),
  wrap(async (req, res) => {
    const d = body(poInput.partial(), req);
    const po = await PurchaseOrder.findById(idParam(req));
    if (!po) throw notFound('Purchase order');
    if (po.status !== 'DRAFT') throw conflict('Only draft purchase orders can be edited');
    if (d.items) {
      const items = await buildItems(d.items);
      po.set('items', items);
      po.totalCents = total(items);
    }
    if (d.supplier) po.supplier = OID(d.supplier);
    if (d.notes !== undefined) po.notes = d.notes;
    if (d.expectedDate) po.expectedDate = d.expectedDate;
    if (d.supplierInvoiceRef !== undefined) po.supplierInvoiceRef = d.supplierInvoiceRef;
    await po.save();
    await audit(req.user, 'purchase.update', 'PurchaseOrder', po._id, `Edited ${po.number}`);
    ok(res, po);
  }),
);

purchasesRouter.post(
  '/:id/submit',
  requirePermission('purchases.manage'),
  wrap(async (req, res) => {
    const po = await PurchaseOrder.findOneAndUpdate(
      { _id: idParam(req), status: 'DRAFT' },
      { $set: { status: 'ORDERED', orderedAt: new Date() } },
      { new: true },
    );
    if (!po) throw conflict('Only draft purchase orders can be submitted');
    await audit(req.user, 'purchase.submit', 'PurchaseOrder', po._id, `Submitted ${po.number}`);
    ok(res, po);
  }),
);

purchasesRouter.post(
  '/:id/cancel',
  requirePermission('purchases.manage'),
  wrap(async (req, res) => {
    const po = await PurchaseOrder.findOneAndUpdate(
      {
        _id: idParam(req),
        status: { $in: ['DRAFT', 'ORDERED'] },
        'items.receivedMilli': { $not: { $gt: 0 } },
      },
      { $set: { status: 'CANCELLED', cancelledAt: new Date() } },
      { new: true },
    );
    if (!po) throw conflict('Only purchase orders with nothing received can be cancelled');
    await audit(req.user, 'purchase.cancel', 'PurchaseOrder', po._id, `Cancelled ${po.number}`);
    ok(res, po);
  }),
);

const receiveLine = z.object({
  product: oidStr,
  quantity: z.number().positive(),
  costCents: z.number().int().min(0).optional(),
  batchNo: z.string().trim().max(50).optional(),
  expiryDate: z.coerce.date().optional(),
});

/** Receive goods against a PO (partial receipts allowed, over-receipt rejected atomically). */
purchasesRouter.post(
  '/:id/receive',
  requirePermission('inventory.receive'),
  wrap(async (req, res) => {
    const d = body(
      z.object({
        items: z.array(receiveLine).min(1),
        supplierInvoiceRef: z.string().trim().max(60).optional(),
        notes: z.string().max(500).optional(),
      }),
      req,
    );
    const poId = idParam(req);
    const actor = OID(req.user!.id);
    const receipt = await withTx(async (session) => {
      const po = await PurchaseOrder.findById(poId).session(session);
      if (!po) throw notFound('Purchase order');
      if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status))
        throw conflict(`Cannot receive goods for a ${po.status.toLowerCase().replace('_', ' ')} order`);
      const ids = d.items.map((i) => i.product);
      if (new Set(ids).size !== ids.length)
        throw unprocessable('DUPLICATE_ITEM', 'List each product once per receipt');
      const prods = await Product.find({ _id: { $in: ids } })
        .populate<{ unit: { decimals: number } }>('unit', 'decimals')
        .session(session);
      const pm = new Map(prods.map((p) => [String(p._id), p]));
      const num = `GRN-${String(await nextSeq('grn', session)).padStart(5, '0')}`;
      const lines: {
        product: mongoose.Types.ObjectId;
        qtyMilli: number;
        costCents: number;
        batchNo?: string;
        expiryDate?: Date;
      }[] = [];
      for (const l of d.items) {
        const item = po.items.find((i) => String(i.product) === l.product);
        const p = pm.get(l.product);
        if (!item || !p) throw unprocessable('NOT_ON_ORDER', 'Product is not part of this purchase order');
        const qtyMilli = toMilli(l.quantity, p.unit.decimals);
        // atomic over-receipt guard: matches only if receivedMilli + qty <= ordered
        const r = await PurchaseOrder.updateOne(
          {
            _id: po._id,
            items: { $elemMatch: { _id: item._id, receivedMilli: { $lte: item.orderedMilli - qtyMilli } } },
          },
          { $inc: { 'items.$.receivedMilli': qtyMilli } },
          { session },
        );
        if (r.modifiedCount !== 1)
          throw unprocessable(
            'OVER_RECEIPT',
            `Received quantity for ${p.name} exceeds the outstanding quantity`,
          );
        const cost = l.costCents ?? item.costCents;
        lines.push({
          product: p._id,
          qtyMilli,
          costCents: cost,
          batchNo: l.batchNo,
          expiryDate: l.expiryDate,
        });
      }
      const [grn] = await GoodsReceipt.create(
        [
          {
            number: num,
            purchaseOrder: po._id,
            supplier: po.supplier,
            supplierInvoiceRef: d.supplierInvoiceRef ?? po.supplierInvoiceRef,
            items: lines,
            totalCents: lines.reduce((a, l) => a + mulDiv(l.costCents, l.qtyMilli, 1000), 0),
            receivedBy: actor,
            notes: d.notes,
          },
        ],
        { session },
      );
      for (const l of lines) {
        const p = pm.get(String(l.product))!;
        await addStock(
          session,
          { id: p._id, trackExpiry: p.trackExpiry, costCents: p.costCents },
          l.qtyMilli,
          {
            type: 'PURCHASE_RECEIPT',
            unitCostCents: l.costCents,
            batchNo: l.batchNo,
            expiryDate: l.expiryDate,
            actor,
            ref: { refType: 'GoodsReceipt', refId: grn._id, refNo: num },
          },
        );
      }
      const fresh = await PurchaseOrder.findById(po._id).session(session);
      const all = fresh!.items.every((i) => i.receivedMilli >= i.orderedMilli);
      fresh!.status = all ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      if (d.supplierInvoiceRef) fresh!.supplierInvoiceRef = d.supplierInvoiceRef;
      await fresh!.save({ session });
      await audit(
        req.user,
        'purchase.receive',
        'PurchaseOrder',
        po._id,
        `Received ${num} against ${po.number} (${fresh!.status})`,
        { lines: lines.length },
        session,
      );
      return grn;
    });
    await checkStockAlerts(receipt.items.map((i) => i.product));
    ok(res, receipt, undefined, 201);
  }),
);

/** Receive goods without a purchase order (e.g. walk-in delivery). */
purchasesRouter.post(
  '/receive-direct',
  requirePermission('inventory.receive'),
  wrap(async (req, res) => {
    const d = body(
      z.object({
        supplier: oidStr,
        supplierInvoiceRef: z.string().trim().max(60).optional(),
        notes: z.string().max(500).optional(),
        items: z.array(receiveLine.extend({ costCents: z.number().int().min(0) })).min(1),
      }),
      req,
    );
    const actor = OID(req.user!.id);
    const receipt = await withTx(async (session) => {
      if (!(await Supplier.exists({ _id: d.supplier }).session(session))) throw notFound('Supplier');
      const prods = await Product.find({ _id: { $in: d.items.map((i) => i.product) } })
        .populate<{ unit: { decimals: number } }>('unit', 'decimals')
        .session(session);
      const pm = new Map(prods.map((p) => [String(p._id), p]));
      const num = `GRN-${String(await nextSeq('grn', session)).padStart(5, '0')}`;
      const lines = d.items.map((l) => {
        const p = pm.get(l.product);
        if (!p) throw notFound('Product');
        return {
          product: p._id,
          qtyMilli: toMilli(l.quantity, p.unit.decimals),
          costCents: l.costCents,
          batchNo: l.batchNo,
          expiryDate: l.expiryDate,
        };
      });
      const [grn] = await GoodsReceipt.create(
        [
          {
            number: num,
            supplier: d.supplier,
            supplierInvoiceRef: d.supplierInvoiceRef,
            items: lines,
            totalCents: lines.reduce((a, l) => a + mulDiv(l.costCents, l.qtyMilli, 1000), 0),
            receivedBy: actor,
            notes: d.notes,
          },
        ],
        { session },
      );
      for (const l of lines) {
        const p = pm.get(String(l.product))!;
        await addStock(
          session,
          { id: p._id, trackExpiry: p.trackExpiry, costCents: p.costCents },
          l.qtyMilli,
          {
            type: 'PURCHASE_RECEIPT',
            unitCostCents: l.costCents,
            batchNo: l.batchNo,
            expiryDate: l.expiryDate,
            actor,
            ref: { refType: 'GoodsReceipt', refId: grn._id, refNo: num },
          },
        );
      }
      await audit(
        req.user,
        'inventory.receive',
        'GoodsReceipt',
        grn._id,
        `Direct receipt ${num}`,
        { lines: lines.length },
        session,
      );
      return grn;
    });
    await checkStockAlerts(receipt.items.map((i) => i.product));
    ok(res, receipt, undefined, 201);
  }),
);
