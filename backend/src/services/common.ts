import mongoose, { type ClientSession } from 'mongoose';
import crypto from 'node:crypto';
import { AuditLog, Notification, SequenceCounter, StoreSettings } from '../database/models';
import { logger } from '../utils/logger';

/** Run `fn` in a MongoDB transaction. The driver retries on TransientTransactionError (e.g. write conflicts). */
export async function withTx<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    );
    return result;
  } finally {
    await session.endSession();
  }
}

/** Atomic, concurrency-safe counter ($inc is atomic; inside a transaction it also rolls back with it). */
export async function nextSeq(key: string, session?: ClientSession): Promise<number> {
  const doc = await SequenceCounter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session },
  );
  return doc.seq;
}

export interface AppSettings {
  store: { name: string; address: string; phone: string; email: string; logoUrl: string; taxId: string };
  currency: { code: string; symbol: string };
  timezone: string;
  taxRates: { code: string; name: string; rateBps: number }[];
  priceIncludesTax: boolean;
  receipt: { footer: string; paperSize: '58mm' | '80mm' | 'A4'; invoicePrefix: string; numberFormat: string };
  stock: {
    lowStockDefaultMilli: number;
    expiryAlertDays: number;
    allowNegativeStock: boolean;
    allowExpiredSales: boolean;
  };
  discounts: { cashierMaxPercentBps: number; maxPercentBps: number };
  checkout: { requireOpenShift: boolean; refundRequiresManager: boolean; refundWindowDays: number };
}
/** Hydrated settings document with fully-typed (always present) nested sections. */
export type SettingsLike = AppSettings & {
  _id: mongoose.Types.ObjectId;
  toObject(): AppSettings & { _id: mongoose.Types.ObjectId };
  set(path: string, value: unknown): void;
  save(): Promise<unknown>;
};

export async function getSettings(session?: ClientSession): Promise<SettingsLike> {
  const found = await StoreSettings.findOne({ key: 'store' }).session(session ?? null);
  if (found) return found as unknown as SettingsLike;
  try {
    const [created] = await StoreSettings.create([{ key: 'store' }], { session });
    return created as unknown as SettingsLike;
  } catch {
    // concurrent creation: the unique key makes the loser read the winner's document
    return (await StoreSettings.findOne({ key: 'store' }).session(
      session ?? null,
    )) as unknown as SettingsLike;
  }
}

export function formatNumber(format: string, prefix: string, seq: number, now: Date, tz: string): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .split('-');
  return format
    .replace('{PREFIX}', prefix)
    .replace('{YYYY}', p[0])
    .replace('{MM}', p[1])
    .replace('{DD}', p[2])
    .replace(/\{SEQ:(\d+)\}/, (_, n) => String(seq).padStart(Number(n), '0'));
}

export interface Actor {
  id: string;
  name?: string;
  ip?: string;
}

export async function audit(
  actor: Actor | undefined,
  action: string,
  entity: string,
  entityId: unknown,
  summary: string,
  meta?: unknown,
  session?: ClientSession,
) {
  try {
    await AuditLog.create(
      [
        {
          actor: actor?.id,
          actorName: actor?.name,
          action,
          entity,
          entityId: entityId ? String(entityId) : undefined,
          summary,
          meta,
          ip: actor?.ip,
        },
      ],
      { session },
    );
  } catch (err) {
    if (session) throw err; // inside a transaction an audit failure must abort the business operation
    logger.error({ err }, 'audit log write failed');
  }
}

/** Create (or keep) an open notification for a dedupe key. Safe to call repeatedly. */
export async function raiseNotification(n: {
  type: 'LOW_STOCK' | 'OUT_OF_STOCK' | 'EXPIRING' | 'EXPIRED' | 'ADJUSTMENT' | 'OPERATIONAL';
  severity?: 'info' | 'warning' | 'critical';
  title: string;
  message?: string;
  link?: string;
  dedupeKey?: string;
}) {
  try {
    await Notification.updateOne(
      { dedupeKey: n.dedupeKey ?? crypto.randomUUID(), resolvedAt: null },
      { $setOnInsert: { ...n, dedupeKey: n.dedupeKey ?? undefined } },
      { upsert: true },
    );
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) logger.error({ err }, 'notification failed');
  }
}

export const resolveNotification = (dedupeKey: string) =>
  Notification.updateMany({ dedupeKey, resolvedAt: null }, { $set: { resolvedAt: new Date() } });

export const isDuplicateKey = (e: unknown) => (e as { code?: number })?.code === 11000;
export const objectId = (id: string) => new mongoose.Types.ObjectId(id);
export const isObjectId = (id: unknown): id is string =>
  typeof id === 'string' && mongoose.isValidObjectId(id);
