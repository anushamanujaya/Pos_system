import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  app,
  auth,
  login,
  makeProduct,
  onHand,
  openShift,
  seedUsers,
  sell,
  startDb,
  stopDb,
} from './helpers';
import {
  IdempotencyRecord,
  InventoryBatch,
  Sale,
  StockMovement,
  Customer,
  Promotion,
} from '../src/database/models';

let owner: string;
let cashier: string;
let cashier2: string;

beforeAll(async () => {
  await startDb();
  await seedUsers();
  owner = (await login('owner@test.local')).token;
  cashier = (await login('cashier@test.local')).token;
  cashier2 = (await login('cashier2@test.local')).token;
  await request(app)
    .put('/api/v1/settings')
    .set(auth(owner))
    .send({
      taxRates: [{ code: 'VAT', name: 'Test VAT', rateBps: 1800 }],
      priceIncludesTax: true,
      store: { name: 'Test Mart' },
    });
  expect((await openShift(cashier)).status).toBe(201);
});
afterAll(stopDb);

const cash = (n: number) => [{ method: 'CASH', amountCents: n }];

describe('checkout', () => {
  it('requires an open shift', async () => {
    const p = await makeProduct({ sku: 'NOSHIFT', stock: 5 });
    const r = await sell(cashier2, {
      items: [{ product: String(p._id), quantity: 1 }],
      payments: cash(10000),
    });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('NO_OPEN_SHIFT');
    expect(await onHand(p._id)).toBe(5);
  });

  it('completes a sale: server-priced, stock deducted, movements + snapshot recorded', async () => {
    const p = await makeProduct({ sku: 'SALE-1', price: 11800, cost: 6000, stock: 10, taxCode: 'VAT' });
    const r = await sell(cashier, {
      items: [{ product: String(p._id), quantity: 2 }],
      payments: cash(30000),
      price: 1 /* ignored */,
    });
    expect(r.status).toBe(201);
    const sale = r.body.data.sale;
    expect(sale.totalCents).toBe(23600);
    expect(sale.taxCents).toBe(3600); // inclusive: 23600 - 23600/1.18
    expect(sale.changeCents).toBe(6400);
    expect(sale.items[0]).toMatchObject({
      unitPriceCents: 11800,
      unitCostCents: 6000,
      qtyMilli: 2000,
      name: 'Product SALE-1',
    });
    expect(r.body.data.receiptNo).toMatch(/^INV-\d{8}-\d{5}$/);
    expect(r.body.data.store.name).toBe('Test Mart');
    expect(await onHand(p._id)).toBe(8);
    const mv = await StockMovement.find({ product: p._id, type: 'SALE' });
    expect(mv).toHaveLength(1);
    expect(mv[0].qtyMilli).toBe(-2000);
    expect(mv[0].refNo).toBe(r.body.data.receiptNo);

    // later price changes never rewrite history
    await request(app).patch(`/api/v1/products/${p._id}`).set(auth(owner)).send({ priceCents: 99999 });
    const again = await Sale.findById(sale._id);
    expect(again!.items[0].unitPriceCents).toBe(11800);
  });

  it('rejects insufficient stock without side effects', async () => {
    const p = await makeProduct({ sku: 'LOW-1', stock: 2 });
    const r = await sell(cashier, {
      items: [{ product: String(p._id), quantity: 3 }],
      payments: cash(100000),
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await onHand(p._id)).toBe(2);
    expect(await Sale.countDocuments({ 'items.product': p._id })).toBe(0);
  });

  it('rolls the whole sale back when any line fails', async () => {
    const a = await makeProduct({ sku: 'RB-A', stock: 5 });
    const b = await makeProduct({ sku: 'RB-B', stock: 1 });
    const key = 'rollback-key-1';
    const r = await sell(
      cashier,
      {
        items: [
          { product: String(a._id), quantity: 2 },
          { product: String(b._id), quantity: 5 },
        ],
        payments: cash(500000),
      },
      key,
    );
    expect(r.status).toBe(409);
    expect(await onHand(a._id)).toBe(5); // deducted inside the tx, then rolled back
    expect(await onHand(b._id)).toBe(1);
    expect(await StockMovement.countDocuments({ product: a._id, type: 'SALE' })).toBe(0);
    expect(await IdempotencyRecord.countDocuments({ key })).toBe(0); // claim rolled back so the cashier can retry
  });

  it('is idempotent: the same key never double-charges or double-deducts', async () => {
    const p = await makeProduct({ sku: 'IDEM-1', stock: 10 });
    const body = { items: [{ product: String(p._id), quantity: 1 }], payments: cash(50000) };
    const [x, y, z] = await Promise.all([
      sell(cashier, body, 'same-key-123'),
      sell(cashier, body, 'same-key-123'),
      sell(cashier, body, 'same-key-123'),
    ]);
    const codes = [x.status, y.status, z.status].sort();
    expect(codes.every((c) => c === 200 || c === 201)).toBe(true);
    expect(new Set([x, y, z].map((r) => r.body.data.receiptNo)).size).toBe(1);
    expect(await Sale.countDocuments({ 'items.product': p._id })).toBe(1);
    expect(await onHand(p._id)).toBe(9);
    // same key, different payload is refused
    const diff = await sell(
      cashier,
      { ...body, items: [{ product: String(p._id), quantity: 2 }] },
      'same-key-123',
    );
    expect(diff.status).toBe(422);
    expect(diff.body.error.code).toBe('IDEMPOTENCY_MISMATCH');
  });

  it('requires an Idempotency-Key header', async () => {
    const p = await makeProduct({ sku: 'NOKEY', stock: 2 });
    const r = await request(app)
      .post('/api/v1/sales')
      .set(auth(cashier))
      .send({ items: [{ product: String(p._id), quantity: 1 }], payments: cash(50000) });
    expect(r.status).toBe(400);
  });

  it('cannot oversell under concurrent checkouts', async () => {
    const p = await makeProduct({ sku: 'CONC-1', stock: 5 });
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        sell(
          cashier,
          { items: [{ product: String(p._id), quantity: 1 }], payments: cash(20000) },
          `conc-${i}-abcdefgh`,
        ),
      ),
    );
    const okCount = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 409);
    expect(okCount).toBe(5);
    expect(rejected).toHaveLength(7);
    expect(rejected.every((r) => r.body.error.code === 'INSUFFICIENT_STOCK')).toBe(true);
    expect(await onHand(p._id)).toBe(0);
    expect(await Sale.countDocuments({ 'items.product': p._id })).toBe(5);
    const nos = (await Sale.find({ 'items.product': p._id })).map((s) => s.receiptNo);
    expect(new Set(nos).size).toBe(5); // unique receipt numbers under concurrency
  });

  it('applies FEFO and refuses expired batches', async () => {
    const p = await makeProduct({ sku: 'FEFO-1', stock: 4, trackExpiry: true, expiryDays: 20 });
    // add an earlier-expiring and an already-expired batch
    for (const [no, days, qty] of [
      ['SOON', 3, 3],
      ['OLD', -2, 5],
    ] as const) {
      await request(app)
        .post('/api/v1/inventory/adjust')
        .set(auth(owner))
        .send({
          product: String(p._id),
          type: 'ADJUSTMENT_IN',
          quantity: qty,
          reason: 'test batch',
          batchNo: no,
          expiryDate: new Date(Date.now() + days * 86400_000).toISOString(),
        });
    }
    const r = await sell(cashier, {
      items: [{ product: String(p._id), quantity: 5 }],
      payments: cash(500000),
    });
    expect(r.status).toBe(201);
    const left = Object.fromEntries(
      (await InventoryBatch.find({ product: p._id })).map((b) => [b.batchNo, b.remainingMilli / 1000]),
    );
    expect(left).toEqual({ SOON: 0, B1: 2, OLD: 5 }); // SOON first, then B1; expired OLD untouched
    const tooMany = await sell(cashier, {
      items: [{ product: String(p._id), quantity: 3 }],
      payments: cash(500000),
    });
    expect(tooMany.status).toBe(409); // only 2 sellable; 5 more are expired
  });

  it('validates discounts server-side and enforces override permission', async () => {
    const p = await makeProduct({ sku: 'DISC-1', price: 10000, stock: 20 });
    const items = (pct: number) => [
      { product: String(p._id), quantity: 1, discount: { type: 'PERCENT', percent: pct } },
    ];
    expect((await sell(cashier, { items: items(20), payments: cash(20000) })).status).toBe(403);
    const small = await sell(cashier, { items: items(5), payments: cash(20000) });
    expect(small.status).toBe(201);
    expect(small.body.data.sale.totalCents).toBe(9500);
    // owner (has discount.override) may go higher but never beyond the configured ceiling
    expect((await openShift(owner, 0, 'Owner register')).status).toBe(201);
    expect((await sell(owner, { items: items(20), payments: cash(20000) })).body.data.sale.totalCents).toBe(
      8000,
    );
    expect((await sell(owner, { items: items(80), payments: cash(20000) })).status).toBe(403);
  });

  it('applies active promotions automatically', async () => {
    const p = await makeProduct({ sku: 'PROMO-1', price: 20000, stock: 10 });
    await Promotion.create({
      name: 'Ten off',
      type: 'PERCENT',
      value: 1000,
      scope: 'PRODUCT',
      products: [p._id],
    });
    const r = await sell(cashier, {
      items: [{ product: String(p._id), quantity: 2 }],
      payments: cash(40000),
    });
    expect(r.body.data.sale.totalCents).toBe(36000);
    expect(r.body.data.sale.items[0].discountNote).toBe('Promo: Ten off');
  });

  it('records split payments and customer stats', async () => {
    const p = await makeProduct({ sku: 'SPLIT-1', price: 10000, stock: 5 });
    const c = await Customer.create({ code: 'C1', name: 'Test Cust', phone: '0770000000' });
    const r = await sell(cashier, {
      items: [{ product: String(p._id), quantity: 1 }],
      customer: String(c._id),
      payments: [
        { method: 'CARD', amountCents: 4000, reference: 'T-1' },
        { method: 'CASH', amountCents: 10000 },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.body.data.sale.changeCents).toBe(4000);
    expect(
      r.body.data.sale.payments.map((x: { method: string; amountCents: number }) => [
        x.method,
        x.amountCents,
      ]),
    ).toEqual([
      ['CARD', 4000],
      ['CASH', 6000],
    ]);
    const fresh = await Customer.findById(c._id);
    expect(fresh).toMatchObject({ visitCount: 1, totalSpentCents: 10000 });
    expect(
      (await sell(cashier, { items: [{ product: String(p._id), quantity: 1 }], payments: cash(100) })).status,
    ).toBe(422);
  });

  it('detects price changes via expectedTotalCents', async () => {
    const p = await makeProduct({ sku: 'PC-1', price: 10000, stock: 5 });
    const r = await sell(cashier, {
      items: [{ product: String(p._id), quantity: 1 }],
      payments: cash(10000),
      expectedTotalCents: 9000,
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PRICE_CHANGED');
    expect(r.body.error.details.totalCents).toBe(10000);
  });

  it('lets cashiers see only their own sales', async () => {
    await openShift(cashier2, 0).catch(() => undefined);
    const mine = await request(app).get('/api/v1/sales').set(auth(cashier));
    const theirs = await request(app).get('/api/v1/sales').set(auth(cashier2));
    expect(mine.body.meta.total).toBeGreaterThan(0);
    expect(theirs.body.meta.total).toBe(0);
    const id = mine.body.data[0]._id;
    expect((await request(app).get(`/api/v1/sales/${id}`).set(auth(cashier2))).status).toBe(403);
    expect((await request(app).get(`/api/v1/sales/${id}/receipt`).set(auth(owner))).status).toBe(200);
  });
});
