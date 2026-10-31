/**
 * Disposable stack for Playwright: in-memory MongoDB replica set + API on E2E_API_PORT with fixed demo users
 * and one supplier/category. Never used in production. Run via `npm run e2e:stack -w server`.
 */
import './e2eEnv';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../app';
import { hashPassword } from '../modules/auth/auth.service';
import { connectDb } from './connect';
import { createOwner, ensureBase } from './initAdmin';
import { Category, Supplier, User } from './models';

async function main() {
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connectDb(rs.getUri('e2e'));
  await ensureBase();
  await createOwner('admin@e2e.local', 'Admin#12345', 'E2E Admin');
  await User.create({
    name: 'E2E Cashier',
    email: 'cashier@e2e.local',
    role: 'CASHIER',
    passwordHash: await hashPassword('Cashier#12345'),
  });
  await Supplier.create({ name: 'E2E Supplier' });
  await Category.create({ name: 'E2E Category' });

  const port = Number(process.env.E2E_API_PORT ?? 4100);
  createApp().listen(port, () => console.log(`E2E API ready on ${port}`));
  const stop = async () => {
    await rs.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
