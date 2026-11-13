import { Schema, model, Types, type InferSchemaType } from 'mongoose';
import { ROLES } from '../../config/permissions';

const oid = (ref: string, required = false) => ({ type: Schema.Types.ObjectId, ref, required });
const opts = { timestamps: true } as const;

// ---------- Users & sessions ----------
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, default: 'CASHIER' },
    active: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    lastLoginAt: Date,
    /** Bumped on disable / password reset: every outstanding access token and session dies. */
    tokenVersion: { type: Number, default: 0 },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: Date,
    /** Set only by the guarded demo seed; demo login also checks the fixed email/role allowlist. */
    isDemoAccount: { type: Boolean, default: false, index: true },
  },
  opts,
);
export const User = model('User', userSchema);

const refreshSessionSchema = new Schema(
  {
    user: oid('User', true),
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    replacedBy: String,
    userAgent: String,
    ip: String,
    /** Cryptographically carried into access tokens; never inferred from the user's email alone. */
    isDemo: { type: Boolean, default: false },
  },
  opts,
);
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });
refreshSessionSchema.index({ user: 1, revokedAt: 1 });
export const RefreshSession = model('RefreshSession', refreshSessionSchema);

const demoEnvironmentSchema = new Schema(
  {
    _id: { type: String, default: 'demo-environment' },
    identityHash: { type: String, required: true },
  },
  opts,
);
export const DemoEnvironment = model('DemoEnvironment', demoEnvironmentSchema);

// ---------- Catalog ----------
const named = (extra: Record<string, unknown> = {}) =>
  new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 100 },
      description: { type: String, trim: true, maxlength: 500 },
      active: { type: Boolean, default: true },
      ...extra,
    },
    opts,
  );

const categorySchema = named();
categorySchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
export const Category = model('Category', categorySchema);

const brandSchema = named();
brandSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
export const Brand = model('Brand', brandSchema);

const unitSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    symbol: { type: String, required: true, trim: true },
    /** Allowed decimal places for quantities in this unit (0 for pieces, 3 for kg/l). */
    decimals: { type: Number, min: 0, max: 3, default: 0 },
    /** Optional conversion: 1 of this unit = factor of baseUnit (e.g. kg -> 1000 g). */
    baseUnit: oid('Unit'),
    factor: { type: Number, min: 0, default: 1 },
    active: { type: Boolean, default: true },
  },
  opts,
);
unitSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
export const Unit = model('Unit', unitSchema);

const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    sku: { type: String, required: true, trim: true, uppercase: true },
    barcode: { type: String, trim: true },
    description: { type: String, trim: true, maxlength: 2000 },
    category: oid('Category', true),
    brand: oid('Brand'),
    suppliers: [oid('Supplier')],
    costCents: { type: Number, required: true, min: 0, default: 0, validate: Number.isInteger },
    priceCents: { type: Number, required: true, min: 0, validate: Number.isInteger },
    taxCode: { type: String, trim: true },
    unit: oid('Unit', true),
    packSize: { type: Number, min: 1, default: 1 },
    imageUrl: String,
    reorderLevelMilli: { type: Number, min: 0, default: 0 },
    trackExpiry: { type: Boolean, default: false },
    status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE' },
  },
  opts,
);
productSchema.index({ sku: 1 }, { unique: true });
// Partial unique index: products without a barcode never collide, but a barcode can't be reused.
productSchema.index(
  { barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $type: 'string' } } },
);
productSchema.index({ name: 'text', sku: 'text', barcode: 'text' });
productSchema.index({ category: 1, status: 1 });
productSchema.index({ brand: 1 });
productSchema.index({ status: 1, name: 1 });
export const Product = model('Product', productSchema);

// ---------- People ----------
const supplierSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    contactPerson: String,
    phone: String,
    email: { type: String, lowercase: true, trim: true },
    address: String,
    notes: String,
    active: { type: Boolean, default: true },
  },
  opts,
);
supplierSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
export const Supplier = model('Supplier', supplierSchema);

const customerSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    phone: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    address: String,
    notes: String,
    active: { type: Boolean, default: true },
    visitCount: { type: Number, default: 0 },
    totalSpentCents: { type: Number, default: 0 },
    lastVisitAt: Date,
  },
  opts,
);
customerSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
customerSchema.index({ name: 'text', phone: 'text', code: 'text' });
export const Customer = model('Customer', customerSchema);

