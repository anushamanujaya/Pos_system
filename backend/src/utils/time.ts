/** Timezone helpers: compute the UTC instant at which a local calendar day starts in an IANA zone. */
function offsetMs(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Start instant (UTC) of local calendar day 'YYYY-MM-DD' in tz. */
export function zonedDayStart(day: string, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  const off = offsetMs(tz, guess);
  const start = new Date(guess.getTime() - off);
  const off2 = offsetMs(tz, start);
  return off2 === off ? start : new Date(guess.getTime() - off2);
}

export const todayInZone = (tz: string, now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** [start, end) instants covering the inclusive local days from..to */
export function rangeForDays(from: string, to: string, tz: string): { start: Date; end: Date } {
  return { start: zonedDayStart(from, tz), end: zonedDayStart(addDays(to, 1), tz) };
}
