import type { ClientSession, Types } from 'mongoose';
import {
  InventoryBalance,
  InventoryBatch,
  Product,
  StockMovement,
  type MovementType,
} from '../database/models';
import { AppError } from '../utils/errors';
import { mulDiv } from '../utils/money';
import { raiseNotification, resolveNotification } from './common';

export interface MovementRef {
  refType?: 'Sale' | 'SaleReturn' | 'GoodsReceipt' | 'Adjustment';
  refId?: Types.ObjectId;
  refNo?: string;
  reason?: string;
}

export interface Allocation {
  batch?: Types.ObjectId;
  qtyMilli: number;
  costCents: number;
}

export const insufficientStock = (name: string, availableMilli: number, requestedMilli: number) =>
  new AppError(409, 'INSUFFICIENT_STOCK', `Insufficient stock for ${name}`, {
    product: name,
    available: availableMilli / 1000,
    requested: requestedMilli / 1000,
  });

/**
 * Add stock. Creates a batch for expiry-tracked products and keeps product.costCents as a moving weighted-average cost.
 * Must run inside the caller's transaction.
 */
export async function addStock(
  session: ClientSession,
  p: { id: Types.ObjectId; trackExpiry: boolean; costCents: number },
  qtyMilli: number,
  o: {
    type: Extract<MovementType, 'PURCHASE_RECEIPT' | 'ADJUSTMENT_IN' | 'SALE_RETURN'>;
    unitCostCents?: number;
    batchNo?: string;
    expiryDate?: Date;
    batchId?: Types.ObjectId;
    actor: Types.ObjectId | string;
    ref?: MovementRef;
  },
) {
  const unitCost = o.unitCostCents ?? p.costCents;
  const bal = await InventoryBalance.findOneAndUpdate(
    { product: p.id },
    { $inc: { onHandMilli: qtyMilli } },
    { upsert: true, new: true, session },
  );
  const before = bal.onHandMilli - qtyMilli;

  let batchId = o.batchId;
  if (batchId) {
    await InventoryBatch.updateOne({ _id: batchId }, { $inc: { remainingMilli: qtyMilli } }, { session });
  } else if (p.trackExpiry) {
    if (!o.expiryDate)
      throw new AppError(400, 'EXPIRY_REQUIRED', 'Expiry date is required for expiry-tracked products');
    const batchNo = o.batchNo || `B${Date.now().toString(36).toUpperCase()}`;
    const existing = await InventoryBatch.findOneAndUpdate(
      { product: p.id, batchNo, expiryDate: o.expiryDate },
      { $inc: { remainingMilli: qtyMilli, receivedMilli: qtyMilli } },
      { new: true, session },
    );
    if (existing) batchId = existing._id;
    else {
      const [b] = await InventoryBatch.create(
        [
          {
            product: p.id,
            batchNo,
            expiryDate: o.expiryDate,
            receivedMilli: qtyMilli,
            remainingMilli: qtyMilli,
            costCents: unitCost,
            receipt: o.ref?.refType === 'GoodsReceipt' ? o.ref.refId : undefined,
          },
        ],
        { session },
      );
      batchId = b._id;
    }
  }

  // Moving weighted-average cost only on purchases/adjustments in at a known cost.
  if (o.type !== 'SALE_RETURN' && o.unitCostCents !== undefined && before + qtyMilli > 0) {
    const base = Math.max(before, 0);
    const avg = base === 0 ? unitCost : mulDiv(base * p.costCents + qtyMilli * unitCost, 1, base + qtyMilli);
    await Product.updateOne({ _id: p.id }, { $set: { costCents: avg } }, { session });
  }

  await StockMovement.create(
    [
      {
        product: p.id,
        type: o.type,
        qtyMilli,
        balanceAfterMilli: bal.onHandMilli,
        batch: batchId,
        unitCostCents: unitCost,
        actor: o.actor,
        ...o.ref,
      },
    ],
    { session },
  );
  return { balanceAfterMilli: bal.onHandMilli, batch: batchId };
}

/**
 * Remove stock atomically. The balance decrement is conditional (`onHandMilli >= qty`) so two concurrent
 * transactions can never both succeed against the same units; the loser gets a write conflict (retried by
 * withTransaction) and then fails the condition. Expiry-tracked products are allocated FEFO from non-expired batches.
 */
