import mongoose from 'mongoose';
import { assertDemoDatabase, assertDemoUserRoles, env } from '../config/env';
import { logger } from '../utils/logger';
import * as models from './models';

export async function connectDb(uri = env.MONGODB_URI) {
  if (env.demoMode) assertDemoDatabase(uri);
  mongoose.set('strictQuery', true);
  // NoSQL injection is prevented by strict zod validation of every request (strings/numbers only, no raw objects reach filters).
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  if (env.demoMode) {
    try {
      const status = await mongoose.connection.db!.command({ connectionStatus: 1 });
      assertDemoUserRoles(status.authInfo?.authenticatedUserRoles ?? []);
    } catch (error) {
      await mongoose.disconnect();
      throw error;
    }
  }
  logger.info('MongoDB connected');
  await ensureIndexes();
}

/** Builds indexes (including unique/partial ones that carry business invariants) before serving traffic. */
export async function ensureIndexes() {
  void models; // ensure every model is registered before syncing
  const all = Object.values(mongoose.models);
  await Promise.all(all.map((m) => m.createCollection().catch(() => undefined)));
  await Promise.all(all.map((m) => m.syncIndexes()));
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
