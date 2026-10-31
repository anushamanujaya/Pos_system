import { lineAmount, mulDiv } from './money';

export type DiscountSpec = { type: 'PERCENT'; valueBps: number } | { type: 'FIXED'; cents: number };

export interface CartLineInput {
  key: string;
  unitPriceCents: number;
  qtyMilli: number;
  taxRateBps: number; // 0 when untaxed
  taxCode?: string;
  discount?: DiscountSpec;
}

export interface PricedLine {
  key: string;
  grossCents: number; // price * qty
  lineDiscountCents: number;
  orderDiscountShareCents: number;
  netCents: number; // after all discounts (tax-inclusive when priceIncludesTax)
  taxCents: number;
  totalCents: number; // amount payable for the line
  taxRateBps: number;
  taxCode?: string;
}

export interface CartTotals {
  lines: PricedLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  taxBreakdown: { code: string; rateBps: number; taxableCents: number; taxCents: number }[];
}

export const discountAmount = (base: number, d?: DiscountSpec): number => {
  if (!d) return 0;
  const raw = d.type === 'PERCENT' ? mulDiv(base, d.valueBps, 10000) : d.cents;
  return Math.max(0, Math.min(base, raw)); // never exceeds the base: totals cannot go negative
};

/** Proportional split (largest remainder) so shares always sum exactly to `amount`. */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0 || amount === 0) return weights.map(() => 0);
  const shares = weights.map((w) => Math.floor((amount * w) / total));
  let rest = amount - shares.reduce((a, b) => a + b, 0);
  const order = weights.map((w, i) => ({ i, r: (amount * w) % total })).sort((a, b) => b.r - a.r);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) shares[order[k].i]++;
  return shares;
}

/**
 * Deterministic cart pricing: line discount -> order discount (spread proportionally) -> tax.
 * Tax-inclusive: tax is extracted from the net. Tax-exclusive: tax is added on top.
 */
export function priceCart(
  lines: CartLineInput[],
  opts: { priceIncludesTax: boolean; orderDiscount?: DiscountSpec },
): CartTotals {
  const base = lines.map((l) => {
    const gross = lineAmount(l.unitPriceCents, l.qtyMilli);
    return { gross, lineDisc: discountAmount(gross, l.discount) };
  });
  const afterLine = base.map((b) => b.gross - b.lineDisc);
  const afterLineTotal = afterLine.reduce((a, b) => a + b, 0);
  const orderDisc = discountAmount(afterLineTotal, opts.orderDiscount);
  const shares = allocate(orderDisc, afterLine);

  const priced: PricedLine[] = lines.map((l, i) => {
    const net = afterLine[i] - shares[i];
    let tax = 0;
    if (l.taxRateBps > 0) {
      tax = opts.priceIncludesTax
        ? net - mulDiv(net, 10000, 10000 + l.taxRateBps)
        : mulDiv(net, l.taxRateBps, 10000);
    }
    return {
      key: l.key,
      grossCents: base[i].gross,
      lineDiscountCents: base[i].lineDisc,
      orderDiscountShareCents: shares[i],
      netCents: net,
      taxCents: tax,
      totalCents: opts.priceIncludesTax ? net : net + tax,
      taxRateBps: l.taxRateBps,
      taxCode: l.taxCode,
    };
  });

  const map = new Map<string, { code: string; rateBps: number; taxableCents: number; taxCents: number }>();
  for (const p of priced) {
    if (p.taxRateBps <= 0) continue;
    const k = `${p.taxCode ?? ''}:${p.taxRateBps}`;
    const e = map.get(k) ?? { code: p.taxCode ?? '', rateBps: p.taxRateBps, taxableCents: 0, taxCents: 0 };
    e.taxableCents += p.netCents - (opts.priceIncludesTax ? p.taxCents : 0);
    e.taxCents += p.taxCents;
    map.set(k, e);
  }

  return {
    lines: priced,
    subtotalCents: priced.reduce((a, p) => a + p.grossCents, 0),
    discountCents: priced.reduce((a, p) => a + p.lineDiscountCents + p.orderDiscountShareCents, 0),
    taxCents: priced.reduce((a, p) => a + p.taxCents, 0),
    totalCents: priced.reduce((a, p) => a + p.totalCents, 0),
    taxBreakdown: [...map.values()],
  };
}

export interface TenderInput {
  method: 'CASH' | 'CARD';
  amountCents: number;
  reference?: string;
}
export interface AppliedPayment extends TenderInput {
  tenderedCents: number;
}

/**
 * Settle tenders against a total. Card (externally recorded terminal payment) can never exceed the
 * balance; cash may overpay and produce change. Throws RangeError for invalid combinations.
 * `amountCents` of returned payments is the amount APPLIED to the bill; `tenderedCents` is what was handed over.
 */
export function settlePayments(
  totalCents: number,
  tenders: TenderInput[],
): { payments: AppliedPayment[]; changeCents: number } {
  if (tenders.length === 0) throw new RangeError('At least one payment is required');
  if (tenders.some((t) => !Number.isInteger(t.amountCents) || t.amountCents <= 0)) {
    throw new RangeError('Payment amounts must be positive');
  }
  const card = tenders.filter((t) => t.method === 'CARD').reduce((a, t) => a + t.amountCents, 0);
  const cash = tenders.filter((t) => t.method === 'CASH').reduce((a, t) => a + t.amountCents, 0);
  if (card > totalCents) throw new RangeError('Card payments cannot exceed the amount due');
  if (cash + card < totalCents) throw new RangeError('Payments do not cover the total');
  const cashDue = totalCents - card;
  const change = cash - cashDue;
  let cashLeft = cashDue;
  const payments: AppliedPayment[] = [];
  for (const t of tenders) {
    if (t.method === 'CARD') {
      payments.push({ ...t, tenderedCents: t.amountCents });
    } else {
      const applied = Math.min(t.amountCents, cashLeft);
      cashLeft -= applied;
      if (applied > 0) payments.push({ ...t, amountCents: applied, tenderedCents: t.amountCents });
    }
  }
  return { payments, changeCents: change };
}
