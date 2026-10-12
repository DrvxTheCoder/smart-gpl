import type { Inventory } from "../types";
import { dayOf, periodOf } from "./dates";
import { producedBottles } from "./stock";
import { BULK, type Customer, type Dispatch, type Forecast, type ForecastLine, type Order, type Settlement } from "./types";

/* ------------------------------------------------------------------
   Forecasts measured against what happened. Demand is what customers
   ordered; for wholesalers it is what they sold (sell-out), a better
   signal than what they took. Accuracy is MAPE and signed bias; service
   is fill rate (served / ordered) and OTIF (in full, on time).
   ------------------------------------------------------------------ */

type Granularity = Forecast["granularity"];

/** Versions of a centre's forecasts at a granularity, newest first. */
export const versionsOf = (forecasts: Forecast[], centreId: string, g: Granularity) => forecasts.filter((f) => f.centreId === centreId && f.granularity === g).sort((a, b) => b.version - a.version);

const k3 = (period: string, key: string, f: string) => `${period}|${key}|${f}`;

/** Forecast quantity per period × customer × format, the scope resolved to customers. */
export function forecastCells(fc: Forecast, customers: Customer[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of fc.lines) {
    if (l.scope === "CLIENT") out.set(k3(l.period, l.key, l.formatId), (out.get(k3(l.period, l.key, l.formatId)) ?? 0) + l.qty);
    else {
      // A category or zone line is spread evenly over its customers, enough to compare totals.
      const members = customers.filter((c) => (l.scope === "CATEGORIE" ? c.categoryId === l.key : c.zone === l.key));
      for (const c of members) out.set(k3(l.period, c.id, l.formatId), (out.get(k3(l.period, c.id, l.formatId)) ?? 0) + l.qty / members.length);
    }
  }
  return out;
}

/** Actual demand per period × customer × format: orders (by requested date), wholesaler sell-out. */
export function demandCells(o: { orders: Order[]; settlements: Settlement[]; centreId: string; granularity: Granularity }): Map<string, number> {
  const out = new Map<string, number>();
  const add = (p: string, c: string, f: string, n: number) => out.set(k3(p, c, f), (out.get(k3(p, c, f)) ?? 0) + n);
  for (const ord of o.orders) {
    if (ord.centreId !== o.centreId || ord.status === "BROUILLON" || ord.status === "ANNULEE") continue;
    for (const l of ord.lines) if (l.formatId !== BULK) add(periodOf(ord.date, o.granularity), ord.customerId, l.formatId, l.qty);
  }
  for (const s of o.settlements) {
    if (s.centreId !== o.centreId || s.status !== "CONFIRME") continue;
    for (const [f, n] of Object.entries(s.sold)) add(periodOf(dayOf(s.ts), o.granularity), s.customerId, f, n);
  }
  return out;
}

export interface Accuracy {
  mape: number | null; // mean absolute percentage error, %
  bias: number | null; // (Σ forecast − Σ actual) / Σ actual, signed %
  forecast: number;
  actual: number;
  cells: number;
}

/** Accuracy over the given periods, optionally for one format or one customer. */
export function accuracy(fc: Map<string, number>, actual: Map<string, number>, periods: string[], filter: { formatId?: string; customerId?: string } = {}): Accuracy {
  const keys = new Set<string>();
  const ps = new Set(periods);
  for (const k of [...fc.keys(), ...actual.keys()]) {
    const [p, c, f] = k.split("|");
    if (ps.has(p) && (!filter.formatId || f === filter.formatId) && (!filter.customerId || c === filter.customerId)) keys.add(k);
  }
  let ape = 0;
  let n = 0;
  let sf = 0;
  let sa = 0;
  for (const k of keys) {
    const f = fc.get(k) ?? 0;
    const a = actual.get(k) ?? 0;
    sf += f;
    sa += a;
    if (a > 0) {
      ape += Math.abs(f - a) / a;
      n++;
    }
  }
  return { mape: n ? (ape / n) * 100 : null, bias: sa ? ((sf - sa) / sa) * 100 : null, forecast: sf, actual: sa, cells: n };
}

/** Totals per period (all customers and formats, or one format). */
export function perPeriod(cells: Map<string, number>, periods: string[], formatId?: string): number[] {
  const idx = new Map(periods.map((p, i) => [p, i]));
  const out = periods.map(() => 0);
  for (const [k, v] of cells) {
    const [p, , f] = k.split("|");
    const i = idx.get(p);
    if (i != null && (!formatId || f === formatId)) out[i] += v;
  }
  return out;
}

/* ---------------- service level ---------------- */

const counted = (o: Order, from: string, to: string, centreId: string) =>
  (centreId === "all" || o.centreId === centreId) && o.date >= from && o.date <= to && o.status !== "BROUILLON" && o.status !== "ANNULEE";

