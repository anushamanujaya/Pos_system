import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { can } from '../../config/permissions';
import { CashShift, Product, Sale, SaleReturn, StockMovement } from '../../database/models';
import { authenticate, requirePermission } from '../../middleware/auth';
import { body, idParam, query } from '../../middleware/validate';
import { audit, formatNumber, getSettings, nextSeq, withTx } from '../../services/common';
import { addStock, checkStockAlerts } from '../../services/stock';
import { forbidden, notFound, unprocessable } from '../../utils/errors';
import { ok, wrap } from '../../utils/http';
import { mulDiv, toMilli } from '../../utils/money';
import { pageMeta, pageQuery } from '../../utils/pagination';

export const returnsRouter = Router();
returnsRouter.use(authenticate);
const oidStr = z.string().regex(/^[a-f\d]{24}$/i);

const returnInput = z.object({
  sale: oidStr,
  items: z
    .array(
      z.object({
        saleItemId: oidStr,
        quantity: z.number().positive(),
        condition: z.enum(['RESTOCK', 'DAMAGED']).default('RESTOCK'),
        reason: z.string().trim().max(200).optional(),
      }),
    )
    .min(1),
  refundMethod: z.enum(['CASH', 'CARD']),
  reason: z.string().trim().min(3).max(300),
});

returnsRouter.get(
  '/',
  requirePermission('sales.read'),
  wrap(async (req, res) => {
    const q = query(pageQuery, req);
    const f: Record<string, unknown> = {};
    if (!can(req.user!.role, 'sales.read.all')) f.processedBy = req.user!.id;
    if (q.q)
      f.$or = [
        { number: new RegExp(q.q.replace(/[^\w-]/g, ''), 'i') },
        { saleReceiptNo: new RegExp(q.q.replace(/[^\w-]/g, ''), 'i') },
      ];
    const [rows, total] = await Promise.all([
      SaleReturn.find(f)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      SaleReturn.countDocuments(f),
    ]);
    ok(res, rows, pageMeta(q.page, q.limit, total));
  }),
);

returnsRouter.get(
  '/:id',
  requirePermission('sales.read'),
  wrap(async (req, res) => {
    const r = await SaleReturn.findById(idParam(req)).lean();
    if (!r) throw notFound('Return');
    if (String(r.processedBy) !== req.user!.id && !can(req.user!.role, 'sales.read.all')) throw forbidden();
    const [settings, sale] = await Promise.all([
      getSettings(),
      Sale.findById(r.sale).select('receiptNo createdAt customerName').lean(),
    ]);
    const s = settings.toObject();
    ok(res, {
      ...r,
      sale,
      store: { ...s.store, currency: s.currency, timezone: s.timezone },
      receipt: { footer: s.receipt.footer, paperSize: s.receipt.paperSize },
    });
  }),
);

