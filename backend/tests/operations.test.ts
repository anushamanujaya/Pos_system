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
import { Supplier, StockMovement, Sale, CashShift, SaleReturn, CashRegister } from '../src/database/models';

let owner: string;
let manager: string;
let cashier: string;
let cashier2: string;

beforeAll(async () => {
  await startDb();
  await seedUsers();
  owner = (await login('owner@test.local')).token;
  manager = (await login('manager@test.local')).token;
  cashier = (await login('cashier@test.local')).token;
  cashier2 = (await login('cashier2@test.local')).token;
  await request(app)
    .put('/api/v1/settings')
    .set(auth(owner))
    .send({ taxRates: [{ code: 'VAT', name: 'VAT', rateBps: 1800 }], priceIncludesTax: true });
});
afterAll(stopDb);

describe('purchase orders & receiving', () => {
  it('supports draft -> ordered -> partial -> full receipt with consistent stock', async () => {
    const sup = await Supplier.create({ name: 'PO Supplier' });
    const p = await makeProduct({ sku: 'PO-1', cost: 5000 });
    const create = await request(app)
      .post('/api/v1/purchases')
      .set(auth(manager))
      .send({
        supplier: String(sup._id),
        items: [{ product: String(p._id), quantity: 10, costCents: 6000 }],
      });
    expect(create.status).toBe(201);
    expect(create.body.data).toMatchObject({ status: 'DRAFT', totalCents: 60000 });
    const id = create.body.data._id;
    expect(
      (
        await request(app)
          .post(`/api/v1/purchases/${id}/receive`)
          .set(auth(manager))
          .send({ items: [{ product: String(p._id), quantity: 1 }] })
      ).status,
    ).toBe(409); // draft can't be received
    expect(
      (await request(app).post(`/api/v1/purchases/${id}/submit`).set(auth(manager))).body.data.status,
    ).toBe('ORDERED');

    const part = await request(app)
      .post(`/api/v1/purchases/${id}/receive`)
      .set(auth(manager))
      .send({ items: [{ product: String(p._id), quantity: 4 }], supplierInvoiceRef: 'INV-77' });
    expect(part.status).toBe(201);
    expect(await onHand(p._id)).toBe(4);
    let po = await request(app).get(`/api/v1/purchases/${id}`).set(auth(manager));
    expect(po.body.data.status).toBe('PARTIALLY_RECEIVED');
    expect(po.body.data.supplierInvoiceRef).toBe('INV-77');

    const over = await request(app)
      .post(`/api/v1/purchases/${id}/receive`)
      .set(auth(manager))
      .send({ items: [{ product: String(p._id), quantity: 7 }] });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('OVER_RECEIPT');
    expect(await onHand(p._id)).toBe(4);

    expect(
      (
        await request(app)
          .post(`/api/v1/purchases/${id}/receive`)
          .set(auth(manager))
          .send({ items: [{ product: String(p._id), quantity: 6 }] })
      ).status,
    ).toBe(201);
    po = await request(app).get(`/api/v1/purchases/${id}`).set(auth(manager));
    expect(po.body.data.status).toBe('RECEIVED');
    expect(po.body.data.receipts).toHaveLength(2);
    expect(await onHand(p._id)).toBe(10);
    // weighted-average cost moves to the purchase cost (no prior stock)
    expect((await request(app).get(`/api/v1/products/${p._id}`).set(auth(manager))).body.data.costCents).toBe(
      6000,
    );
    // movements tie back to receipts
    const mv = await StockMovement.find({ product: p._id });
    expect(mv.reduce((a, m) => a + m.qtyMilli, 0)).toBe(10000);
    expect(mv.every((m) => m.type === 'PURCHASE_RECEIPT' && m.refNo?.startsWith('GRN-'))).toBe(true);
    // cannot cancel after receipt
    expect((await request(app).post(`/api/v1/purchases/${id}/cancel`).set(auth(manager))).status).toBe(409);
  });

  it('concurrent receipts cannot exceed the ordered quantity', async () => {
    const sup = await Supplier.create({ name: 'Race Supplier' });
    const p = await makeProduct({ sku: 'PO-RACE' });
    const po = await request(app)
      .post('/api/v1/purchases')
      .set(auth(manager))
      .send({
        supplier: String(sup._id),
        submit: true,
        items: [{ product: String(p._id), quantity: 10, costCents: 100 }],
      });
    const rs = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app)
          .post(`/api/v1/purchases/${po.body.data._id}/receive`)
          .set(auth(manager))
          .send({ items: [{ product: String(p._id), quantity: 4 }] }),
      ),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(2); // 4 + 4 = 8 <= 10, a third would be 12
    expect(await onHand(p._id)).toBe(8);
  });

  it('requires expiry date for expiry-tracked products and creates batches', async () => {
    const sup = await Supplier.create({ name: 'Dairy Supplier' });
    const p = await makeProduct({ sku: 'EXP-PO', trackExpiry: true });
    const direct = (extra: object) =>
      request(app)
        .post('/api/v1/purchases/receive-direct')
        .set(auth(manager))
        .send({
          supplier: String(sup._id),
          items: [{ product: String(p._id), quantity: 6, costCents: 500, ...extra }],
        });
    expect((await direct({})).status).toBe(400);
    expect(await onHand(p._id)).toBe(0);
    const ok = await direct({
      batchNo: 'L1',
      expiryDate: new Date(Date.now() + 5 * 86400_000).toISOString(),
    });
    expect(ok.status).toBe(201);
    const batches = await request(app).get(`/api/v1/inventory/batches?product=${p._id}`).set(auth(manager));
    expect(batches.body.data[0]).toMatchObject({ batchNo: 'L1', remainingMilli: 6000, status: 'expiring' });
  });

  it('forbids cashiers from purchasing and receiving', async () => {
    expect((await request(app).get('/api/v1/purchases').set(auth(cashier))).status).toBe(403);
    expect(
      (await request(app).post('/api/v1/purchases/receive-direct').set(auth(cashier)).send({})).status,
    ).toBe(403);
  });
});

