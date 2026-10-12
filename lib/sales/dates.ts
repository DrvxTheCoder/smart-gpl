/* Calendar helpers. Days are local yyyy-mm-dd strings, as in inventories. */

const pad = (n: number) => String(n).padStart(2, "0");

export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const parse = (date: string) => {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** The local day of an ISO instant. */
export const dayOf = (ts: string) => ymd(new Date(ts));

/** yyyy-mm-dd shifted by whole days. */
export function shiftDate(date: string, days: number): string {
  const x = parse(date);
  return ymd(new Date(x.getFullYear(), x.getMonth(), x.getDate() + days));
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  return Math.round((Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) - Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / 86_400_000);
}

/** ISO 8601 week of a day, as "yyyy-Www". */
export function isoWeek(date: string): string {
  const d = parse(date);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${pad(week)}`;
}

/** First and last day (Monday to Sunday) of an ISO week. */
export function weekRange(week: string): [string, string] {
  const [y, w] = week.split("-W").map(Number);
  const jan4 = new Date(y, 0, 4);
  const monday = new Date(y, 0, 4 - ((jan4.getDay() + 6) % 7) + (w - 1) * 7);
  return [ymd(monday), ymd(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6))];
}

/** First and last day of a "yyyy-mm" month. */
export function monthRange(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  return [`${month}-01`, ymd(new Date(y, m, 0))];
}

/** The period ("yyyy-Www" or "yyyy-mm") a day falls in. */
export const periodOf = (date: string, granularity: "SEMAINE" | "MOIS") => (granularity === "SEMAINE" ? isoWeek(date) : date.slice(0, 7));

export const periodRange = (period: string, granularity: "SEMAINE" | "MOIS") => (granularity === "SEMAINE" ? weekRange(period) : monthRange(period));

/** A local instant on a day, as ISO. */
export const at = (date: string, hh: number, mm = 0) => {
  const d = parse(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).toISOString();
};
