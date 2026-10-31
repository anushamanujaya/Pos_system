/** Display formatting only. All authoritative money maths happens on the server in integer cents. */
const TZ = 'Asia/Colombo';

export const money = (cents: number | null | undefined) =>
  `Rs. ${((cents ?? 0) / 100).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const qty = (milli: number | null | undefined) => {
  const v = (milli ?? 0) / 1000;
  return Number.isInteger(v)
    ? v.toLocaleString('en-LK')
    : v.toLocaleString('en-LK', { maximumFractionDigits: 3 });
};

const pad = (n: number) => String(n).padStart(2, '0');
function parts(d: Date | string, tz = TZ) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(d));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { dd: g('day'), mm: g('month'), yyyy: g('year'), hh: g('hour'), mi: g('minute') };
}
/** DD/MM/YYYY */
export const dateStr = (d?: Date | string | null, tz = TZ) => {
  if (!d) return '—';
  const p = parts(d, tz);
  return `${p.dd}/${p.mm}/${p.yyyy}`;
};
export const dateTime = (d?: Date | string | null, tz = TZ) => {
  if (!d) return '—';
  const p = parts(d, tz);
  return `${p.dd}/${p.mm}/${p.yyyy} ${p.hh}:${p.mi}`;
};
/** YYYY-MM-DD for <input type=date> in store timezone */
export const isoDay = (d: Date = new Date(), tz = TZ) => {
  const p = parts(d, tz);
  return `${p.yyyy}-${p.mm}-${p.dd}`;
};
export const addDaysIso = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};

/** Parse "1250.50" typed by a user into integer cents without float arithmetic. */
export function toCents(input: string | number): number {
  const s = String(input).trim().replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return NaN;
  const [i, f = ''] = s.split('.');
  return Number(i) * 100 + Number((f + '00').slice(0, 2));
}
export const centsToInput = (c: number | null | undefined) => ((c ?? 0) / 100).toFixed(2);

export const bpsToPercent = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
export const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
