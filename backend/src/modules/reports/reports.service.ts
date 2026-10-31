import type { PipelineStage } from 'mongoose';
import {
  CashShift,
  GoodsReceipt,
  InventoryBatch,
  InventoryBalance,
  Product,
  PurchaseOrder,
  Sale,
  SaleReturn,
} from '../../database/models';
import { getSettings } from '../../services/common';
import { addDays, rangeForDays, todayInZone } from '../../utils/time';

/**
 * Definitions (documented in docs/ARCHITECTURE.md):
 *  - Gross sales      = sum of sale totals in range (tax-inclusive amount charged).
 *  - Refunds          = sum of return refunds *dated in range* (cash-basis: refunds reduce the period they are paid in).
 *  - Net sales        = gross sales - refunds, reported both with and without tax.
 *  - COGS             = unit-cost snapshot x qty on sold lines, minus cost of returned units that were restocked.
 *                       Damaged returns keep their cost (it is a real loss).
 *  - Gross profit     = net sales excluding tax - COGS.  (NOT net business profit: no overheads, wages, etc.)
 */
export interface Range {
  start: Date;
  end: Date;
  from: string;
  to: string;
  tz: string;
}

export async function resolveRange(from?: string, to?: string): Promise<Range> {
  const tz = (await getSettings()).timezone;
  const today = todayInZone(tz);
  const f = from ?? to ?? today;
  const t = to ?? from ?? today;
  const { start, end } = rangeForDays(f, t < f ? f : t, tz);
  return { start, end, from: f, to: t < f ? f : t, tz };
}

const costExpr = { $divide: [{ $multiply: ['$items.unitCostCents', '$items.qtyMilli'] }, 1000] };
const returnedCostExpr = {
  $cond: [
    '$items.restock',
    { $divide: [{ $multiply: ['$items.unitCostCents', '$items.qtyMilli'] }, 1000] },
    0,
  ],
};
const r0 = (e: unknown) => ({ $round: [e, 0] });

type Bucket = 'day' | 'week' | 'month';
const bucketExpr = (b: Bucket, tz: string, field = '$createdAt') => {
  if (b === 'month') return { $dateToString: { format: '%Y-%m', date: field, timezone: tz } };
  if (b === 'week')
    return {
      $dateToString: {
        format: '%Y-%m-%d',
        timezone: tz,
        date: { $dateTrunc: { date: field, unit: 'week', startOfWeek: 'monday', timezone: tz } },
      },
    };
  return { $dateToString: { format: '%Y-%m-%d', date: field, timezone: tz } };
};

export async function salesSummary(r: Range) {
  const match = { createdAt: { $gte: r.start, $lt: r.end } };
  const [s] = await Sale.aggregate([
    { $match: { ...match, status: 'COMPLETED' } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        subtotalCents: { $sum: '$subtotalCents' },
        discountCents: { $sum: '$discountCents' },
        taxCents: { $sum: '$taxCents' },
        grossCents: { $sum: '$totalCents' },
      },
    },
  ]);
  const [c] = await Sale.aggregate([
    { $match: { ...match, status: 'COMPLETED' } },
    { $unwind: '$items' },
    { $group: { _id: null, cogs: { $sum: costExpr } } },
  ]);
  const [ref] = await SaleReturn.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        refundCents: { $sum: '$refundCents' },
        refundTaxCents: { $sum: '$refundTaxCents' },
      },
    },
  ]);
  const [rc] = await SaleReturn.aggregate([
    { $match: match },
    { $unwind: '$items' },
    { $group: { _id: null, restockedCost: { $sum: returnedCostExpr } } },
  ]);

  const gross = s?.grossCents ?? 0;
  const tax = s?.taxCents ?? 0;
  const refunds = ref?.refundCents ?? 0;
  const refundTax = ref?.refundTaxCents ?? 0;
  const cogs = Math.round((c?.cogs ?? 0) - (rc?.restockedCost ?? 0));
  const netExTax = gross - tax - (refunds - refundTax);
  const count = s?.count ?? 0;
  return {
    transactionCount: count,
    subtotalCents: s?.subtotalCents ?? 0,
    discountCents: s?.discountCents ?? 0,
    grossSalesCents: gross,
    taxCents: tax,
    refundCount: ref?.count ?? 0,
    refundCents: refunds,
    refundTaxCents: refundTax,
    netSalesCents: gross - refunds,
    netSalesExTaxCents: netExTax,
    cogsCents: cogs,
    grossProfitCents: netExTax - cogs,
    averageTransactionCents: count ? Math.round(gross / count) : 0,
  };
}