describe('returns & refunds', () => {
  it('processes partial then final refund; blocks over-refund; restocks or writes off damaged', async () => {
    expect((await openShift(cashier)).status).toBe(201);
    const p = await makeProduct({ sku: 'RET-1', price: 11800, cost: 7000, stock: 10, taxCode: 'VAT' });
    const sale = await sell(cashier, {
      items: [{ product: String(p._id), quantity: 4 }],
      payments: [{ method: 'CASH', amountCents: 50000 }],
    });
    const saleId = sale.body.data.sale._id;
    const itemId = sale.body.data.sale.items[0]._id;
    expect(sale.body.data.sale.totalCents).toBe(47200);
    expect(await onHand(p._id)).toBe(6);

    const r1 = await request(app)
      .post('/api/v1/returns')
      .set(auth(cashier))
      .send({
        sale: saleId,
        refundMethod: 'CASH',
        reason: 'Customer changed mind',
        items: [{ saleItemId: itemId, quantity: 1, condition: 'RESTOCK' }],
      });
    expect(r1.status).toBe(201);
    expect(r1.body.data.refundCents).toBe(11800);
    expect(r1.body.data.refundTaxCents).toBe(1800);
    expect(await onHand(p._id)).toBe(7);

    const r2 = await request(app)
      .post('/api/v1/returns')
      .set(auth(cashier))
      .send({
        sale: saleId,
        refundMethod: 'CASH',
        reason: 'Damaged on arrival',
        items: [{ saleItemId: itemId, quantity: 1, condition: 'DAMAGED' }],
      });
    expect(r2.status).toBe(201);
    expect(await onHand(p._id)).toBe(7); // damaged units never become saleable
    const dm = await StockMovement.find({ product: p._id, type: 'DAMAGED', refType: 'SaleReturn' });
    expect(dm).toHaveLength(1);

    const tooMany = await request(app)
      .post('/api/v1/returns')
      .set(auth(cashier))
      .send({
        sale: saleId,
        refundMethod: 'CASH',
        reason: 'Too many',
        items: [{ saleItemId: itemId, quantity: 3, condition: 'RESTOCK' }],
      });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.code).toBe('OVER_REFUND');

    const last = await request(app)
      .post('/api/v1/returns')
      .set(auth(cashier))
      .send({
        sale: saleId,
        refundMethod: 'CASH',
        reason: 'Rest',
        items: [{ saleItemId: itemId, quantity: 2, condition: 'RESTOCK' }],
      });
    expect(last.status).toBe(201);
    const after = await Sale.findById(saleId);
    expect(after!.refundedCents).toBe(47200); // exact total, no rounding leftovers
    expect(after!.items[0].returnedMilli).toBe(4000);
    expect(await onHand(p._id)).toBe(9);
    const dup = await request(app)
      .post('/api/v1/returns')
      .set(auth(cashier))
      .send({
        sale: saleId,
        refundMethod: 'CASH',
        reason: 'Again',
        items: [{ saleItemId: itemId, quantity: 1, condition: 'RESTOCK' }],
      });
    expect(dup.status).toBe(422);
    expect(await SaleReturn.countDocuments({ sale: saleId })).toBe(3);
  });

  it('simultaneous refund attempts cannot refund the same units twice', async () => {
    const p = await makeProduct({ sku: 'RET-RACE', price: 10000, stock: 5 });
    const sale = await sell(cashier, {
      items: [{ product: String(p._id), quantity: 1 }],
      payments: [{ method: 'CASH', amountCents: 10000 }],
    });
    const body = {
      sale: sale.body.data.sale._id,
      refundMethod: 'CASH',
      reason: 'Race refund',
      items: [{ saleItemId: sale.body.data.sale.items[0]._id, quantity: 1, condition: 'RESTOCK' }],
    };
    const rs = await Promise.all(
      [1, 2, 3].map(() => request(app).post('/api/v1/returns').set(auth(cashier)).send(body)),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await onHand(p._id)).toBe(5);
    expect((await Sale.findById(sale.body.data.sale._id))!.refundedCents).toBe(10000);
  });

  it('refuses refunding by a method that was not used to pay', async () => {
    const p = await makeProduct({ sku: 'RET-M', price: 10000, stock: 5 });
    const sale = await sell(cashier, {
      items: [{ product: String(p._id), quantity: 1 }],
      payments: [{ method: 'CASH', amountCents: 10000 }],
    });
    const r = await request(app)
      .post('/api/v1/returns')
      .set(auth(cashier))
      .send({
        sale: sale.body.data.sale._id,
        refundMethod: 'CARD',
        reason: 'Wrong method',
        items: [{ saleItemId: sale.body.data.sale.items[0]._id, quantity: 1, condition: 'RESTOCK' }],
      });
    expect(r.status).toBe(422);
  });

  it('honours the manager-approval setting', async () => {
    await request(app)
      .put('/api/v1/settings')
      .set(auth(owner))
      .send({ checkout: { refundRequiresManager: true } });
    const p = await makeProduct({ sku: 'RET-MGR', price: 10000, stock: 5 });
    const sale = await sell(cashier, {
      items: [{ product: String(p._id), quantity: 1 }],
      payments: [{ method: 'CASH', amountCents: 10000 }],
    });
    const body = {
      sale: sale.body.data.sale._id,
      refundMethod: 'CASH',
      reason: 'Needs approval',
      items: [{ saleItemId: sale.body.data.sale.items[0]._id, quantity: 1, condition: 'RESTOCK' }],
    };
    expect((await request(app).post('/api/v1/returns').set(auth(cashier)).send(body)).status).toBe(403);
    await request(app)
      .put('/api/v1/settings')
      .set(auth(owner))
      .send({ checkout: { refundRequiresManager: false } });
  });
});

