import crypto from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import { z } from 'zod';
import { can } from '../../config/permissions';
import {
  CashShift,
  Customer,
  HeldSale,
  IdempotencyRecord,
  Product,
  Promotion,
  Sale,
} from '../../database/models';
import type { AuthUser } from '../../middleware/auth';
import {
  audit,
  formatNumber,
  getSettings,
  isDuplicateKey,
  nextSeq,
  withTx,
  type SettingsLike,
} from '../../services/common';
import { checkStockAlerts, removeStock } from '../../services/stock';
import { AppError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../utils/errors';
import { lineAmount, toMilli } from '../../utils/money';
import {
  discountAmount,
  priceCart,
  settlePayments,
  type CartLineInput,
  type DiscountSpec,
} from '../../utils/pricing';

const oidStr = z.string().regex(/^[a-f\d]{24}$/i);
const discountIn = z.union([
  z.object({
    type: z.literal('PERCENT'),
    percent: z.number().min(0).max(100),
    note: z.string().max(100).optional(),
  }),
  z.object({
    type: z.literal('FIXED'),
    amountCents: z.number().int().min(0),
    note: z.string().max(100).optional(),
  }),
]);
export const checkoutInput = z.object({
  items: z
    .array(z.object({ product: oidStr, quantity: z.number().positive(), discount: discountIn.optional() }))
    .min(1)
    .max(300),
  orderDiscount: discountIn.optional(),
  customer: oidStr.optional(),
  payments: z
    .array(
      z.object({
        method: z.enum(['CASH', 'CARD']),
        amountCents: z.number().int().positive(),
        reference: z.string().max(60).optional(),
      }),
    )
    .min(1)
    .max(6),
  /** Optional safety net: if the server's authoritative total differs, the sale is refused with the new total. */
  expectedTotalCents: z.number().int().optional(),
  heldId: oidStr.optional(),
});
export type CheckoutInput = z.infer<typeof checkoutInput>;

const toSpec = (d: z.infer<typeof discountIn>): DiscountSpec =>
  d.type === 'PERCENT'
    ? { type: 'PERCENT', valueBps: Math.round(d.percent * 100) }
    : { type: 'FIXED', cents: d.amountCents };

/** Preview/pricing shared by checkout and the POS "calculate" endpoint: everything authoritative comes from the DB. */
export async function priceRequest(
  input: Pick<CheckoutInput, 'items' | 'orderDiscount'>,
  user: Pick<AuthUser, 'role'>,
  settings: SettingsLike,
  session?: ClientSession,
) {
  const ids = input.items.map((i) => i.product);
  if (new Set(ids).size !== ids.length)
    throw unprocessable(
      'DUPLICATE_ITEM',
      'Each product may appear once in the cart; increase its quantity instead',
    );
  const prods = await Product.find({ _id: { $in: ids } })
    .populate<{ unit: { decimals: number; symbol: string } }>('unit', 'decimals symbol')
    .session(session ?? null);
  const pm = new Map(prods.map((p) => [String(p._id), p]));
  const now = new Date();
  const promos = await Promotion.find({
    active: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
    ],
  })
    .sort({ priority: -1, _id: 1 })
    .session(session ?? null)
    .lean();

  const taxByCode = new Map(settings.taxRates.map((t) => [t.code, t]));
  const allowedBps = can(user.role, 'discount.override')
    ? settings.discounts.maxPercentBps
    : settings.discounts.cashierMaxPercentBps;

  const lines = input.items.map((it) => {
    const p = pm.get(it.product);
    if (!p) throw notFound('Product');
    if (p.status !== 'ACTIVE') throw unprocessable('PRODUCT_INACTIVE', `${p.name} is not available for sale`);
    let qtyMilli: number;
    try {
      qtyMilli = toMilli(it.quantity, p.unit.decimals);
    } catch (e) {
      throw badRequest(`${p.name}: ${(e as Error).message}`);
    }
    const gross = lineAmount(p.priceCents, qtyMilli);

    // Best applicable automatic promotion (deterministic: max saving, ties by priority then id).
    let promoSpec: DiscountSpec | undefined;
    let promoNote: string | undefined;
    let best = 0;
    for (const pr of promos) {
      if (pr.scope === 'CART') continue;
      const applies =
        pr.scope === 'PRODUCT'
          ? pr.products.some((x) => String(x) === String(p._id))
          : pr.categories.some((x) => String(x) === String(p.category));
      if (!applies) continue;
      const spec: DiscountSpec =
        pr.type === 'PERCENT' ? { type: 'PERCENT', valueBps: pr.value } : { type: 'FIXED', cents: pr.value };
      const amt = discountAmount(gross, spec);
      if (amt > best) {
        best = amt;
        promoSpec = spec;
        promoNote = `Promo: ${pr.name}`;
      }
    }
    let spec = promoSpec;
    let note = promoNote;
    if (it.discount) {
      spec = toSpec(it.discount);
      note = it.discount.note || 'Manual discount';
      const amt = discountAmount(gross, spec);
      if (gross > 0 && Math.floor((amt * 10000) / gross) > allowedBps) {
        throw forbidden(`Discount on ${p.name} exceeds your limit. A manager override is required.`);
      }
    }
    const tax = p.taxCode ? taxByCode.get(p.taxCode) : undefined;
    const line: CartLineInput = {
      key: String(p._id),
      unitPriceCents: p.priceCents,
      qtyMilli,
      taxRateBps: tax?.rateBps ?? 0,
      taxCode: tax?.code,
      discount: spec,
    };
    return { p, qtyMilli, line, note };
  });

  // Order-level discount: manual wins; otherwise the best qualifying cart promotion.
  const preTotal = priceCart(
    lines.map((l) => l.line),
    { priceIncludesTax: settings.priceIncludesTax },
  );
  const afterLines = preTotal.subtotalCents - preTotal.lines.reduce((a, l) => a + l.lineDiscountCents, 0);
  let orderSpec: DiscountSpec | undefined;
  let orderNote: string | undefined;
  if (input.orderDiscount) {
    orderSpec = toSpec(input.orderDiscount);
    orderNote = input.orderDiscount.note || 'Order discount';
    const amt = discountAmount(afterLines, orderSpec);
    if (afterLines > 0 && Math.floor((amt * 10000) / afterLines) > allowedBps)
      throw forbidden('Order discount exceeds your limit. A manager override is required.');
  } else {
    let best = 0;
    for (const pr of promos) {
      if (pr.scope !== 'CART' || afterLines < pr.minCartCents) continue;
      const spec: DiscountSpec =
        pr.type === 'PERCENT' ? { type: 'PERCENT', valueBps: pr.value } : { type: 'FIXED', cents: pr.value };
      const amt = discountAmount(afterLines, spec);
      if (amt > best) {
        best = amt;
        orderSpec = spec;
        orderNote = `Promo: ${pr.name}`;
      }
    }
  }
  const totals = priceCart(
    lines.map((l) => l.line),
    { priceIncludesTax: settings.priceIncludesTax, orderDiscount: orderSpec },
  );
  return { lines, totals, orderNote };
}

