import { create } from 'zustand';

export interface DiscountInput {
  type: 'PERCENT' | 'FIXED';
  percent?: number;
  amountCents?: number;
  note?: string;
}
export interface CartLine {
  product: string;
  name: string;
  sku: string;
  barcode?: string;
  unitSymbol: string;
  decimals: number;
  /** Shelf price for display only; the server re-prices every line at checkout. */
  priceCents: number;
  stockMilli: number;
  quantity: number;
  discount?: DiscountInput;
}
export interface CartCustomer {
  _id: string;
  name: string;
  code: string;
  phone?: string;
}

export interface ScannableProduct {
  _id: string;
  name: string;
  sku: string;
  barcode?: string;
  priceCents: number;
  onHandMilli: number;
  unitSymbol?: string;
  unitDecimals?: number;
  unit?: { symbol: string; decimals: number };
}

interface PosState {
  lines: CartLine[];
  customer: CartCustomer | null;
  orderDiscount?: DiscountInput;
  heldId: string | null;
  /** Reused across retries of the same checkout so a double-click / network retry cannot create two sales. */
  idempotencyKey: string;
  add: (p: ScannableProduct, qty?: number) => void;
  setQty: (product: string, qty: number) => void;
  remove: (product: string) => void;
  setDiscount: (product: string, d?: DiscountInput) => void;
  setOrderDiscount: (d?: DiscountInput) => void;
  setCustomer: (c: CartCustomer | null) => void;
  load: (lines: CartLine[], customer: CartCustomer | null, heldId: string | null) => void;
  clear: () => void;
  newKey: () => void;
}

const uuid = () =>
  globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const usePos = create<PosState>((set) => ({
  lines: [],
  customer: null,
  orderDiscount: undefined,
  heldId: null,
  idempotencyKey: uuid(),
  add: (p, qty = 1) =>
    set((s) => {
      const decimals = p.unitDecimals ?? p.unit?.decimals ?? 0;
      const i = s.lines.findIndex((l) => l.product === p._id);
      if (i >= 0) {
        const lines = [...s.lines];
        lines[i] = {
          ...lines[i],
          quantity: Math.round((lines[i].quantity + qty) * 1000) / 1000,
          stockMilli: p.onHandMilli,
        };
        return { lines, idempotencyKey: uuid() };
      }
      return {
        idempotencyKey: uuid(),
        lines: [
          ...s.lines,
          {
            product: p._id,
            name: p.name,
            sku: p.sku,
            barcode: p.barcode,
            unitSymbol: p.unitSymbol ?? p.unit?.symbol ?? 'pc',
            decimals,
            priceCents: p.priceCents,
            stockMilli: p.onHandMilli,
            quantity: qty,
          },
        ],
      };
    }),
  setQty: (product, quantity) =>
    set((s) => ({
      idempotencyKey: uuid(),
      lines: s.lines.map((l) => (l.product === product ? { ...l, quantity } : l)),
    })),
  remove: (product) =>
    set((s) => ({ idempotencyKey: uuid(), lines: s.lines.filter((l) => l.product !== product) })),
  setDiscount: (product, discount) =>
    set((s) => ({
      idempotencyKey: uuid(),
      lines: s.lines.map((l) => (l.product === product ? { ...l, discount } : l)),
    })),
  setOrderDiscount: (orderDiscount) => set({ orderDiscount, idempotencyKey: uuid() }),
  setCustomer: (customer) => set({ customer }),
  load: (lines, customer, heldId) =>
    set({ lines, customer, heldId, orderDiscount: undefined, idempotencyKey: uuid() }),
  clear: () =>
    set({ lines: [], customer: null, orderDiscount: undefined, heldId: null, idempotencyKey: uuid() }),
  newKey: () => set({ idempotencyKey: uuid() }),
}));

const disc = (d?: DiscountInput) =>
  d
    ? d.type === 'PERCENT'
      ? { type: 'PERCENT' as const, percent: d.percent ?? 0, note: d.note }
      : { type: 'FIXED' as const, amountCents: d.amountCents ?? 0, note: d.note }
    : undefined;

/** Shape sent to /sales/calculate and /sales. Contains quantities and discount intents only: never prices or totals. */
export const cartPayload = (lines: CartLine[], orderDiscount?: DiscountInput) => ({
  items: lines.map((l) => ({
    product: l.product,
    quantity: l.quantity,
    ...(l.discount ? { discount: disc(l.discount) } : {}),
  })),
  ...(orderDiscount ? { orderDiscount: disc(orderDiscount) } : {}),
});
