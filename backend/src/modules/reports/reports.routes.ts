import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth';
import { query } from '../../middleware/validate';
import { toCsv } from '../../utils/csv';
import { ok, wrap } from '../../utils/http';
import * as svc from './reports.service';

export const reportsRouter = Router();
reportsRouter.use(authenticate, requirePermission('reports.read'));

const rangeQ = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  bucket: z.enum(['day', 'week', 'month']).default('day'),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  sort: z.enum(['revenueCents', 'qtyMilli', 'profitCents']).default('revenueCents'),
  days: z.coerce.number().int().min(1).max(365).default(30),
  format: z.enum(['json', 'csv']).default('json'),
});

const money = (c: number) => (c / 100).toFixed(2);
function send(req: Request, res: Response, name: string, data: unknown, rows: Record<string, unknown>[]) {
  if (req.query.format === 'csv') {
    res
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${name}.csv"`)
      .send(toCsv(rows));
    return;
  }
  ok(res, data);
}

reportsRouter.get(
  '/dashboard',
  wrap(async (req, res) => {
    const q = query(rangeQ, req);
    ok(res, await svc.dashboard(q.from, q.to));
  }),
);

reportsRouter.get(
  '/sales',
  wrap(async (req, res) => {
    const q = query(rangeQ, req);
    const r = await svc.resolveRange(q.from, q.to);
    const [summary, series, byCategory, payments, cashiers] = await Promise.all([
      svc.salesSummary(r),
      svc.salesSeries(r, q.bucket),
      svc.categoryAgg(r),
      svc.paymentMethods(r),
      svc.cashierPerformance(r),
    ]);
    send(
      req,
      res,
      'sales-report',
      { range: { from: r.from, to: r.to, timezone: r.tz }, summary, series, byCategory, payments, cashiers },
      series.map((p) => ({
        period: p.period,
        transactions: p.count,
        gross: money(p.grossCents),
        tax: money(p.taxCents),
        discounts: money(p.discountCents),
        refunds: money(p.refundCents),
        net: money(p.netSalesCents),
        netExTax: money(p.netSalesExTaxCents),
        cogs: money(p.cogsCents),
        grossProfit: money(p.grossProfitCents),
      })),
    );
  }),
);

reportsRouter.get(
  '/products',
  wrap(async (req, res) => {
    const q = query(rangeQ, req);
    const r = await svc.resolveRange(q.from, q.to);
    const rows = await svc.productPerformance(r, q.limit, q.sort);
    send(
      req,
      res,
      'product-performance',
      { range: { from: r.from, to: r.to }, rows },
      rows.map((p) => ({
        sku: p.sku,
        product: p.name,
        quantity: p.qtyMilli / 1000,
        revenue: money(p.revenueCents),
        cogs: money(p.cogsCents),
        profit: money(p.profitCents),
      })),
    );
  }),
);

reportsRouter.get(
  '/profit',
  wrap(async (req, res) => {
    const q = query(rangeQ, req);
    const r = await svc.resolveRange(q.from, q.to);
    const [summary, series, byCategory] = await Promise.all([
      svc.salesSummary(r),
      svc.salesSeries(r, q.bucket),
      svc.categoryAgg(r),
    ]);
    send(
      req,
      res,
      'profit-report',
      {
        range: { from: r.from, to: r.to },
        summary,
        series,
        byCategory,
        note: 'Gross profit = net sales excluding tax minus cost of goods sold. It is not net business profit.',
      },
      series.map((p) => ({
        period: p.period,
        netExTax: money(p.netSalesExTaxCents),
        cogs: money(p.cogsCents),
        grossProfit: money(p.grossProfitCents),
      })),
    );
  }),
);

reportsRouter.get(
  '/inventory',
  wrap(async (req, res) => {
    const q = query(rangeQ, req);
    const [low, expiring, value, counts] = await Promise.all([
      svc.lowStockRows(),
      svc.expiringRows(q.days),
      svc.inventoryValue(),
      svc.stockCounts(),
    ]);
    send(
      req,
      res,
      'inventory-report',
      { low, expiring, value, counts },
      low.map((p) => ({
        sku: p.sku,
        product: p.name,
        category: p.category,
        onHand: p.onHandMilli / 1000,
        reorderLevel: p.reorderLevelMilli / 1000,
      })),
    );
  }),
);

reportsRouter.get(
  '/purchases',
  wrap(async (req, res) => {
    const q = query(rangeQ, req);
    const r = await svc.resolveRange(q.from ?? '1970-01-01', q.to);
    const data = await svc.purchaseReport(r);
    send(
      req,
      res,
      'purchase-report',
      { range: { from: r.from, to: r.to }, ...data },
      data.bySupplier.map((s) => ({
        supplier: s.name,
        orders: s.orders,
        ordered: money(s.orderedCents),
        received: money(s.receivedCents),
      })),
    );
  }),
);

reportsRouter.get(
  '/cashiers',
  wrap(async (req, res) => {
    const q = query(rangeQ, req);
    const r = await svc.resolveRange(q.from, q.to);
    const rows = await svc.cashierPerformance(r);
    send(
      req,
      res,
      'cashier-report',
      { range: { from: r.from, to: r.to }, rows },
      rows.map((c) => ({
        cashier: c.name,
        transactions: c.transactionCount,
        gross: money(c.grossCents),
        discounts: money(c.discountCents),
        refunds: money(c.refundCents),
        average: money(c.averageCents),
      })),
    );
  }),
);

reportsRouter.get(
  '/reconciliation',
  wrap(async (req, res) => {
    const q = query(rangeQ, req);
    const r = await svc.resolveRange(q.from, q.to);
    const rows = await svc.reconciliation(r);
    send(
      req,
      res,
      'cash-reconciliation',
      { range: { from: r.from, to: r.to }, rows },
      rows.map((s) => ({
        register: (s.register as unknown as { name: string })?.name,
        cashier: (s.cashier as unknown as { name: string })?.name,
        opened: s.openedAt,
        closed: s.closedAt,
        float: money(s.openingFloatCents),
        expected: money(s.expectedCashCents ?? 0),
        counted: money(s.countedCashCents ?? 0),
        variance: money(s.varianceCents ?? 0),
      })),
    );
  }),
);
