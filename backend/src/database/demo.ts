/** Operator-only demo initialization/reset. Never exposed as an HTTP route. */
import mongoose from 'mongoose';
import { assertDemoDatabase, DEMO_DATABASE, env } from '../config/env';
import { assertStrongPassword, hashPassword } from '../modules/auth/auth.service';
import { seedCatalogue, seedTransactions } from './seed';
import { connectDb, disconnectDb } from './connect';
import { DemoControl, User } from './models';

export function assertDemoSeedTarget(uri: string, mode: boolean, email?: string, password?: string) {
  if (!mode) throw new Error('Set DEMO_MODE=true before initializing demo data');
  assertDemoDatabase(uri);
  if (!email || !password || password.length < 16) throw new Error('Set DEMO_EMAIL and a strong DEMO_PASSWORD (16+ characters)');
  assertStrongPassword(password);
}

export async function resetDemoData() {
  assertDemoSeedTarget(env.MONGODB_URI, env.demoMode, env.DEMO_EMAIL, env.DEMO_PASSWORD);
  await connectDb();
  if (mongoose.connection.name !== DEMO_DATABASE) throw new Error('Connected to an unexpected database');
  await DemoControl.updateOne(
    { _id: 'public-demo' },
    { $setOnInsert: { resetting: false, activeRequests: 0 } },
    { upsert: true },
  );
  const lock = await DemoControl.findOneAndUpdate(
    { _id: 'public-demo', resetting: false, activeRequests: 0 },
    { $set: { resetting: true } },
    { new: true },
  );
  if (!lock) throw new Error('Demo reset refused: another reset or API request is active');
  let completed = false;
  try {
    // Keep the gate document while removing every other collection in this verified demo database.
    for (const model of Object.values(mongoose.models)) {
      if (model.modelName !== 'DemoControl') await model.deleteMany({});
    }
    await User.create({
      name: 'Public Demo',
      email: env.DEMO_EMAIL!.toLowerCase(),
      role: 'DEMO',
      passwordHash: await hashPassword(env.DEMO_PASSWORD!),
      mustChangePassword: false,
    });
    const products = await seedCatalogue();
    const sales = await seedTransactions();
    completed = true;
    return { products, sales };
  } finally {
    // On failure, leave the gate closed: a partial dataset must never be served.
    if (completed) await DemoControl.updateOne({ _id: 'public-demo' }, { $set: { resetting: false } });
  }
}

async function main() {
  const result = await resetDemoData();
  console.log(`Demo database ${DEMO_DATABASE} initialized: ${result.products} products, ${result.sales} sales.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  }).finally(() => void disconnectDb());
}