export async function removeStock(
  session: ClientSession,
  p: { id: Types.ObjectId; name: string; trackExpiry: boolean; costCents: number },
  qtyMilli: number,
  o: {
    type: Extract<MovementType, 'SALE' | 'ADJUSTMENT_OUT' | 'DAMAGED' | 'EXPIRED' | 'PURCHASE_RETURN'>;
    actor: Types.ObjectId | string;
    ref?: MovementRef;
    allowNegative?: boolean;
    allowExpired?: boolean;
    batchId?: Types.ObjectId;
  },
): Promise<{ allocations: Allocation[]; unitCostCents: number; balanceAfterMilli: number }> {
  const cond = o.allowNegative ? { product: p.id } : { product: p.id, onHandMilli: { $gte: qtyMilli } };
  const bal = await InventoryBalance.findOneAndUpdate(
    cond,
    { $inc: { onHandMilli: -qtyMilli } },
    { new: true, session },
  );
  if (!bal) {
    const cur = await InventoryBalance.findOne({ product: p.id }).session(session).lean();
    throw insufficientStock(p.name, cur?.onHandMilli ?? 0, qtyMilli);
  }

  const allocations: Allocation[] = [];
  if (p.trackExpiry) {
    let need = qtyMilli;
    const now = new Date();
    const filter: Record<string, unknown> = { product: p.id, remainingMilli: { $gt: 0 } };
    if (o.batchId) filter._id = o.batchId;
    else if (!o.allowExpired) filter.$or = [{ expiryDate: null }, { expiryDate: { $gt: now } }];
    const batches = await InventoryBatch.find(filter).sort({ expiryDate: 1, receivedAt: 1 }).session(session);
    for (const b of batches) {
      if (need === 0) break;
      const take = Math.min(need, b.remainingMilli);
      const r = await InventoryBatch.updateOne(
        { _id: b._id, remainingMilli: { $gte: take } },
        { $inc: { remainingMilli: -take } },
        { session },
      );
      if (r.modifiedCount !== 1) throw insufficientStock(p.name, 0, qtyMilli);
      allocations.push({ batch: b._id, qtyMilli: take, costCents: b.costCents ?? p.costCents });
      need -= take;
    }
    if (need > 0 && !o.allowNegative) {
      // Enough on hand overall, but part of it is expired/locked: not sellable.
      throw insufficientStock(p.name, qtyMilli - need, qtyMilli);
    }
    if (need > 0) allocations.push({ qtyMilli: need, costCents: p.costCents });
  } else {
    allocations.push({ qtyMilli, costCents: p.costCents });
  }

  const unitCostCents = mulDiv(
    allocations.reduce((a, x) => a + x.costCents * x.qtyMilli, 0),
    1,
    qtyMilli,
  );
  // one movement per allocation keeps batch-level history exact
  await StockMovement.create(
    allocations.map((a, i) => ({
      product: p.id,
      type: o.type,
      qtyMilli: -a.qtyMilli,
      balanceAfterMilli: bal.onHandMilli + allocations.slice(i + 1).reduce((s, x) => s + x.qtyMilli, 0),
      batch: a.batch,
      unitCostCents: a.costCents,
      actor: o.actor,
      ...o.ref,
    })),
    { session, ordered: true },
  );
  return { allocations, unitCostCents, balanceAfterMilli: bal.onHandMilli };
}

/** Re-evaluate low/out-of-stock notifications for the products touched by an operation (after commit). */
export async function checkStockAlerts(productIds: (Types.ObjectId | string)[]) {
  if (productIds.length === 0) return;
  const prods = await Product.find({ _id: { $in: productIds }, status: 'ACTIVE' }).lean();
  const bals = await InventoryBalance.find({ product: { $in: productIds } }).lean();
  const m = new Map(bals.map((b) => [String(b.product), b.onHandMilli]));
  for (const p of prods) {
    const qty = m.get(String(p._id)) ?? 0;
    const link = `/inventory?product=${p._id}`;
    if (qty <= 0) {
      await resolveNotification(`low:${p._id}`);
      await raiseNotification({
        type: 'OUT_OF_STOCK',
        severity: 'critical',
        title: `Out of stock: ${p.name}`,
        message: `${p.sku} has no stock remaining`,
        link,
        dedupeKey: `out:${p._id}`,
      });
    } else if (qty <= p.reorderLevelMilli) {
      await resolveNotification(`out:${p._id}`);
      await raiseNotification({
        type: 'LOW_STOCK',
        severity: 'warning',
        title: `Low stock: ${p.name}`,
        message: `${(qty / 1000).toString()} left (reorder level ${(p.reorderLevelMilli / 1000).toString()})`,
        link,
        dedupeKey: `low:${p._id}`,
      });
    } else {
      await Promise.all([resolveNotification(`out:${p._id}`), resolveNotification(`low:${p._id}`)]);
    }
  }
}

/** Raises notifications for batches nearing/after expiry. Run on a schedule and on demand. */
export async function scanExpiry(alertDays: number) {
  const now = new Date();
  const soon = new Date(now.getTime() + alertDays * 86400_000);
  const batches = await InventoryBatch.find({ remainingMilli: { $gt: 0 }, expiryDate: { $lte: soon } })
    .populate('product', 'name sku')
    .lean();
  for (const b of batches) {
    const prod = b.product as unknown as { _id: Types.ObjectId; name: string; sku: string } | null;
    if (!prod || !b.expiryDate) continue;
    const expired = b.expiryDate <= now;
    await raiseNotification({
      type: expired ? 'EXPIRED' : 'EXPIRING',
      severity: expired ? 'critical' : 'warning',
      title: `${expired ? 'Expired' : 'Expiring'}: ${prod.name} (batch ${b.batchNo})`,
      message: `${b.remainingMilli / 1000} units, expiry ${b.expiryDate.toISOString().slice(0, 10)}`,
      link: `/inventory/batches?product=${prod._id}`,
      dedupeKey: `exp:${b._id}:${expired ? 'x' : 's'}`,
    });
  }
  return batches.length;
}
