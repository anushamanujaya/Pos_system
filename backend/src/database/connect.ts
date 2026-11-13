import mongoose from 'mongoose';
import { env } from '../config/env';
import { assertDemoConfiguration } from '../config/demo';
import { logger } from '../utils/logger';
import * as models from './models';

export async function connectDb(uri = env.MONGODB_URI) {
  if (env.demoMode && uri === env.MONGODB_URI) assertDemoConfiguration();
  mongoose.set('strictQuery', true);
  // NoSQL injection is prevented by strict zod validation of every request (strings/numbers only, no raw objects reach filters).
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
    ...(env.demoMode && uri === env.MONGODB_URI ? { dbName: env.DEMO_DATABASE_NAME } : {}),
  });
  if (env.demoMode && uri === env.MONGODB_URI && mongoose.connection.name !== env.DEMO_DATABASE_NAME) {
    await mongoose.disconnect();
    throw new Error('Demo database identity mismatch');
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
