import mongoose from 'mongoose';
import request from 'supertest';
import { inject } from 'vitest';
import { createApp } from '../src/app';
import { connectDb, disconnectDb } from '../src/database/connect';
import {
  Brand,
  CashRegister,
  Category,
  InventoryBalance,
  Product,
  Supplier,
  Unit,
  User,
} from '../src/database/models';
import { createOwner, ensureBase } from '../src/database/initAdmin';
import { hashPassword } from '../src/modules/auth/auth.service';
import { addStock } from '../src/services/stock';
import { withTx } from '../src/services/common';

export const app = createApp();
export const PASSWORD = 'Passw0rd!x';

export async function startDb() {
  const base = inject('mongoUri').replace(/\/?(\?.*)?$/, '');
  const name = `pos_${Math.random().toString(36).slice(2, 10)}`;
  const q = inject('mongoUri').includes('?') ? inject('mongoUri').slice(inject('mongoUri').indexOf('?')) : '';
  await connectDb(`${base}/${name}${q}`);
  await ensureBase();
  await mongoose.connection.db!.command({ ping: 1 });
  return name;
}
export async function stopDb() {
  await mongoose.connection.dropDatabase();
  await disconnectDb();
}

export async function seedUsers() {
  await createOwner('owner@test.local', PASSWORD, 'Owner');
  const hash = await hashPassword(PASSWORD);
  await User.create([
    { name: 'Manager', email: 'manager@test.local', role: 'MANAGER', passwordHash: hash },
    { name: 'Cashier', email: 'cashier@test.local', role: 'CASHIER', passwordHash: hash },
    { name: 'Cashier Two', email: 'cashier2@test.local', role: 'CASHIER', passwordHash: hash },
  ]);
}

export async function login(email: string, password = PASSWORD) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return {
    token: res.body.data?.accessToken as string,
    res,
    cookie: (res.headers['set-cookie'] as unknown as string[] | undefined)?.[0],
  };
}
export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function makeProduct(o: {
  sku: string;
  price?: number;
  cost?: number;
  stock?: number;
  unit?: string;
  taxCode?: string;
  trackExpiry?: boolean;
  expiryDays?: number;
  barcode?: string;
}) {
  const unit = (await Unit.findOne({ name: o.unit ?? 'Piece' }))!;
  const cat = (await Category.findOneAndUpdate(
    { name: 'Test' },
    { $setOnInsert: { name: 'Test' } },
    { upsert: true, new: true },
  ))!;
  const p = await Product.create({
    name: `Product ${o.sku}`,
    sku: o.sku,
    barcode: o.barcode,
    category: cat._id,
    unit: unit._id,
    priceCents: o.price ?? 10000,
    costCents: o.cost ?? 6000,
    taxCode: o.taxCode,
    trackExpiry: !!o.trackExpiry,
  });
  await InventoryBalance.create({ product: p._id, onHandMilli: 0 });
  if (o.stock) {
    const owner = (await User.findOne({ role: 'OWNER' }))!;
    await withTx((session) =>
      addStock(
        session,
        { id: p._id, trackExpiry: !!o.trackExpiry, costCents: p.costCents },
        o.stock! * 1000,
        {
          type: 'PURCHASE_RECEIPT',
          unitCostCents: p.costCents,
          actor: owner._id,
          batchNo: o.trackExpiry ? 'B1' : undefined,
          expiryDate: o.trackExpiry ? new Date(Date.now() + (o.expiryDays ?? 30) * 86400_000) : undefined,
        },
      ),
    );
  }
  return p;
}

export async function openShift(token: string, float = 500000, registerName?: string) {
  const reg = registerName
    ? (await CashRegister.findOneAndUpdate(
        { name: registerName },
        { $setOnInsert: { name: registerName } },
        { upsert: true, new: true },
      ))!
    : (await CashRegister.findOne())!;
  return request(app)
    .post(`/api/v1/cash-registers/${reg._id}/open-shift`)
    .set(auth(token))
    .send({ openingFloatCents: float });
}

export const onHand = async (productId: unknown) =>
  (await InventoryBalance.findOne({ product: productId }))!.onHandMilli / 1000;

let n = 0;
export const sell = (token: string, body: Record<string, unknown>, key = `key-${Date.now()}-${n++}`) =>
  request(app).post('/api/v1/sales').set(auth(token)).set('Idempotency-Key', key).send(body);

export { Brand, Supplier };
