import { Schema, model } from 'mongoose';

const oid = (ref: string, required = false) => ({ type: Schema.Types.ObjectId, ref, required });
const opts = { timestamps: true } as const;
const int = { type: Number, validate: Number.isInteger };

// ---------- Inventory ----------
const balanceSchema = new Schema(
  {
    product: { ...oid('Product', true) },
    onHandMilli: { ...int, default: 0 },
  },
  opts,
);
balanceSchema.index({ product: 1 }, { unique: true });
balanceSchema.index({ onHandMilli: 1 });
export const InventoryBalance = model('InventoryBalance', balanceSchema);

const batchSchema = new Schema(
  {
    product: oid('Product', true),
    batchNo: { type: String, required: true },
    expiryDate: Date,
    receivedMilli: { ...int, required: true },
    remainingMilli: { ...int, required: true, min: 0 },
    costCents: { ...int, default: 0 },
    receipt: oid('GoodsReceipt'),
    receivedAt: { type: Date, default: Date.now },
  },
  opts,
);
// FEFO allocation: remaining stock per product ordered by earliest expiry.
batchSchema.index({ product: 1, remainingMilli: 1, expiryDate: 1 });
batchSchema.index({ expiryDate: 1, remainingMilli: 1 });
export const InventoryBatch = model('InventoryBatch', batchSchema);

export const MOVEMENT_TYPES = [
  'PURCHASE_RECEIPT',
  'SALE',
  'SALE_RETURN',
  'PURCHASE_RETURN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'DAMAGED',
  'EXPIRED',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

const movementSchema = new Schema(
  {
    product: oid('Product', true),
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    /** Signed milli-units: positive adds stock, negative removes. */
    qtyMilli: { ...int, required: true },
    balanceAfterMilli: { ...int },
    batch: oid('InventoryBatch'),
    unitCostCents: { ...int, default: 0 },
    refType: { type: String, enum: ['Sale', 'SaleReturn', 'GoodsReceipt', 'Adjustment'] },
    refId: Schema.Types.ObjectId,
    refNo: String,
    reason: String,
    actor: oid('User', true),
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
movementSchema.index({ product: 1, createdAt: -1 });
movementSchema.index({ type: 1, createdAt: -1 });
movementSchema.index({ refType: 1, refId: 1 });
export const StockMovement = model('StockMovement', movementSchema);

// ---------- Purchasing ----------
const poItem = new Schema(
  {
    product: oid('Product', true),
    orderedMilli: { ...int, required: true, min: 1 },
    receivedMilli: { ...int, default: 0 },
    costCents: { ...int, required: true, min: 0 },
  },
  { _id: true },
);
const poSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    supplier: oid('Supplier', true),
    status: {
      type: String,
      enum: ['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
      default: 'DRAFT',
    },
    items: { type: [poItem], validate: (v: unknown[]) => v.length > 0 },
    totalCents: { ...int, default: 0 },
    supplierInvoiceRef: String,
    notes: String,
    expectedDate: Date,
    orderedAt: Date,
    cancelledAt: Date,
    createdBy: oid('User', true),
  },
  opts,
);
poSchema.index({ supplier: 1, createdAt: -1 });
poSchema.index({ status: 1, createdAt: -1 });
export const PurchaseOrder = model('PurchaseOrder', poSchema);

const receiptSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    purchaseOrder: oid('PurchaseOrder'),
    supplier: oid('Supplier', true),
    supplierInvoiceRef: String,
    items: [
      new Schema(
        {
          product: oid('Product', true),
          qtyMilli: { ...int, required: true, min: 1 },
          costCents: { ...int, required: true, min: 0 },
          batchNo: String,
          expiryDate: Date,
        },
        { _id: false },
      ),
    ],
    totalCents: { ...int, default: 0 },
    receivedBy: oid('User', true),
    notes: String,
  },
  opts,
);
receiptSchema.index({ purchaseOrder: 1 });
receiptSchema.index({ supplier: 1, createdAt: -1 });
export const GoodsReceipt = model('GoodsReceipt', receiptSchema);

// ---------- Cash registers ----------
export const CashRegister = model(
  'CashRegister',
  (() => {
    const s = new Schema(
      {
        name: { type: String, required: true, trim: true },
        location: String,
        active: { type: Boolean, default: true },
      },
      opts,
    );
    s.index({ name: 1 }, { unique: true });
    return s;
  })(),
);

const shiftSchema = new Schema(
  {
    register: oid('CashRegister', true),
    cashier: oid('User', true),
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
    openedAt: { type: Date, default: Date.now },
    closedAt: Date,
    openingFloatCents: { ...int, required: true, min: 0 },
    expectedCashCents: { ...int },
    countedCashCents: { ...int },
    varianceCents: { ...int },
    closingNotes: String,
    summary: Schema.Types.Mixed,
  },
  opts,
);
// At most one OPEN shift per register and per cashier (enforced by the database, not just app code).
shiftSchema.index({ register: 1 }, { unique: true, partialFilterExpression: { status: 'OPEN' } });
shiftSchema.index({ cashier: 1 }, { unique: true, partialFilterExpression: { status: 'OPEN' } });
shiftSchema.index({ openedAt: -1 });
export const CashShift = model('CashShift', shiftSchema);