returnsRouter.post(
  '/',
  requirePermission('sales.refund'),
  wrap(async (req, res) => {
    const d = body(returnInput, req);
    const settings = await getSettings();
    if (settings.checkout.refundRequiresManager && !can(req.user!.role, 'sales.refund.approve')) {
      throw forbidden('Refunds require manager approval');
    }
    const actor = new mongoose.Types.ObjectId(req.user!.id);

    const created = await withTx(async (session) => {
      const sale = await Sale.findById(d.sale).session(session);
      if (!sale) throw notFound('Sale');
      if (sale.status !== 'COMPLETED')
        throw unprocessable('SALE_NOT_REFUNDABLE', 'This sale cannot be refunded');
      if (String(sale.cashier) !== req.user!.id && !can(req.user!.role, 'sales.read.all')) throw forbidden();
      const ageDays = (Date.now() - (sale.createdAt as Date).getTime()) / 86400_000;
      if (ageDays > settings.checkout.refundWindowDays && !can(req.user!.role, 'sales.refund.approve')) {
        throw unprocessable(
          'REFUND_WINDOW',
          `Refund window of ${settings.checkout.refundWindowDays} days has passed`,
        );
      }
      const paidBy = (m: string) =>
        sale.payments.filter((p) => p.method === m).reduce((a, p) => a + p.amountCents, 0);
      if (paidBy(d.refundMethod) === 0)
        throw unprocessable(
          'INVALID_REFUND_METHOD',
          `This sale was not paid by ${d.refundMethod.toLowerCase()}`,
        );

      const shift = await CashShift.findOne({ cashier: actor, status: 'OPEN' }).session(session);
      if (d.refundMethod === 'CASH' && !shift)
        throw unprocessable('NO_OPEN_SHIFT', 'Open a shift to pay a cash refund from the drawer');

      const num = formatNumber(
        'RET-{YYYY}{MM}{DD}-{SEQ:5}',
        'RET',
        await nextSeq('return', session),
        new Date(),
        settings.timezone,
      );
      const ids = d.items.map((i) => i.saleItemId);
      if (new Set(ids).size !== ids.length) throw unprocessable('DUPLICATE_ITEM', 'List each sale line once');

      const lines: {
        saleItemId: mongoose.Types.ObjectId;
        product: mongoose.Types.ObjectId;
        name?: string | null;
        qtyMilli: number;
        refundCents: number;
        taxCents: number;
        unitCostCents: number;
        restock: boolean;
        damaged: boolean;
        reason?: string;
      }[] = [];
      const pending: {
        item: (typeof sale.items)[number];
        line: (typeof lines)[number];
        cond: 'RESTOCK' | 'DAMAGED';
      }[] = [];

      for (const it of d.items) {
        const item = sale.items.id(it.saleItemId);
        if (!item) throw notFound('Sale line');
        const prod = await Product.findById(item.product)
          .populate<{ unit: { decimals: number } }>('unit', 'decimals')
          .session(session);
        if (!prod) throw notFound('Product');
        const rq = toMilli(it.quantity, prod.unit.decimals);
        const remaining = item.qtyMilli - item.returnedMilli;
        if (rq > remaining)
          throw unprocessable(
            'OVER_REFUND',
            `Only ${remaining / 1000} of ${item.name} can still be returned`,
          );
        const final = rq === remaining;
        const priorTax = sale.items.id(it.saleItemId)!.taxCents; // line tax is apportioned like the amount
        const refundCents = final
          ? item.totalCents - item.refundedCents
          : mulDiv(item.totalCents, rq, item.qtyMilli);
        const taxCents = final
          ? Math.max(0, priorTax - (await refundedTaxSoFar(sale._id, item._id, session)))
          : mulDiv(priorTax, rq, item.qtyMilli);
        // Atomic guard: matches only if nobody changed the returned quantity since we read it.
        const r = await Sale.updateOne(
          {
            _id: sale._id,
            status: 'COMPLETED',
            items: { $elemMatch: { _id: item._id, returnedMilli: item.returnedMilli } },
          },
          {
            $inc: {
              'items.$.returnedMilli': rq,
              'items.$.refundedCents': refundCents,
              refundedCents: refundCents,
              refundedTaxCents: taxCents,
            },
          },
          { session },
        );
        if (r.modifiedCount !== 1)
          throw unprocessable(
            'CONCURRENT_REFUND',
            'This sale was changed by another refund. Reload and try again.',
          );
        const line = {
          saleItemId: item._id,
          product: item.product,
          name: item.name,
          qtyMilli: rq,
          refundCents,
          taxCents,
          unitCostCents: item.unitCostCents,
          restock: it.condition === 'RESTOCK',
          damaged: it.condition === 'DAMAGED',
          reason: it.reason,
        };
        lines.push(line);
        pending.push({ item, line, cond: it.condition });
      }

      const refundCents = lines.reduce((a, l) => a + l.refundCents, 0);
      if (refundCents <= 0) throw unprocessable('NOTHING_TO_REFUND', 'Nothing to refund');
      // per-method cap: cannot refund more cash than was paid in cash (or card than card)
      const prior = await SaleReturn.aggregate([
        { $match: { sale: sale._id, refundMethod: d.refundMethod } },
        { $group: { _id: null, t: { $sum: '$refundCents' } } },
      ]).session(session);
      if ((prior[0]?.t ?? 0) + refundCents > paidBy(d.refundMethod)) {
        throw unprocessable(
          'REFUND_EXCEEDS_PAYMENT',
          `Refund exceeds the amount paid by ${d.refundMethod.toLowerCase()}. Choose the other refund method.`,
        );
      }
      const [ret] = await SaleReturn.create(
        [
          {
            number: num,
            sale: sale._id,
            saleReceiptNo: sale.receiptNo,
            items: lines,
            refundMethod: d.refundMethod,
            refundCents,
            refundTaxCents: lines.reduce((a, l) => a + l.taxCents, 0),
            reason: d.reason,
            shift: shift?._id,
            processedBy: actor,
            processedByName: req.user!.name,
          },
        ],
        { session },
      );

      for (const { item, line, cond } of pending) {
        const prod = (await Product.findById(item.product).session(session))!;
        const ref = {
          refType: 'SaleReturn' as const,
          refId: ret._id,
          refNo: num,
          reason: line.reason ?? d.reason,
        };
        if (cond === 'RESTOCK') {
          const batch = item.allocations.find((a) => a.batch)?.batch;
          await addStock(
            session,
            { id: prod._id, trackExpiry: prod.trackExpiry && !!batch, costCents: item.unitCostCents },
            line.qtyMilli,
            { type: 'SALE_RETURN', actor, batchId: batch ?? undefined, ref },
          );
        } else {
          // Damaged returns are recorded in the ledger but never become saleable stock (net-zero movement pair).
          await StockMovement.create(
            [
              {
                product: prod._id,
                type: 'SALE_RETURN',
                qtyMilli: line.qtyMilli,
                unitCostCents: item.unitCostCents,
                actor,
                ...ref,
              },
              {
                product: prod._id,
                type: 'DAMAGED',
                qtyMilli: -line.qtyMilli,
                unitCostCents: item.unitCostCents,
                actor,
                ...ref,
              },
            ],
            { session, ordered: true },
          );
        }
      }
      await audit(
        req.user,
        'sale.refund',
        'SaleReturn',
        ret._id,
        `Refund ${num} of ${refundCents / 100} against ${sale.receiptNo}`,
        { method: d.refundMethod },
        session,
      );
      return ret;
    });
    await checkStockAlerts(created.items.map((i) => i.product));
    ok(res, created, undefined, 201);
  }),
);

async function refundedTaxSoFar(
  saleId: mongoose.Types.ObjectId,
  itemId: mongoose.Types.ObjectId,
  session: mongoose.ClientSession,
) {
  const r = await SaleReturn.aggregate([
    { $match: { sale: saleId } },
    { $unwind: '$items' },
    { $match: { 'items.saleItemId': itemId } },
    { $group: { _id: null, t: { $sum: '$items.taxCents' } } },
  ]).session(session);
  return r[0]?.t ?? 0;
}
