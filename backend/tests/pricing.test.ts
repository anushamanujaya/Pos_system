import { describe, expect, it } from 'vitest';
import { mulDiv, parseMoney, toMilli, lineAmount } from '../src/utils/money';
import { allocate, discountAmount, priceCart, settlePayments } from '../src/utils/pricing';
import { rangeForDays, zonedDayStart } from '../src/utils/time';
import { parseCsv, toCsv } from '../src/utils/csv';

describe('money primitives', () => {
  it('rounds half away from zero without floating point drift', () => {
    expect(mulDiv(1, 1, 2)).toBe(1);
    expect(mulDiv(10, 1, 3)).toBe(3);
    expect(mulDiv(-5, 1, 2)).toBe(-3);
    expect(lineAmount(19900, 1500)).toBe(29850); // 1.5 kg at Rs 199.00
  });
  it('parses money strings exactly', () => {
    expect(parseMoney('1250.50')).toBe(125050);
    expect(parseMoney('0.1')).toBe(10);
    expect(() => parseMoney('1.234')).toThrow();
  });
  it('enforces unit precision', () => {
    expect(toMilli(1.5, 3)).toBe(1500);
    expect(() => toMilli(1.5, 0)).toThrow();
    expect(() => toMilli(0, 0)).toThrow();
    expect(() => toMilli(1.0005, 3)).toThrow();
  });
});

describe('cart pricing', () => {
  const line = (key: string, price: number, qty: number, rate = 0) => ({
    key,
    unitPriceCents: price,
    qtyMilli: qty * 1000,
    taxRateBps: rate,
    taxCode: rate ? 'T' : undefined,
  });

  it('extracts tax from tax-inclusive prices', () => {
    const t = priceCart([line('a', 11800, 1, 1800)], { priceIncludesTax: true });
    expect(t.totalCents).toBe(11800);
    expect(t.taxCents).toBe(1800);
    expect(t.taxBreakdown[0]).toMatchObject({ taxableCents: 10000, taxCents: 1800 });
  });
  it('adds tax on top of tax-exclusive prices', () => {
    const t = priceCart([line('a', 10000, 2, 1800)], { priceIncludesTax: false });
    expect(t.taxCents).toBe(3600);
    expect(t.totalCents).toBe(23600);
  });
  it('applies line then order discount, tax after discount', () => {
    const t = priceCart(
      [{ ...line('a', 10000, 1, 1000), discount: { type: 'PERCENT', valueBps: 1000 } }, line('b', 5000, 1)],
      { priceIncludesTax: false, orderDiscount: { type: 'FIXED', cents: 1400 } },
    );
    // a: 10000-1000 = 9000; b: 5000 => 14000; order discount 1400 spread 900/500 proportionally
    expect(t.discountCents).toBe(2400);
    expect(t.lines.reduce((s, l) => s + l.orderDiscountShareCents, 0)).toBe(1400);
    expect(t.totalCents).toBe(t.lines.reduce((s, l) => s + l.totalCents, 0));
    expect(t.lines[0].taxCents).toBe(Math.round((9000 - 900) * 0.1));
  });
  it('never produces a negative total from oversized discounts', () => {
    const t = priceCart([line('a', 1000, 1)], {
      priceIncludesTax: true,
      orderDiscount: { type: 'FIXED', cents: 999999 },
    });
    expect(t.totalCents).toBe(0);
    expect(discountAmount(500, { type: 'FIXED', cents: 900 })).toBe(500);
  });
  it('splits discounts so shares always sum exactly', () => {
    const s = allocate(100, [1, 1, 1]);
    expect(s.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('payments and change', () => {
  it('calculates change for cash overpayment', () => {
    const r = settlePayments(123450, [{ method: 'CASH', amountCents: 150000 }]);
    expect(r.changeCents).toBe(26550);
    expect(r.payments[0].amountCents).toBe(123450);
    expect(r.payments[0].tenderedCents).toBe(150000);
  });
  it('supports split card + cash', () => {
    const r = settlePayments(10000, [
      { method: 'CARD', amountCents: 4000 },
      { method: 'CASH', amountCents: 10000 },
    ]);
    expect(r.changeCents).toBe(4000);
    expect(r.payments.find((p) => p.method === 'CASH')!.amountCents).toBe(6000);
  });
  it('rejects underpayment and card overpayment', () => {
    expect(() => settlePayments(10000, [{ method: 'CASH', amountCents: 9999 }])).toThrow();
    expect(() => settlePayments(10000, [{ method: 'CARD', amountCents: 10001 }])).toThrow();
  });
});

describe('timezone day boundaries (Asia/Colombo, UTC+05:30)', () => {
  it('starts a Colombo day at 18:30Z the previous day', () => {
    expect(zonedDayStart('2026-01-01', 'Asia/Colombo').toISOString()).toBe('2025-12-31T18:30:00.000Z');
  });
  it('covers inclusive days as [start, end)', () => {
    const r = rangeForDays('2026-03-01', '2026-03-02', 'Asia/Colombo');
    expect(r.end.getTime() - r.start.getTime()).toBe(2 * 86400_000);
  });
});

describe('csv', () => {
  it('round-trips quoted values and neutralises formulas', () => {
    const csv = toCsv([{ a: 'x,y', b: '=SUM(A1)', c: 'say "hi"' }]);
    expect(csv).toContain("'=SUM(A1)");
    const rows = parseCsv('name,note\r\n"A, B","quote ""x"""\r\nC,d');
    expect(rows).toEqual([
      { name: 'A, B', note: 'quote "x"' },
      { name: 'C', note: 'd' },
    ]);
  });
});