export async function salesSeries(r: Range, bucket: Bucket) {
  const match = { createdAt: { $gte: r.start, $lt: r.end } };
  const [sales, cogs, refunds, restocked] = await Promise.all([
    Sale.aggregate([
      { $match: { ...match, status: 'COMPLETED' } },
      {
        $group: {
          _id: bucketExpr(bucket, r.tz),
          count: { $sum: 1 },
          grossCents: { $sum: '$totalCents' },
          taxCents: { $sum: '$taxCents' },
          discountCents: { $sum: '$discountCents' },
        },
      },
    ]),
    Sale.aggregate([
      { $match: { ...match, status: 'COMPLETED' } },
      { $unwind: '$items' },
      { $group: { _id: bucketExpr(bucket, r.tz), cogs: { $sum: costExpr } } },
    ]),
    SaleReturn.aggregate([
      { $match: match },
      {
        $group: {
          _id: bucketExpr(bucket, r.tz),
          refundCents: { $sum: '$refundCents' },
          refundTaxCents: { $sum: '$refundTaxCents' },
        },
      },
    ]),
    SaleReturn.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $group: { _id: bucketExpr(bucket, r.tz), cost: { $sum: returnedCostExpr } } },
    ]),
  ]);
  const map = new Map<
    string,
    {
      period: string;
      count: number;
      grossCents: number;
      taxCents: number;
      discountCents: number;
      refundCents: number;
      refundTaxCents: number;
      cogsCents: number;
    }
  >();
  const get = (k: string) => {
    if (!map.has(k))
      map.set(k, {
        period: k,
        count: 0,
        grossCents: 0,
        taxCents: 0,
        discountCents: 0,
        refundCents: 0,
        refundTaxCents: 0,
        cogsCents: 0,
      });
    return map.get(k)!;
  };
  sales.forEach((x) =>
    Object.assign(get(x._id), {
      count: x.count,
      grossCents: x.grossCents,
      taxCents: x.taxCents,
      discountCents: x.discountCents,
    }),
  );
  cogs.forEach((x) => {
    get(x._id).cogsCents += Math.round(x.cogs);
  });
  refunds.forEach((x) =>
    Object.assign(get(x._id), { refundCents: x.refundCents, refundTaxCents: x.refundTaxCents }),
  );
  restocked.forEach((x) => {
    get(x._id).cogsCents -= Math.round(x.cost);
  });
  return [...map.values()]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((p) => {
      const netExTax = p.grossCents - p.taxCents - (p.refundCents - p.refundTaxCents);
      return {
        ...p,
        netSalesCents: p.grossCents - p.refundCents,
        netSalesExTaxCents: netExTax,
        grossProfitCents: netExTax - p.cogsCents,
      };
    });
}

export async function categoryAgg(r: Range) {
  const pipeline: PipelineStage[] = [
    { $match: { createdAt: { $gte: r.start, $lt: r.end }, status: 'COMPLETED' } },
    { $unwind: '$items' },
    { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'p' } },
    { $addFields: { catId: { $first: '$p.category' } } },
    { $lookup: { from: 'categories', localField: 'catId', foreignField: '_id', as: 'c' } },
    {
      $group: {
        _id: { $ifNull: [{ $first: '$c.name' }, 'Uncategorised'] },
        qtyMilli: { $sum: { $subtract: ['$items.qtyMilli', '$items.returnedMilli'] } },
        revenueCents: { $sum: { $subtract: ['$items.totalCents', '$items.refundedCents'] } },
        taxCents: { $sum: '$items.taxCents' },
        cogsCents: { $sum: costExpr },
      },
    },
    { $project: { _id: 0, category: '$_id', qtyMilli: 1, revenueCents: 1, cogsCents: r0('$cogsCents') } },
    { $sort: { revenueCents: -1 } },
  ];
  return Sale.aggregate(pipeline);
}

export async function productPerformance(
  r: Range,
  limit = 50,
  sortBy: 'revenueCents' | 'qtyMilli' | 'profitCents' = 'revenueCents',
) {
  return Sale.aggregate([
    { $match: { createdAt: { $gte: r.start, $lt: r.end }, status: 'COMPLETED' } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product',
        name: { $last: '$items.name' },
        sku: { $last: '$items.sku' },
        qtyMilli: { $sum: { $subtract: ['$items.qtyMilli', '$items.returnedMilli'] } },
        revenueCents: { $sum: { $subtract: ['$items.totalCents', '$items.refundedCents'] } },
        cogsCents: {
          $sum: {
            $divide: [
              {
                $multiply: [
                  '$items.unitCostCents',
                  { $subtract: ['$items.qtyMilli', '$items.returnedMilli'] },
                ],
              },
              1000,
            ],
          },
        },
        taxCents: {
          $sum: {
            $divide: [
              { $multiply: ['$items.taxCents', { $subtract: ['$items.qtyMilli', '$items.returnedMilli'] }] },
              '$items.qtyMilli',
            ],
          },
        },
      },
    },
    {
      $addFields: {
        cogsCents: r0('$cogsCents'),
        taxCents: r0('$taxCents'),
        profitCents: r0({ $subtract: [{ $subtract: ['$revenueCents', '$taxCents'] }, '$cogsCents'] }),
      },
    },
    { $sort: { [sortBy]: -1, _id: 1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        product: { $toString: '$_id' },
        name: 1,
        sku: 1,
        qtyMilli: 1,
        revenueCents: 1,
        cogsCents: 1,
        profitCents: 1,
      },
    },
  ]);
}