/** Served / ordered, in bottles, over orders requested between two days. Bulk excluded. */
export function fillRate(orders: Order[], dispatches: Dispatch[], from: string, to: string, centreId: string) {
  let ordered = 0;
  let served = 0;
  const byOrder = new Map<string, Record<string, number>>();
  for (const d of dispatches) {
    if (d.status !== "EXPEDIE" && d.status !== "LIVRE") continue;
    const m = byOrder.get(d.orderId) ?? {};
    for (const [f, n] of Object.entries(d.loaded)) m[f] = (m[f] ?? 0) + n;
    byOrder.set(d.orderId, m);
  }
  for (const o of orders) {
    if (!counted(o, from, to, centreId)) continue;
    const sent = byOrder.get(o.id) ?? {};
    for (const l of o.lines) {
      if (l.formatId === BULK) continue;
      ordered += l.qty;
      served += Math.min(sent[l.formatId] ?? 0, l.qty);
    }
  }
  return { ordered, served, rate: ordered ? (served / ordered) * 100 : null };
}

/**
 * On time, in full: share of orders whose every line left complete, the last
 * truck no later than the requested day. Orders still open are not judged.
 */
export function otif(orders: Order[], dispatches: Dispatch[], from: string, to: string, centreId: string) {
  let judged = 0;
  let ok = 0;
  for (const o of orders) {
    if (!counted(o, from, to, centreId) || o.status === "CONFIRMEE") continue;
    const mine = dispatches.filter((d) => d.orderId === o.id && (d.status === "EXPEDIE" || d.status === "LIVRE"));
    if (!mine.length) continue;
    judged++;
    const sent: Record<string, number> = {};
    for (const d of mine) for (const [f, n] of Object.entries(d.loaded)) sent[f] = (sent[f] ?? 0) + n;
    const full = o.lines.every((l) => (sent[l.formatId] ?? 0) >= l.qty);
    const onTime = mine.every((d) => dayOf(d.slot) <= o.date);
    if (full && onTime) ok++;
  }
  return { judged, ok, rate: judged ? (ok / judged) * 100 : null };
}

/** Bottles not served, by reason, over orders requested between two days. */
export function reliquats(orders: Order[], from: string, to: string, centreId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of orders) if (counted(o, from, to, centreId)) for (const r of o.reliquats) if (r.formatId !== BULK) out[r.reason] = (out[r.reason] ?? 0) + r.qty;
  return out;
}

/** Bottles produced per period, from closed inventories. */
export function productionPerPeriod(inventories: Inventory[], centreId: string, periods: string[], granularity: Granularity, formatId?: string): number[] {
  const idx = new Map(periods.map((p, i) => [p, i]));
  const out = periods.map(() => 0);
  for (const inv of inventories) {
    if (inv.status !== "TERMINE" || (centreId !== "all" && inv.centreId !== centreId)) continue;
    const i = idx.get(periodOf(inv.date, granularity));
    if (i == null) continue;
    for (const [f, n] of Object.entries(producedBottles(inv))) if (!formatId || f === formatId) out[i] += n;
  }
  return out;
}

/** A new version from a grid of quantities: revisions never overwrite. */
export function nextVersion(previous: Forecast | undefined, o: { id: string; centreId: string; granularity: Granularity; by: string; now: string; lines: ForecastLine[] }): Forecast {
  // Periods not in the grid keep the previous version's figures.
  const edited = new Set(o.lines.map((l) => l.period));
  const kept = previous ? previous.lines.filter((l) => !edited.has(l.period)) : [];
  return {
    id: o.id,
    centreId: o.centreId,
    granularity: o.granularity,
    version: (previous?.version ?? 0) + 1,
    basis: previous ? "REVISION" : "INITIALE",
    createdBy: o.by,
    createdAt: o.now,
    lines: [...kept, ...o.lines.filter((l) => l.qty > 0)],
  };
}

/** Pasted spreadsheet block (tabs between cells, one row per line) to numbers. */
export function parseBlock(text: string): number[][] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((row, i, all) => row.trim() !== "" || i < all.length - 1)
    .map((row) => row.split("\t").map((c) => Math.max(Math.round(Number(c.replace(/[\s  ]/g, "").replace(",", "."))) || 0, 0)));
}

/** Tone of a rate against [ok, warn] thresholds; `lower` when smaller is better (MAPE). */
export function band(v: number | null, [ok, warn]: [number, number], lower = false): "ok" | "warn" | "alert" | null {
  if (v == null) return null;
  if (lower) return v <= ok ? "ok" : v <= warn ? "warn" : "alert";
  return v >= ok ? "ok" : v >= warn ? "warn" : "alert";
}
