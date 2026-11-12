/**
 * Production-safe bootstrap: creates default settings, base units and the first OWNER account from
 * environment-provided credentials (ADMIN_EMAIL / ADMIN_PASSWORD). Never creates demo data.
 */
import { env } from '../config/env';
import { connectDb, disconnectDb } from './connect';
import { CashRegister, Unit, User } from './models';
import { assertStrongPassword, hashPassword } from '../modules/auth/auth.service';
import { getSettings } from '../services/common';

export const BASE_UNITS = [
  { name: 'Piece', symbol: 'pc', decimals: 0 },
  { name: 'Pack', symbol: 'pack', decimals: 0 },
  { name: 'Box', symbol: 'box', decimals: 0 },
  { name: 'Kilogram', symbol: 'kg', decimals: 3 },
  { name: 'Gram', symbol: 'g', decimals: 0 },
  { name: 'Liter', symbol: 'l', decimals: 3 },
  { name: 'Milliliter', symbol: 'ml', decimals: 0 },
];

export async function ensureBase() {
  await getSettings();
  for (const u of BASE_UNITS)
    await Unit.updateOne(
      { name: u.name },
      { $setOnInsert: u },
      { upsert: true, collation: { locale: 'en', strength: 2 } },
    );
  const kg = await Unit.findOne({ name: 'Kilogram' });
  const g = await Unit.findOne({ name: 'Gram' });
  if (kg && g) await Unit.updateOne({ _id: kg._id }, { $set: { baseUnit: g._id, factor: 1000 } });
  const l = await Unit.findOne({ name: 'Liter' });
  const ml = await Unit.findOne({ name: 'Milliliter' });
  if (l && ml) await Unit.updateOne({ _id: l._id }, { $set: { baseUnit: ml._id, factor: 1000 } });
  if (!(await CashRegister.exists({})))
    await CashRegister.create({ name: 'Register 1', location: 'Front counter' });
}

export async function createOwner(email: string, password: string, name: string) {
  assertStrongPassword(password);
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return { created: false, id: String(existing._id) };
  const u = await User.create({
    name,
    email,
    role: 'OWNER',
    passwordHash: await hashPassword(password),
    mustChangePassword: false,
  });
  return { created: true, id: String(u._id) };
}

async function main() {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment (.env) before running init:admin.');
    process.exit(1);
  }
  await connectDb();
  await ensureBase();
  const r = await createOwner(env.ADMIN_EMAIL, env.ADMIN_PASSWORD, env.ADMIN_NAME);
   
  console.log(
    r.created
      ? `Owner account created for ${env.ADMIN_EMAIL}`
      : `Owner ${env.ADMIN_EMAIL} already exists - nothing changed`,
  );
  await disconnectDb();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