// ---------- Settings & infrastructure ----------
const taxRateSchema = new Schema(
  {
    code: { type: String, required: true },
    name: { type: String, required: true },
    rateBps: { type: Number, required: true, min: 0, max: 10000 },
  },
  { _id: false },
);
const settingsSchema = new Schema(
  {
    key: { type: String, default: 'store', unique: true },
    store: {
      name: { type: String, default: 'My Supermarket' },
      address: { type: String, default: '' },
      phone: { type: String, default: '' },
      email: { type: String, default: '' },
      logoUrl: { type: String, default: '' },
      taxId: { type: String, default: '' },
    },
    currency: { code: { type: String, default: 'LKR' }, symbol: { type: String, default: 'Rs.' } },
    timezone: { type: String, default: 'Asia/Colombo' },
    /** Administrator-defined. No rate is hardcoded; the list starts empty. */
    taxRates: { type: [taxRateSchema], default: [] },
    priceIncludesTax: { type: Boolean, default: true },
    receipt: {
      footer: { type: String, default: 'Thank you for shopping with us!' },
      paperSize: { type: String, enum: ['58mm', '80mm', 'A4'], default: '80mm' },
      invoicePrefix: { type: String, default: 'INV' },
      /** Tokens: {PREFIX} {YYYY} {MM} {DD} {SEQ:n} */
      numberFormat: { type: String, default: '{PREFIX}-{YYYY}{MM}{DD}-{SEQ:5}' },
    },
    stock: {
      lowStockDefaultMilli: { type: Number, default: 10000 },
      expiryAlertDays: { type: Number, default: 14 },
      allowNegativeStock: { type: Boolean, default: false },
      allowExpiredSales: { type: Boolean, default: false },
    },
    discounts: {
      /** Cashiers can discount up to this percent (basis points) without `discount.override`. */
      cashierMaxPercentBps: { type: Number, default: 500 },
      maxPercentBps: { type: Number, default: 5000 },
    },
    checkout: {
      requireOpenShift: { type: Boolean, default: true },
      refundRequiresManager: { type: Boolean, default: false },
      refundWindowDays: { type: Number, default: 30 },
    },
  },
  opts,
);
export const StoreSettings = model('StoreSettings', settingsSchema);

export const SequenceCounter = model(
  'SequenceCounter',
  new Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false }),
);

const idemSchema = new Schema(
  {
    key: { type: String, required: true },
    user: oid('User', true),
    scope: { type: String, required: true },
    requestHash: { type: String, required: true },
    resourceId: Schema.Types.ObjectId,
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);
idemSchema.index({ user: 1, scope: 1, key: 1 }, { unique: true });
idemSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 2 });
export const IdempotencyRecord = model('IdempotencyRecord', idemSchema);

const auditSchema = new Schema(
  {
    actor: oid('User'),
    actorName: String,
    action: { type: String, required: true },
    entity: String,
    entityId: String,
    summary: String,
    meta: Schema.Types.Mixed,
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ createdAt: -1 });
auditSchema.index({ action: 1, createdAt: -1 });
auditSchema.index({ actor: 1, createdAt: -1 });
export const AuditLog = model('AuditLog', auditSchema);

const notificationSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['LOW_STOCK', 'OUT_OF_STOCK', 'EXPIRING', 'EXPIRED', 'ADJUSTMENT', 'OPERATIONAL'],
      required: true,
    },
    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info' },
    title: { type: String, required: true },
    message: String,
    link: String,
    /** De-duplication key so repeated scans don't spam: one open notification per key. */
    dedupeKey: String,
    readBy: [oid('User')],
    resolvedAt: Date,
  },
  opts,
);
notificationSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' }, resolvedAt: null } },
);
notificationSchema.index({ createdAt: -1 });
export const Notification = model('Notification', notificationSchema);

const promotionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['PERCENT', 'FIXED'], required: true },
    /** PERCENT: basis points (1000 = 10%). FIXED: cents off the line (per line, not per unit). */
    value: { type: Number, required: true, min: 1, validate: Number.isInteger },
    scope: { type: String, enum: ['PRODUCT', 'CATEGORY', 'CART'], required: true },
    products: [oid('Product')],
    categories: [oid('Category')],
    minCartCents: { type: Number, default: 0 },
    startsAt: Date,
    endsAt: Date,
    priority: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  opts,
);
promotionSchema.index({ active: 1, scope: 1, startsAt: 1, endsAt: 1 });
promotionSchema.index({ products: 1 });
export const Promotion = model('Promotion', promotionSchema);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export type ProductDoc = InferSchemaType<typeof productSchema> & { _id: Types.ObjectId };
export type SettingsDoc = InferSchemaType<typeof settingsSchema> & { _id: Types.ObjectId };
