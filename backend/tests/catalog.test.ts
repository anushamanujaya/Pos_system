import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, auth, login, seedUsers, startDb, stopDb, makeProduct, onHand } from './helpers';
import { applyImageCsv } from '../src/database/setImages';
import { Category, Product, Unit, AuditLog } from '../src/database/models';

let owner: string;
let cashier: string;
let catId: string;
let unitId: string;

beforeAll(async () => {
  await startDb();
  await seedUsers();
  owner = (await login('owner@test.local')).token;
  cashier = (await login('cashier@test.local')).token;
  catId = String((await Category.create({ name: 'Groceries' }))._id);
  unitId = String((await Unit.findOne({ name: 'Piece' }))!._id);
});
afterAll(stopDb);

const body = (o: Record<string, unknown> = {}) => ({
  name: 'Rice 1kg',
  sku: 'rice-1',
  barcode: '111222333',
  category: catId,
  unit: unitId,
  costCents: 20000,
  priceCents: 26000,
  ...o,
});

describe('products', () => {
  it('creates, normalises SKU, creates a zero balance and audits', async () => {
    const r = await request(app).post('/api/v1/products').set(auth(owner)).send(body());
    expect(r.status).toBe(201);
    expect(r.body.data.sku).toBe('RICE-1');
    expect(await onHand(r.body.data._id)).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'product.create' })).toBe(1);
  });

  it('rejects duplicate SKU and barcode', async () => {
    expect(
      (
        await request(app)
          .post('/api/v1/products')
          .set(auth(owner))
          .send(body({ barcode: '999' }))
      ).status,
    ).toBe(409);
    const dup = await request(app)
      .post('/api/v1/products')
      .set(auth(owner))
      .send(body({ sku: 'OTHER' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.field).toBe('barcode');
  });

  it('allows several products without a barcode', async () => {
    expect(
      (
        await request(app)
          .post('/api/v1/products')
          .set(auth(owner))
          .send(body({ sku: 'NB1', barcode: '' }))
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app)
          .post('/api/v1/products')
          .set(auth(owner))
          .send(body({ sku: 'NB2', barcode: '' }))
      ).status,
    ).toBe(201);
  });

  it('forbids cashiers from creating products but lets them read', async () => {
    expect(
      (
        await request(app)
          .post('/api/v1/products')
          .set(auth(cashier))
          .send(body({ sku: 'X', barcode: 'x' }))
      ).status,
    ).toBe(403);
    expect((await request(app).get('/api/v1/products').set(auth(cashier))).status).toBe(200);
  });

  it('validates input', async () => {
    const r = await request(app).post('/api/v1/products').set(auth(owner)).send({ name: '', sku: 'A' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('searches, filters and paginates on the server', async () => {
    await makeProduct({ sku: 'MILK-1', stock: 5 });
    const s = await request(app).get('/api/v1/products?q=milk').set(auth(owner));
    expect(s.body.data).toHaveLength(1);
    expect(s.body.data[0].onHandMilli).toBe(5000);
    const out = await request(app).get('/api/v1/products?stock=out').set(auth(owner));
    expect(out.body.data.some((p: { sku: string }) => p.sku === 'RICE-1')).toBe(true);
    expect(out.body.data.some((p: { sku: string }) => p.sku === 'MILK-1')).toBe(false);
    const page = await request(app).get('/api/v1/products?limit=1&page=2').set(auth(owner));
    expect(page.body.meta).toMatchObject({ page: 2, limit: 1 });
  });

  it('looks up by barcode and SKU, and ignores NoSQL operator injection', async () => {
    expect(
      (await request(app).get('/api/v1/products/barcode/111222333').set(auth(cashier))).body.data.sku,
    ).toBe('RICE-1');
    expect((await request(app).get('/api/v1/products/barcode/rice-1').set(auth(cashier))).status).toBe(200);
    expect((await request(app).get('/api/v1/products/barcode/nope').set(auth(cashier))).status).toBe(404);
    const inj = await request(app).get('/api/v1/products?q[$ne]=x').set(auth(owner));
    expect([200, 400]).toContain(inj.status);
  });

  it('imports CSV with row-level validation', async () => {
    const csv = [
      'name,sku,barcode,category,brand,unit,cost,price',
      'Good Item,CSV-1,555001,Snacks,Acme,Piece,10.50,15.00',
      'No Price,CSV-2,555002,Snacks,,Piece,5,',
      'Bad Unit,CSV-3,555003,Snacks,,Furlong,5,9',
      'Dup Sku,csv-1,555004,Snacks,,Piece,5,9',
    ].join('\n');
    const dry = await request(app)
      .post('/api/v1/products/import')
      .set(auth(owner))
      .send({ csv, dryRun: true });
    expect(dry.body.data).toMatchObject({ imported: 1, failed: 3 });
    const r = await request(app).post('/api/v1/products/import').set(auth(owner)).send({ csv });
    expect(r.body.data.imported).toBe(1);
    expect(r.body.data.errors.map((e: { row: number }) => e.row)).toEqual([3, 4, 5]);
    const p = await request(app).get('/api/v1/products/barcode/555001').set(auth(owner));
    expect(p.body.data.priceCents).toBe(1500);
  });

  it('accepts an external http(s) image link, rejects other schemes, and can clear it', async () => {
    const url = 'https://example.com/images/rice.jpg';
    const ok = await request(app)
      .post('/api/v1/products')
      .set(auth(owner))
      .send(body({ sku: 'IMG-1', barcode: '', imageUrl: url }));
    expect(ok.status).toBe(201);
    expect(ok.body.data.imageUrl).toBe(url);
    for (const bad of [
      'javascript:alert(1)',
      'ftp://example.com/a.png',
      'not a url',
      'data:image/png;base64,AAAA',
    ]) {
      const r = await request(app)
        .post('/api/v1/products')
        .set(auth(owner))
        .send(body({ sku: `IMG-${Math.random()}`, barcode: '', imageUrl: bad }));
      expect(r.status).toBe(400);
    }
    const cleared = await request(app)
      .patch(`/api/v1/products/${ok.body.data._id}`)
      .set(auth(owner))
      .send({ imageUrl: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.imageUrl).toBeUndefined();
  });

  it('bulk-sets image links from a CSV (dry run, validation, clearing)', async () => {
    await makeProduct({ sku: 'BULK-1' });
    await makeProduct({ sku: 'BULK-2' });
    const csv = [
      'sku,imageUrl',
      'bulk-1,https://example.com/a.jpg',
      'BULK-2,javascript:alert(1)',
      'NOPE-9,https://example.com/c.jpg',
      'BULK-1,https://example.com/dup.jpg',
    ].join('\n');
    const dry = await applyImageCsv(csv, { dryRun: true });
    expect(dry.summary).toMatchObject({ updated: 1, failed: 3, dryRun: true });
    expect((await Product.findOne({ sku: 'BULK-1' }))!.imageUrl).toBeUndefined(); // nothing written
    const real = await applyImageCsv(csv);
    expect(real.summary.updated).toBe(1);
    expect(real.results.filter((r) => r.status === 'error').map((r) => r.row)).toEqual([3, 4, 5]);
    expect((await Product.findOne({ sku: 'BULK-1' }))!.imageUrl).toBe('https://example.com/a.jpg');
    const clear = await applyImageCsv('sku,imageUrl\nBULK-1,');
    expect(clear.summary.cleared).toBe(1);
    expect((await Product.findOne({ sku: 'BULK-1' }))!.imageUrl).toBeUndefined();
    await expect(applyImageCsv('name,link\nx,y')).rejects.toThrow(/sku,imageUrl/);
  });

  it('archives instead of deleting products with history', async () => {
    const p = await makeProduct({ sku: 'HIST-1', stock: 3 }); // has stock movement
    const r = await request(app).delete(`/api/v1/products/${p._id}`).set(auth(owner));
    expect(r.body.data).toMatchObject({ archived: true, deleted: false });
    const fresh = await makeProduct({ sku: 'NEW-1' });
    expect(
      (await request(app).delete(`/api/v1/products/${fresh._id}`).set(auth(owner))).body.data.deleted,
    ).toBe(true);
  });

  it('prevents deleting a category that has products', async () => {
    expect((await request(app).delete(`/api/v1/categories/${catId}`).set(auth(owner))).status).toBe(409);
  });
});

describe('inventory adjustments', () => {
  it('records adjustments and refuses to go negative', async () => {
    const p = await makeProduct({ sku: 'ADJ-1', stock: 10 });
    const inn = await request(app)
      .post('/api/v1/inventory/adjust')
      .set(auth(owner))
      .send({ product: String(p._id), type: 'ADJUSTMENT_IN', quantity: 5, reason: 'Found extra' });
    expect(inn.status).toBe(201);
    expect(await onHand(p._id)).toBe(15);
    const dmg = await request(app)
      .post('/api/v1/inventory/adjust')
      .set(auth(owner))
      .send({ product: String(p._id), type: 'DAMAGED', quantity: 4, reason: 'Dropped pallet' });
    expect(dmg.status).toBe(201);
    expect(await onHand(p._id)).toBe(11);
    const over = await request(app)
      .post('/api/v1/inventory/adjust')
      .set(auth(owner))
      .send({ product: String(p._id), type: 'ADJUSTMENT_OUT', quantity: 99, reason: 'Too many' });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await onHand(p._id)).toBe(11);
    const mv = await request(app).get(`/api/v1/inventory/movements?product=${p._id}`).set(auth(owner));
    expect(mv.body.data.map((m: { type: string }) => m.type)).toEqual([
      'DAMAGED',
      'ADJUSTMENT_IN',
      'PURCHASE_RECEIPT',
    ]);
    expect(
      (
        await request(app)
          .post('/api/v1/inventory/adjust')
          .set(auth(cashier))
          .send({ product: String(p._id), type: 'ADJUSTMENT_IN', quantity: 1, reason: 'cheat' })
      ).status,
    ).toBe(403);
  });

  it('rejects fractional quantities for integer-only units', async () => {
    const p = await makeProduct({ sku: 'FRAC-1', stock: 10 });
    const r = await request(app)
      .post('/api/v1/inventory/adjust')
      .set(auth(owner))
      .send({ product: String(p._id), type: 'ADJUSTMENT_IN', quantity: 1.5, reason: 'half a piece' });
    expect(r.status).toBe(400);
  });
});
