import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { assertDemoUserRoles, env } from '../src/config/env';
import { can } from '../src/config/permissions';
import { assertDemoSeedTarget } from '../src/database/demo';
import { DemoControl, Product, PurchaseOrder, Sale, User } from '../src/database/models';
import { seedCatalogue, seedTransactions } from '../src/database/seed';
import { hashPassword } from '../src/modules/auth/auth.service';
import { startDb, stopDb } from './helpers';

const app = createApp();
const password = 'DemoTestPassword12345';
let token = '';
let ownerId = '';

beforeAll(async () => {
  await startDb();
  const [owner] = await User.create([{ name: 'Private Owner', email: 'private@test.local', role: 'OWNER', passwordHash: await hashPassword(password) }]);
  ownerId = String(owner._id);
  await User.create({ name: 'Public Demo', email: 'demo@test.local', role: 'DEMO', passwordHash: await hashPassword(password), mustChangePassword: false });
  await DemoControl.create({ _id: 'public-demo', resetting: false, activeRequests: 0 });
  env.demoMode = true;
  const response = await request(app).post('/api/v1/auth/login').send({ email: 'demo@test.local', password });
  expect(response.status).toBe(200);
  expect(response.body.data.user.mustChangePassword).toBe(false);
  token = response.body.data.accessToken;
});
afterAll(async () => {
  env.demoMode = false;
  await stopDb();
});

describe('isolated public demo', () => {
  it('grants read and POS permissions but no administrative or destructive permissions', () => {
    expect(can('DEMO', 'reports.read')).toBe(true);
    expect(can('DEMO', 'sales.create')).toBe(true);
    for (const permission of ['employees.manage', 'settings.manage', 'products.delete', 'inventory.adjust'] as const)
      expect(can('DEMO', permission)).toBe(false);
  });

  it('rejects Owner login on a demo deployment without changing the Owner record', async () => {
    const response = await request(app).post('/api/v1/auth/login').send({ email: 'private@test.local', password });
    expect(response.status).toBe(401);
    expect((await User.findById(ownerId))!.role).toBe('OWNER');
  });

  it('allows reads and pricing but blocks account, employee, product and inventory writes', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    expect((await request(app).get('/api/v1/products').set(auth)).status).toBe(200);
    expect((await request(app).post('/api/v1/sales/calculate').set(auth).send({ items: [] })).status).toBe(400);
    for (const [method, path] of [
      ['post', '/api/v1/auth/change-password'], ['patch', '/api/v1/auth/profile'],
      ['post', '/api/v1/users'], ['delete', '/api/v1/products/000000000000000000000000'],
      ['post', '/api/v1/inventory/adjust'],
    ] as const) {
      expect((await request(app)[method](path).set(auth)).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/users').set(auth)).status).toBe(403);
  });

  it('blocks requests while reset is in progress', async () => {
    await DemoControl.updateOne({ _id: 'public-demo' }, { $set: { resetting: true } });
    expect((await request(app).get('/api/v1/products')).status).toBe(503);
    await DemoControl.updateOne({ _id: 'public-demo' }, { $set: { resetting: false } });
  });

  it('refuses unexpected databases and missing demo credentials before connecting', () => {
    const safe = 'mongodb://demo:secret@localhost/supermarket_pos_demo';
    expect(() => assertDemoSeedTarget(safe, false, 'demo@example.test', password)).toThrow();
    expect(() => assertDemoSeedTarget('mongodb://demo:secret@localhost/supermarket_pos', true, 'demo@example.test', password)).toThrow();
    expect(() => assertDemoSeedTarget(safe, true, undefined, password)).toThrow();
    expect(() => assertDemoSeedTarget(safe, true, 'demo@example.test', password)).not.toThrow();
    expect(() => assertDemoUserRoles([{ role: 'readWrite', db: 'supermarket_pos_demo' }])).not.toThrow();
    expect(() => assertDemoUserRoles([{ role: 'readWriteAnyDatabase', db: 'admin' }])).toThrow();
  });

  it('creates synthetic catalogue, purchase history and checkout-backed sales', async () => {
    expect(await seedCatalogue()).toBeGreaterThan(0);
    expect(await PurchaseOrder.countDocuments()).toBeGreaterThan(0);
    expect(await seedTransactions()).toBeGreaterThan(0);
    expect(await Product.countDocuments()).toBeGreaterThan(0);
    expect(await Sale.countDocuments()).toBeGreaterThan(0);
  }, 60_000);

  it('permits a test checkout through the public demo API', async () => {
    const product = await Product.findOne({ sku: 'GRC-RICE-5K' });
    const items = [{ product: String(product!._id), quantity: 1 }];
    const header = { Authorization: `Bearer ${token}` };
    const priced = await request(app).post('/api/v1/sales/calculate').set(header).send({ items });
    expect(priced.status).toBe(200);
    const checkout = await request(app).post('/api/v1/sales')
      .set(header).set('Idempotency-Key', 'demo-api-checkout-1')
      .send({ items, payments: [{ method: 'CARD', amountCents: priced.body.data.totalCents, reference: 'TEST-DEMO' }] });
    expect(checkout.status).toBe(201);
    expect(checkout.body.data.receiptNo).toMatch(/^INV-/);
  });
});
