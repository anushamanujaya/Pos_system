import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { type Role } from './permissions';
import { env } from './env';
import { DemoEnvironment } from '../database/models';
import { forbidden } from '../utils/errors';

export const DEMO_ACCOUNTS: Readonly<Record<Role, string>> = {
  OWNER: 'owner@demo.local',
  MANAGER: 'manager@demo.local',
  CASHIER: 'cashier@demo.local',
};

export const demoIdentityHash = (identity: string) =>
  crypto.createHash('sha256').update(identity).digest('hex');

export function databaseNameFromUri(uri: string) {
  try {
    const name = decodeURIComponent(new URL(uri).pathname.replace(/^\//, ''));
    return name || undefined;
  } catch {
    return undefined;
  }
}

export function assertDemoConfiguration(config = {
  enabled: env.demoMode,
  uri: env.MONGODB_URI,
  databaseName: env.DEMO_DATABASE_NAME,
  databaseId: env.DEMO_DATABASE_ID,
}) {
  if (!config.enabled) throw forbidden('Demo access is disabled');
  if (!config.databaseName || !config.databaseId || config.databaseId.length < 16)
    throw forbidden('Demo access is not safely configured');
  const uriDatabase = databaseNameFromUri(config.uri);
  // Atlas connection strings may omit the path. connectDb still forces dbName explicitly in demo mode.
  if (uriDatabase && uriDatabase !== config.databaseName)
    throw forbidden('Demo access is not available for this database');
}

/** Verifies both configuration and the identity marker stored in the connected demo database. */
export async function assertDemoDatabase() {
  assertDemoConfiguration();
  if (mongoose.connection.readyState !== 1 || mongoose.connection.name !== env.DEMO_DATABASE_NAME)
    throw forbidden('Demo access is not available for this database');
  const marker = await DemoEnvironment.findById('demo-environment').lean();
  if (!marker || marker.identityHash !== demoIdentityHash(env.DEMO_DATABASE_ID!))
    throw forbidden('Demo database identity could not be verified');
}

export const isAllowedDemoAccount = (user: {
  email: string;
  role: Role;
  isDemoAccount?: boolean | null;
}) => !!user.isDemoAccount && DEMO_ACCOUNTS[user.role] === user.email.toLowerCase();
