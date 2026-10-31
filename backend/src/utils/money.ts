/**
 * Money is stored as integer minor units (LKR cents). Quantities are stored as integer
 * thousandths of the product's unit ("milli") so 1.5 kg === 1500. No floats in authoritative math.
 */
export const QTY_SCALE = 1000;

/** Convert an API quantity (e.g. 1.5) to integer milli-units, enforcing the unit's decimal precision. */
export function toMilli(qty: number, decimals: number): number {
  if (!Number.isFinite(qty) || qty <= 0) throw new RangeError('Quantity must be greater than zero');
  const milli = Math.round(qty * QTY_SCALE);
  if (Math.abs(milli - qty * QTY_SCALE) > 1e-6) throw new RangeError('Quantity has too many decimals');
  const step = 10 ** (3 - Math.min(3, decimals));
  if (milli % step !== 0) throw new RangeError(`Quantity allows at most ${decimals} decimal place(s)`);
  return milli;
}
export const fromMilli = (milli: number) => milli / QTY_SCALE;

/** round(a*b/c) with BigInt intermediates, half away from zero. */
export function mulDiv(a: number, b: number, c: number): number {
  if (c === 0) throw new RangeError('Division by zero');
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(c);
  const neg = num < 0n !== den < 0n;
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const q = (2n * n + d) / (2n * d);
  return Number(neg ? -q : q);
}

/** Line amount = unit price (cents) * quantity (milli) */
export const lineAmount = (unitCents: number, qtyMilli: number) => mulDiv(unitCents, qtyMilli, QTY_SCALE);

/** Parse a decimal money string/number ("1250.50") into integer cents without float drift. */
export function parseMoney(input: string | number): number {
  const s = String(input).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new RangeError(`Invalid money amount: ${s}`);
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  const cents = Number(i) * 100 + Number((f + '00').slice(0, 2));
  return neg ? -cents : cents;
}
export const formatMoney = (cents: number) =>
  `Rs. ${(cents / 100).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
