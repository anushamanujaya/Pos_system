export interface Id {
  _id: string;
}
export interface Named extends Id {
  name: string;
  active?: boolean;
  description?: string;
  productCount?: number;
}
export interface Unit extends Named {
  symbol: string;
  decimals: number;
  factor?: number;
}
export interface TaxRate {
  code: string;
  name: string;
  rateBps: number;
}

export interface Product extends Id {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  description?: string;
  category: string | Named;
  brand?: string | Named;
  unit: string | Unit;
  suppliers?: (string | Named)[];
  costCents: number;
  priceCents: number;
  taxCode?: string;
  packSize?: number;
  reorderLevelMilli: number;
  trackExpiry: boolean;
  status: 'ACTIVE' | 'ARCHIVED';
  imageUrl?: string;
  onHandMilli: number;
  categoryName?: string;
  brandName?: string;
  unitSymbol?: string;
  unitDecimals?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Settings {
  _id: string;
  store: { name: string; address: string; phone: string; email: string; logoUrl: string; taxId: string };
  currency: { code: string; symbol: string };
  timezone: string;
  taxRates: TaxRate[];
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

export interface SaleItem extends Id {
  product: string;
  name: string;
  sku: string;
  unitSymbol?: string;
  qtyMilli: number;
  unitPriceCents: number;
  grossCents: number;
  lineDiscountCents: number;
  orderDiscountShareCents: number;
  discountNote?: string;
  taxCents: number;
  totalCents: number;
  returnedMilli: number;
  refundedCents: number;
  taxRateBps: number;
}
export interface Sale extends Id {
  receiptNo: string;
  status: 'COMPLETED' | 'VOIDED';
  cashierName: string;
  cashier: string;
  registerName?: string;
  customerName?: string;
  items: SaleItem[];
  payments: { method: 'CASH' | 'CARD'; amountCents: number; tenderedCents?: number; reference?: string }[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  changeCents: number;
  taxBreakdown: { code: string; rateBps: number; taxableCents: number; taxCents: number }[];
  priceIncludesTax: boolean;
  refundedCents: number;
  createdAt: string;
  returns?: SaleReturn[];
}
export interface SaleReturn extends Id {
  number: string;
  saleReceiptNo: string;
  sale: string;
  refundMethod: 'CASH' | 'CARD';
  refundCents: number;
  refundTaxCents: number;
  reason?: string;
  processedByName?: string;
  createdAt: string;
  items: { name: string; qtyMilli: number; refundCents: number; restock: boolean; damaged: boolean }[];
}
export interface ReceiptData {
  receiptNo?: string;
  store: Settings['store'] & { currency?: Settings['currency']; timezone?: string };
  receipt: { footer: string; paperSize: '58mm' | '80mm' | 'A4' };
  sale: Sale;
}

export interface Shift extends Id {
  register: string | Named;
  cashier: string | Named;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt?: string;
  openingFloatCents: number;
  expectedCashCents?: number;
  countedCashCents?: number;
  varianceCents?: number;
  closingNotes?: string;
  summary?: ShiftSummary;
}
export interface ShiftSummary {
  openingFloatCents: number;
  cashSalesCents: number;
  cardSalesCents: number;
  cashRefundsCents: number;
  cardRefundsCents: number;
  cashInCents: number;
  cashOutCents: number;
  saleCount: number;
  expectedCashCents: number;
}

export interface Customer extends Id {
  code: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  active: boolean;
  visitCount: number;
  totalSpentCents: number;
  lastVisitAt?: string;
  returning?: boolean;
  recentSales?: {
    _id: string;
    receiptNo: string;
    totalCents: number;
    createdAt: string;
    refundedCents: number;
  }[];
}
export interface Supplier extends Id {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  active: boolean;
}

export interface PurchaseOrder extends Id {
  number: string;
  supplier: Named;
  status: 'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
  items: {
    _id: string;
    product: { _id: string; name: string; sku: string };
    orderedMilli: number;
    receivedMilli: number;
    costCents: number;
  }[];
  totalCents: number;
  supplierInvoiceRef?: string;
  notes?: string;
  createdAt: string;
  expectedDate?: string;
  receipts?: {
    _id: string;
    number: string;
    createdAt: string;
    totalCents: number;
    receivedBy?: Named;
    items: { product: { name: string; sku: string }; qtyMilli: number; batchNo?: string }[];
  }[];
}

export interface Employee extends Id {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'MANAGER' | 'CASHIER';
  phone?: string;
  active: boolean;
  lastLoginAt?: string;
  createdAt?: string;
  salesSummary?: { count: number; totalCents: number; refundedCents: number };
  recentShifts?: Shift[];
}

export interface Notification extends Id {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message?: string;
  link?: string;
  createdAt: string;
  read: boolean;
}
export interface Promotion extends Id {
  name: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
  scope: 'PRODUCT' | 'CATEGORY' | 'CART';
  products: Named[];
  categories: Named[];
  minCartCents: number;
  startsAt?: string;
  endsAt?: string;
  priority: number;
  active: boolean;
}
export interface Register extends Id {
  name: string;
  location?: string;
  active: boolean;
  openShift: (Shift & { cashier: Named }) | null;
}

export interface Series {
  period: string;
  count: number;
  grossCents: number;
  taxCents: number;
  discountCents: number;
  refundCents: number;
  netSalesCents: number;
  netSalesExTaxCents: number;
  cogsCents: number;
  grossProfitCents: number;
}
export interface SalesSummary {
  transactionCount: number;
  subtotalCents: number;
  discountCents: number;
  grossSalesCents: number;
  taxCents: number;
  refundCount: number;
  refundCents: number;
  refundTaxCents: number;
  netSalesCents: number;
  netSalesExTaxCents: number;
  cogsCents: number;
  grossProfitCents: number;
  averageTransactionCents: number;
}