describe('cash shifts', () => {
  it('reconciles expected cash and records variance on close', async () => {
    await CashRegister.create({ name: 'Register 2' });
    const reg2 = (await CashRegister.findOne({ name: 'Register 2' }))!;
    const open = await request(app)
      .post(`/api/v1/cash-registers/${reg2._id}/open-shift`)
      .set(auth(cashier2))
      .send({ openingFloatCents: 100000 });
    expect(open.status).toBe(201);
    const shiftId = open.body.data._id;
    const p = await makeProduct({ sku: 'SHIFT-1', price: 25000, stock: 10 });
    await sell(cashier2, {
      items: [{ product: String(p._id), quantity: 2 }],
      payments: [{ method: 'CASH', amountCents: 60000 }],
    }); // 50000 cash applied
    await sell(cashier2, {
      items: [{ product: String(p._id), quantity: 1 }],
      payments: [{ method: 'CARD', amountCents: 25000 }],
    });
    const cur = await request(app).get('/api/v1/cash-registers/shifts/current').set(auth(cashier2));
    expect(cur.body.data.summary).toMatchObject({
      cashSalesCents: 50000,
      cardSalesCents: 25000,
      expectedCashCents: 150000,
      saleCount: 2,
    });

    // cashiers cannot do cash-in/out; managers can
    expect(
      (
        await request(app)
          .post(`/api/v1/cash-registers/shifts/${shiftId}/adjust`)
          .set(auth(cashier2))
          .send({ type: 'OUT', amountCents: 1000, reason: 'Petty cash' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/v1/cash-registers/shifts/${shiftId}/adjust`)
          .set(auth(manager))
          .send({ type: 'OUT', amountCents: 10000, reason: 'Bank drop' })
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app)
          .post(`/api/v1/cash-registers/shifts/${shiftId}/adjust`)
          .set(auth(manager))
          .send({ type: 'OUT', amountCents: 99999999, reason: 'Too much' })
      ).status,
    ).toBe(409);

    const close = await request(app)
      .post(`/api/v1/cash-registers/shifts/${shiftId}/close`)
      .set(auth(cashier2))
      .send({ countedCashCents: 138000, notes: 'Short by 20' });
    expect(close.status).toBe(200);
    expect(close.body.data).toMatchObject({
      status: 'CLOSED',
      expectedCashCents: 140000,
      countedCashCents: 138000,
      varianceCents: -2000,
    });
    expect(
      (
        await request(app)
          .post(`/api/v1/cash-registers/shifts/${shiftId}/close`)
          .set(auth(cashier2))
          .send({ countedCashCents: 1 })
      ).status,
    ).toBe(409);
    const after = await sell(cashier2, {
      items: [{ product: String(p._id), quantity: 1 }],
      payments: [{ method: 'CASH', amountCents: 25000 }],
    });
    expect(after.body.error.code).toBe('NO_OPEN_SHIFT');
  });

  it('prevents conflicting simultaneous shifts', async () => {
    const reg = await CashRegister.create({ name: 'Register 3' });
    const reg4 = await CashRegister.create({ name: 'Register 4' });
    const rs = await Promise.all([
      request(app)
        .post(`/api/v1/cash-registers/${reg._id}/open-shift`)
        .set(auth(manager))
        .send({ openingFloatCents: 0 }),
      request(app)
        .post(`/api/v1/cash-registers/${reg4._id}/open-shift`)
        .set(auth(manager))
        .send({ openingFloatCents: 0 }),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]); // one open shift per cashier
    const other = await request(app)
      .post(`/api/v1/cash-registers/${reg._id}/open-shift`)
      .set(auth(owner))
      .send({ openingFloatCents: 0 });
    const other2 = await request(app)
      .post(`/api/v1/cash-registers/${reg4._id}/open-shift`)
      .set(auth(owner))
      .send({ openingFloatCents: 0 });
    expect([other.status, other2.status]).toContain(409); // one open shift per register
    expect(await CashShift.countDocuments({ status: 'OPEN', cashier: { $exists: true } })).toBeGreaterThan(0);
  });
});