export interface CheckoutResult {
  saleId: string;
  receiptNo: string;
  replayed: boolean;
}

const hashRequest = (i: CheckoutInput) => crypto.createHash('sha256').update(JSON.stringify(i)).digest('hex');

export async function checkout(
  user: AuthUser,
  input: CheckoutInput,
  idempotencyKey: string,
): Promise<CheckoutResult> {
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100)
    throw badRequest('Idempotency-Key header (8-100 chars) is required');
  const requestHash = hashRequest(input);
  const scope = 'checkout';

  const replay = async (): Promise<CheckoutResult | null> => {
    const rec = await IdempotencyRecord.findOne({ user: user.id, scope, key: idempotencyKey }).lean();
    if (!rec) return null;
    if (rec.requestHash !== requestHash)
      throw new AppError(
        422,
        'IDEMPOTENCY_MISMATCH',
        'This Idempotency-Key was used with a different request',
      );
    const sale = await Sale.findById(rec.resourceId).select('receiptNo').lean();
    if (!sale) return null;
    return { saleId: String(sale._id), receiptNo: sale.receiptNo, replayed: true };
  };

  const existing = await replay();
  if (existing) return existing;

  const settings = await getSettings();
  const saleId = new mongoose.Types.ObjectId();
  let result: { receiptNo: string; productIds: mongoose.Types.ObjectId[] };
  try {
    result = await withTx(async (session) => {
      // Claim the key first. A concurrent duplicate hits the unique index (write conflict -> retry -> duplicate key).
      await IdempotencyRecord.create(
        [{ key: idempotencyKey, user: user.id, scope, requestHash, resourceId: saleId }],
        { session },
      );

      const shift = await CashShift.findOne({ cashier: user.id, status: 'OPEN' })
        .populate('register', 'name')
        .session(session);
      if (!shift && settings.checkout.requireOpenShift)
        throw unprocessable('NO_OPEN_SHIFT', 'Open a cash register shift before selling');

      const { lines, totals, orderNote } = await priceRequest(input, user, settings, session);
      if (input.expectedTotalCents !== undefined && input.expectedTotalCents !== totals.totalCents) {
        throw new AppError(409, 'PRICE_CHANGED', 'Prices changed since the cart was built', {
          totalCents: totals.totalCents,
        });
      }
      let applied;
      try {
        applied = settlePayments(totals.totalCents, input.payments);
      } catch (e) {
        throw unprocessable('INVALID_PAYMENT', (e as Error).message);
      }

      let customer = null;
      if (input.customer) {
        customer = await Customer.findOne({ _id: input.customer, active: true }).session(session);
        if (!customer) throw notFound('Customer');
      }

      const actor = new mongoose.Types.ObjectId(user.id);
      const seq = await nextSeq('sale', session);
      const now = new Date();
      const receiptNo = formatNumber(
        settings.receipt.numberFormat,
        settings.receipt.invoicePrefix,
        seq,
        now,
        settings.timezone,
      );

      // Deduct in a stable order (by product id) so concurrent carts conflict predictably instead of deadlocking.
      const order = [...lines].sort((a, b) => String(a.p._id).localeCompare(String(b.p._id)));
      const costs = new Map<string, Awaited<ReturnType<typeof removeStock>>>();
      for (const l of order) {
        const r = await removeStock(
          session,
          { id: l.p._id, name: l.p.name, trackExpiry: l.p.trackExpiry, costCents: l.p.costCents },
          l.qtyMilli,
          {
            type: 'SALE',
            actor,
            allowNegative: settings.stock.allowNegativeStock,
            allowExpired: settings.stock.allowExpiredSales,
            ref: { refType: 'Sale', refId: saleId, refNo: receiptNo },
          },
        );
        costs.set(String(l.p._id), r);
      }

      const items = lines.map((l, i) => {
        const pl = totals.lines[i];
        const c = costs.get(String(l.p._id))!;
        return {
          product: l.p._id,
          name: l.p.name,
          sku: l.p.sku,
          barcode: l.p.barcode,
          unitSymbol: l.p.unit.symbol,
          qtyMilli: l.qtyMilli,
          unitPriceCents: l.p.priceCents,
          unitCostCents: c.unitCostCents,
          grossCents: pl.grossCents,
          lineDiscountCents: pl.lineDiscountCents,
          orderDiscountShareCents: pl.orderDiscountShareCents,
          discountNote: l.note,
          taxCode: pl.taxCode,
          taxRateBps: pl.taxRateBps,
          taxCents: pl.taxCents,
          totalCents: pl.totalCents,
          allocations: c.allocations,
        };
      });

      await Sale.create(
        [
          {
            _id: saleId,
            receiptNo,
            cashier: actor,
            cashierName: user.name,
            register: shift ? (shift.register as unknown as { _id: mongoose.Types.ObjectId })._id : undefined,
            registerName: shift ? (shift.register as unknown as { name: string }).name : undefined,
            shift: shift?._id,
            customer: customer?._id,
            customerName: customer?.name,
            items,
            payments: applied.payments,
            subtotalCents: totals.subtotalCents,
            discountCents: totals.discountCents,
            taxCents: totals.taxCents,
            totalCents: totals.totalCents,
            changeCents: applied.changeCents,
            taxBreakdown: totals.taxBreakdown,
            priceIncludesTax: settings.priceIncludesTax,
            orderDiscountNote: orderNote,
            idempotencyKey,
          },
        ],
        { session },
      );

      if (customer) {
        await Customer.updateOne(
          { _id: customer._id },
          { $inc: { visitCount: 1, totalSpentCents: totals.totalCents }, $set: { lastVisitAt: now } },
          { session },
        );
      }
      await audit(
        user,
        'sale.create',
        'Sale',
        saleId,
        `Sale ${receiptNo} total ${totals.totalCents / 100}`,
        { total: totals.totalCents, items: items.length },
        session,
      );
      return { receiptNo, productIds: lines.map((l) => l.p._id) };
    });
  } catch (e) {
    if (isDuplicateKey(e)) {
      const again = await replay();
      if (again) return again;
      throw conflict('Duplicate request could not be resolved');
    }
    throw e;
  }

  await checkStockAlerts(result.productIds);
  if (input.heldId) await HeldSale.deleteOne({ _id: input.heldId, cashier: user.id });
  return { saleId: String(saleId), receiptNo: result.receiptNo, replayed: false };
}

/** Receipt payload with store snapshot; all values come from the persisted sale. */
export async function buildReceipt(saleId: string) {
  const [sale, settings] = await Promise.all([Sale.findById(saleId).lean(), getSettings()]);
  if (!sale) throw notFound('Sale');
  const s = settings.toObject();
  return {
    store: { ...s.store, currency: s.currency, timezone: s.timezone },
    receipt: { footer: s.receipt.footer, paperSize: s.receipt.paperSize },
    sale,
  };
}