const adjSchema = new Schema(
  {
    shift: oid('CashShift', true),
    type: { type: String, enum: ['IN', 'OUT'], required: true },
    amountCents: { ...int, required: true, min: 1 },
    reason: { type: String, required: true },
    by: oid('User', true),
  },
  opts,
);
adjSchema.index({ shift: 1 });
export const CashAdjustment = model('CashAdjustment', adjSchema);

// ---------- Sales ----------
const saleItem = new Schema({
  product: oid('Product', true),
  /** Immutable snapshots: later product edits never change history. */
  name: String,
  sku: String,
  barcode: String,
  unitSymbol: String,
  qtyMilli: { ...int, required: true, min: 1 },
  unitPriceCents: { ...int, required: true },
  unitCostCents: { ...int, default: 0 },
  grossCents: { ...int, required: true },
  lineDiscountCents: { ...int, default: 0 },
  orderDiscountShareCents: { ...int, default: 0 },
  discountNote: String,
  taxCode: String,
  taxRateBps: { ...int, default: 0 },
  taxCents: { ...int, default: 0 },
  totalCents: { ...int, required: true },
  allocations: [new Schema({ batch: oid('InventoryBatch'), qtyMilli: int, costCents: int }, { _id: false })],
  returnedMilli: { ...int, default: 0 },
  refundedCents: { ...int, default: 0 },
});

const salePayment = new Schema(
  {
    method: { type: String, enum: ['CASH', 'CARD'], required: true },
    amountCents: { ...int, required: true },
    tenderedCents: { ...int },
    reference: String,
  },
  { _id: false },
);

const saleSchema = new Schema(
  {
    receiptNo: { type: String, required: true, unique: true },
    status: { type: String, enum: ['COMPLETED', 'VOIDED'], default: 'COMPLETED' },
    cashier: oid('User', true),
    cashierName: String,
    register: oid('CashRegister'),
    registerName: String,
    shift: oid('CashShift'),
    customer: oid('Customer'),
    customerName: String,
    items: { type: [saleItem], validate: (v: unknown[]) => v.length > 0 },
    payments: [salePayment],
    subtotalCents: { ...int, required: true },
    discountCents: { ...int, default: 0 },
    taxCents: { ...int, default: 0 },
    totalCents: { ...int, required: true },
    changeCents: { ...int, default: 0 },
    taxBreakdown: [
      new Schema({ code: String, rateBps: Number, taxableCents: Number, taxCents: Number }, { _id: false }),
    ],
    priceIncludesTax: Boolean,
    orderDiscountNote: String,
    refundedCents: { ...int, default: 0 },
    refundedTaxCents: { ...int, default: 0 },
    voidedAt: Date,
    voidReason: String,
    voidedBy: oid('User'),
    idempotencyKey: String,
  },
  opts,
);
saleSchema.index({ createdAt: -1 });
saleSchema.index({ cashier: 1, createdAt: -1 });
saleSchema.index({ customer: 1, createdAt: -1 });
saleSchema.index({ shift: 1 });
saleSchema.index({ 'items.product': 1, createdAt: -1 });
saleSchema.index({ 'payments.method': 1, createdAt: -1 });
export const Sale = model('Sale', saleSchema);

const returnSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    sale: oid('Sale', true),
    saleReceiptNo: String,
    items: [
      new Schema(
        {
          saleItemId: { type: Schema.Types.ObjectId, required: true },
          product: oid('Product', true),
          name: String,
          qtyMilli: { ...int, required: true, min: 1 },
          refundCents: { ...int, required: true },
          taxCents: { ...int, default: 0 },
          unitCostCents: { ...int, default: 0 },
          restock: Boolean,
          damaged: Boolean,
          reason: String,
        },
        { _id: false },
      ),
    ],
    refundMethod: { type: String, enum: ['CASH', 'CARD'], required: true },
    refundCents: { ...int, required: true },
    refundTaxCents: { ...int, default: 0 },
    reason: String,
    shift: oid('CashShift'),
    processedBy: oid('User', true),
    processedByName: String,
    approvedBy: oid('User'),
  },
  opts,
);
returnSchema.index({ sale: 1 });
returnSchema.index({ createdAt: -1 });
export const SaleReturn = model('SaleReturn', returnSchema);

const heldSchema = new Schema(
  {
    cashier: oid('User', true),
    label: String,
    customer: oid('Customer'),
    cart: Schema.Types.Mixed,
  },
  opts,
);
heldSchema.index({ cashier: 1, createdAt: -1 });
export const HeldSale = model('HeldSale', heldSchema);