export async function paymentMethods(r: Range) {
  return Sale.aggregate([
    { $match: { createdAt: { $gte: r.start, $lt: r.end }, status: 'COMPLETED' } },
    { $unwind: '$payments' },
    {
      $group: { _id: '$payments.method', amountCents: { $sum: '$payments.amountCents' }, count: { $sum: 1 } },
    },
    { $project: { _id: 0, method: '$_id', amountCents: 1, count: 1 } },
    { $sort: { amountCents: -1 } },
  ]);
}

export async function cashierPerformance(r: Range) {
  const match = { createdAt: { $gte: r.start, $lt: r.end } };
  const [sales, refunds] = await Promise.all([
    Sale.aggregate([
      { $match: { ...match, status: 'COMPLETED' } },
      {
        $group: {
          _id: '$cashier',
          name: { $last: '$cashierName' },
          count: { $sum: 1 },
          grossCents: { $sum: '$totalCents' },
          discountCents: { $sum: '$discountCents' },
        },
      },
    ]),
    SaleReturn.aggregate([
      { $match: match },
      { $group: { _id: '$processedBy', refundCents: { $sum: '$refundCents' }, refundCount: { $sum: 1 } } },
    ]),
  ]);
  const rm = new Map(refunds.map((x) => [String(x._id), x]));
  return sales
    .map((s) => ({
      cashier: String(s._id),
      name: s.name,
      transactionCount: s.count,
      grossCents: s.grossCents,
      discountCents: s.discountCents,
      refundCents: rm.get(String(s._id))?.refundCents ?? 0,
      refundCount: rm.get(String(s._id))?.refundCount ?? 0,
      averageCents: s.count ? Math.round(s.grossCents / s.count) : 0,
    }))
    .sort((a, b) => b.grossCents - a.grossCents);
}

export async function reconciliation(r: Range) {
  return CashShift.find({ status: 'CLOSED', closedAt: { $gte: r.start, $lt: r.end } })
    .sort({ closedAt: -1 })
    .populate('register', 'name')
    .populate('cashier', 'name')
    .lean();
}

export async function purchaseReport(r: Range) {
  const match = { createdAt: { $gte: r.start, $lt: r.end } };
  const [bySupplier, orders, receipts] = await Promise.all([
    PurchaseOrder.aggregate([
      { $match: { ...match, status: { $ne: 'CANCELLED' } } },
      { $group: { _id: '$supplier', orders: { $sum: 1 }, orderedCents: { $sum: '$totalCents' } } },
      { $lookup: { from: 'suppliers', localField: '_id', foreignField: '_id', as: 's' } },
      {
        $project: {
          _id: 0,
          supplier: { $toString: '$_id' },
          name: { $first: '$s.name' },
          orders: 1,
          orderedCents: 1,
        },
      },
      { $sort: { orderedCents: -1 } },
    ]),
    PurchaseOrder.find(match).sort({ createdAt: -1 }).limit(200).populate('supplier', 'name').lean(),
    GoodsReceipt.aggregate([
      { $match: match },
      { $group: { _id: '$supplier', receivedCents: { $sum: '$totalCents' }, receipts: { $sum: 1 } } },
    ]),
  ]);
  const rm = new Map(receipts.map((x) => [String(x._id), x]));
  return {
    bySupplier: bySupplier.map((s) => ({
      ...s,
      receivedCents: rm.get(s.supplier)?.receivedCents ?? 0,
      receipts: rm.get(s.supplier)?.receipts ?? 0,
    })),
    orders,
    totalOrderedCents: bySupplier.reduce((a, s) => a + s.orderedCents, 0),
    totalReceivedCents: receipts.reduce((a, s) => a + s.receivedCents, 0),
  };
}

