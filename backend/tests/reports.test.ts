import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, auth, login, makeProduct, openShift, seedUsers, sell, startDb, stopDb } from './helpers';
import { Notification } from '../src/database/models';
import { todayInZone } from '../src/utils/time';

let owner: string;
let cashier: string;

beforeAll(async () => {
  await startDb();
  await seedUsers();
  owner = (await login('owner@test.local')).token;
  cashier = (await login('cashier@test.local')).token;
  await request(app)
    .put('/api/v1/settings')
    .set(auth(owner))
    .send({ taxRates: [{ code: 'VAT', name: 'VAT', rateBps: 1000 }], priceIncludesTax: true });
  await openShift(cashier);
});
afterAll(stopDb);

describe('reports use persisted data with exact definitions', () => {
  it('computes sales, refunds, tax, COGS and gross profit', async () => {
    // price 11000 incl. 10% VAT -> net 10000, tax 1000; cost 6000
    const taxed = await makeProduct({ sku: 'RPT-A', price: 11000, cost: 6000, stock: 20, taxCode: 'VAT' });
    const plain = await makeProduct({ sku: 'RPT-B', price: 5000, cost: 3000, stock: 20 });
    const s1 = await sell(cashier, {
      items: [
        { product: String(taxed._id), quantity: 3 },
        { product: String(plain._id), quantity: 2 },
      ],
      payments: [{ method: 'CASH', amountCents: 50000 }],
    });
    expect(s1.body.data.sale.totalCents).toBe(43000);
    // refund 1 taxed unit, restocked
    const sale = s1.body.data.sale;
    const line = sale.items.find((i: { sku: string }) => i.sku === 'RPT-A');
    expect(
      (
        await request(app)
          .post('/api/v1/returns')
          .set(auth(cashier))
          .send({
            sale: sale._id,
            refundMethod: 'CASH',
            reason: 'Test refund',
            items: [{ saleItemId: line._id, quantity: 1, condition: 'RESTOCK' }],
          })
      ).status,
    ).toBe(201);

    const today = todayInZone('Asia/Colombo');
    const r = await request(app).get(`/api/v1/reports/sales?from=${today}&to=${today}`).set(auth(owner));
    expect(r.status).toBe(200);
    const s = r.body.data.summary;
    expect(s).toMatchObject({
      transactionCount: 1,
      grossSalesCents: 43000,
      taxCents: 3000,
      refundCents: 11000,
      refundTaxCents: 1000,
      netSalesCents: 32000,
      netSalesExTaxCents: 32000 - 2000, // (43000-3000) - (11000-1000)
    });
    // COGS: sold 3*6000 + 2*3000 = 24000, minus restocked return 6000
    expect(s.cogsCents).toBe(18000);
    expect(s.grossProfitCents).toBe(30000 - 18000);
    // series total agrees with the summary
    const series = r.body.data.series;
    expect(series.reduce((a: number, p: { grossProfitCents: number }) => a + p.grossProfitCents, 0)).toBe(
      s.grossProfitCents,
    );
    expect(r.body.data.payments).toEqual([{ method: 'CASH', amountCents: 43000, count: 1 }]);

    const prod = await request(app)
      .get(`/api/v1/reports/products?from=${today}&to=${today}`)
      .set(auth(owner));
    const a = prod.body.data.rows.find((x: { sku: string }) => x.sku === 'RPT-A');
    expect(a).toMatchObject({ qtyMilli: 2000, revenueCents: 22000 });
  });

  it('exports CSV and rejects non-privileged users', async () => {
    const csv = await request(app).get('/api/v1/reports/sales?format=csv').set(auth(owner));
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')[0]).toContain('period');
    expect((await request(app).get('/api/v1/reports/sales').set(auth(cashier))).status).toBe(403);
  });

  it('dashboard aggregates from the database and raises low-stock notifications', async () => {
    const p = await makeProduct({ sku: 'ALERT-1', stock: 3 });
    await request(app).put(`/api/v1/products/${p._id}`).set(auth(owner)); // 404 route guard, no side effects
    await request(app).patch(`/api/v1/products/${p._id}`).set(auth(owner)).send({ reorderLevel: 5 });
    await sell(cashier, {
      items: [{ product: String(p._id), quantity: 1 }],
      payments: [{ method: 'CASH', amountCents: 20000 }],
    });
    const n = await Notification.findOne({ dedupeKey: `low:${p._id}` });
    expect(n).toBeTruthy();
    expect(n!.type).toBe('LOW_STOCK');
    const d = await request(app).get('/api/v1/reports/dashboard').set(auth(owner));
    expect(d.status).toBe(200);
    expect(d.body.data.summary.transactionCount).toBeGreaterThan(0);
    expect(d.body.data.stock.lowStock).toBeGreaterThanOrEqual(1);
    expect(d.body.data.trends.daily.length).toBeGreaterThan(0);
    const list = await request(app).get('/api/v1/notifications').set(auth(cashier));
    expect(list.body.meta.unread).toBeGreaterThan(0);
    const id = list.body.data[0]._id;
    await request(app).post(`/api/v1/notifications/${id}/read`).set(auth(cashier));
    const after = await request(app).get('/api/v1/notifications/unread-count').set(auth(cashier));
    expect(after.body.data.unread).toBe(list.body.meta.unread - 1);
  });

  it('audits sensitive operations', async () => {
    const log = await request(app).get('/api/v1/audit-logs?limit=100').set(auth(owner));
    const actions = new Set(log.body.data.map((a: { action: string }) => a.action));
    for (const a of ['auth.login', 'sale.create', 'sale.refund', 'settings.update', 'shift.open'])
      expect(actions.has(a)).toBe(true);
    expect((await request(app).get('/api/v1/audit-logs').set(auth(cashier))).status).toBe(403);
  });
});