export async function stockCounts() {
  const [lowOut] = await Product.aggregate([
    { $match: { status: 'ACTIVE' } },
    { $lookup: { from: 'inventorybalances', localField: '_id', foreignField: 'product', as: 'b' } },
    { $addFields: { qty: { $ifNull: [{ $first: '$b.onHandMilli' }, 0] } } },
    {
      $group: {
        _id: null,
        out: { $sum: { $cond: [{ $lte: ['$qty', 0] }, 1, 0] } },
        low: {
          $sum: { $cond: [{ $and: [{ $gt: ['$qty', 0] }, { $lte: ['$qty', '$reorderLevelMilli'] }] }, 1, 0] },
        },
      },
    },
  ]);
  const settings = await getSettings();
  const soon = new Date(Date.now() + settings.stock.expiryAlertDays * 86400_000);
  const [expiring, expired] = await Promise.all([
    InventoryBatch.countDocuments({
      remainingMilli: { $gt: 0 },
      expiryDate: { $gt: new Date(), $lte: soon },
    }),
    InventoryBatch.countDocuments({ remainingMilli: { $gt: 0 }, expiryDate: { $lte: new Date() } }),
  ]);
  return { lowStock: lowOut?.low ?? 0, outOfStock: lowOut?.out ?? 0, expiring, expired };
}

export async function lowStockRows() {
  return Product.aggregate([
    { $match: { status: 'ACTIVE' } },
    { $lookup: { from: 'inventorybalances', localField: '_id', foreignField: 'product', as: 'b' } },
    { $addFields: { onHandMilli: { $ifNull: [{ $first: '$b.onHandMilli' }, 0] } } },
    { $match: { $expr: { $lte: ['$onHandMilli', '$reorderLevelMilli'] } } },
    { $lookup: { from: 'categories', localField: 'category', foreignField: '_id', as: 'c' } },
    {
      $project: {
        _id: 0,
        id: { $toString: '$_id' },
        name: 1,
        sku: 1,
        category: { $first: '$c.name' },
        onHandMilli: 1,
        reorderLevelMilli: 1,
        costCents: 1,
      },
    },
    { $sort: { onHandMilli: 1, name: 1 } },
    { $limit: 500 },
  ]);
}

export async function expiringRows(days: number) {
  const soon = new Date(Date.now() + days * 86400_000);
  return InventoryBatch.find({ remainingMilli: { $gt: 0 }, expiryDate: { $lte: soon } })
    .sort({ expiryDate: 1 })
    .limit(300)
    .populate('product', 'name sku costCents')
    .lean();
}

export async function inventoryValue() {
  const [v] = await InventoryBalance.aggregate([
    { $match: { onHandMilli: { $gt: 0 } } },
    { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'p' } },
    { $unwind: '$p' },
    {
      $group: {
        _id: null,
        cost: { $sum: { $multiply: ['$onHandMilli', '$p.costCents', 0.001] } },
        retail: { $sum: { $multiply: ['$onHandMilli', '$p.priceCents', 0.001] } },
      },
    },
  ]);
  return { costValueCents: Math.round(v?.cost ?? 0), retailValueCents: Math.round(v?.retail ?? 0) };
}

export async function dashboard(from?: string, to?: string) {
  const range = await resolveRange(from, to);
  const tz = range.tz;
  const today = todayInZone(tz);
  const end = range.to;
  const trendDaily = rangeForDays(addDays(end, -29), end, tz);
  const trendWeekly = rangeForDays(addDays(end, -7 * 11), end, tz);
  const trendMonthly = rangeForDays(addDays(end, -365), end, tz);
  const mk = (x: { start: Date; end: Date }): Range => ({ ...x, from: '', to: '', tz });
  const [summary, daily, weekly, monthly, categories, payments, top, recent, stock, cash, vs] =
    await Promise.all([
      salesSummary(range),
      salesSeries(mk(trendDaily), 'day'),
      salesSeries(mk(trendWeekly), 'week'),
      salesSeries(mk(trendMonthly), 'month'),
      categoryAgg(range),
      paymentMethods(range),
      productPerformance(range, 8, 'qtyMilli'),
      Sale.find({ createdAt: { $gte: range.start, $lt: range.end } })
        .select('receiptNo totalCents cashierName createdAt status payments.method')
        .sort({ createdAt: -1 })
        .limit(8)
        .lean(),
      stockCounts(),
      CashShift.find({ status: 'OPEN' }).populate('register', 'name').populate('cashier', 'name').lean(),
      inventoryValue(),
    ]);
  return {
    range: { from: range.from, to: range.to, today, timezone: tz },
    summary,
    trends: { daily, weekly, monthly },
    categories,
    payments,
    topProducts: top,
    recentSales: recent,
    stock,
    openShifts: cash,
    inventoryValue: vs,
    expiring: (await expiringRows(14)).slice(0, 6),
    lowStock: (await lowStockRows()).slice(0, 6),
  };
}
