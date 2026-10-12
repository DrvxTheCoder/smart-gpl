import type { Inventory, TenantConfig } from "../types";
import { centreSite, siteBalance } from "./bottle-ledger";
import { at, shiftDate } from "./dates";
import { BULK, type BottleMovement, type Dispatch, type Order, type OrderLine } from "./types";

/* ------------------------------------------------------------------
   Fulls, reservations and availability. Production is derived from
   closed inventories (day + night bottles), never entered twice: it
   turns own empties into own fulls.
   ------------------------------------------------------------------ */

type Qty = Record<string, number>;

const add = (o: Qty, f: string, n: number) => {
  o[f] = (o[f] ?? 0) + n;
};

/** Bottles filled on a closed inventory, per format (day plus night shift). */
export function producedBottles(inv: Inventory): Qty {
  const out: Qty = {};
  for (const [f, n] of Object.entries(inv.bottles)) add(out, f, Number(n) || 0);
  if (inv.night.enabled) for (const [f, n] of Object.entries(inv.night.bottles)) add(out, f, Number(n) || 0);
  return out;
}

/** Ledger rows for production since `from`: own empties consumed, own fulls created. */
export function productionMovements(inventories: Inventory[], own: string, from: string): BottleMovement[] {
  const out: BottleMovement[] = [];
  for (const inv of inventories) {
    if (inv.status !== "TERMINE" || inv.date < from) continue;
    const ts = at(inv.date, 20);
    for (const [f, n] of Object.entries(producedBottles(inv))) {
      if (!n) continue;
      const base = { ts, site: centreSite(inv.centreId), brand: own, formatId: f, kind: "PRODUCTION" as const, refs: {}, by: inv.startedBy };
      out.push({ ...base, id: `prod:${inv.id}:${f}:p`, state: "PLEIN", qty: n });
      out.push({ ...base, id: `prod:${inv.id}:${f}:v`, state: "VIDE", qty: -n });
    }
  }
  return out;
}

/** Opening own fulls from the tenant configuration, at the start of the ledger. */
export function openingMovements(cfg: TenantConfig, own: string, from: string): BottleMovement[] {
  const out: BottleMovement[] = [];
  for (const [centreId, qty] of Object.entries(cfg.sales.openingStock))
    for (const [f, n] of Object.entries(qty))
      if (n) out.push({ id: `open:${centreId}:${f}`, ts: at(from, 0), site: centreSite(centreId), state: "PLEIN", brand: own, formatId: f, kind: "OUVERTURE", qty: n, refs: {}, by: "Configuration" });
  return out;
}

/** Own fulls at a centre per format, from the ledger. */
export function ownFulls(movements: BottleMovement[], centreId: string, own: string, until?: string): Qty {
  return { ...(siteBalance(movements, centreSite(centreId), { until }).PLEIN[own] ?? {}) };
}

/** Quantities that left with an order: dispatches expedited or delivered. */
export function dispatchedQty(dispatches: Dispatch[], orderId: string): Qty {
  const out: Qty = {};
  for (const d of dispatches) if (d.orderId === orderId && (d.status === "EXPEDIE" || d.status === "LIVRE")) for (const [f, n] of Object.entries(d.loaded)) add(out, f, n);
  return out;
}

/** Quantities on trucks being loaded or planned, not yet expedited. */
export function plannedQty(dispatches: Dispatch[], orderId: string): Qty {
  const out: Qty = {};
  for (const d of dispatches) if (d.orderId === orderId && d.status !== "EXPEDIE" && d.status !== "LIVRE") for (const [f, n] of Object.entries(d.loaded)) add(out, f, n);
  return out;
}

const orderedQty = (lines: OrderLine[]): Qty => {
  const out: Qty = {};
  for (const l of lines) add(out, l.formatId, l.qty);
  return out;
};

/** Still to serve: ordered − dispatched − declared reliquats, never below zero. */
export function remainingQty(order: Order, dispatches: Dispatch[]): Qty {
  const sent = dispatchedQty(dispatches, order.id);
  const out: Qty = {};
  for (const l of order.lines) add(out, l.formatId, l.qty);
  for (const [f, n] of Object.entries(sent)) add(out, f, -n);
  for (const r of order.reliquats) add(out, r.formatId, -r.qty);
  for (const f of Object.keys(out)) out[f] = Math.max(out[f], 0);
  return out;
}

const OPEN: Order["status"][] = ["CONFIRMEE", "EXPEDIEE"];

/** Fulls promised to confirmed orders and not yet gone, per format. */
export function reservedQty(orders: Order[], dispatches: Dispatch[], centreId: string, exceptOrderId?: string): Qty {
  const out: Qty = {};
  for (const o of orders) {
    if (o.centreId !== centreId || !OPEN.includes(o.status) || o.id === exceptOrderId) continue;
    for (const [f, n] of Object.entries(remainingQty(o, dispatches))) if (f !== BULK) add(out, f, n);
  }
  return out;
}

/** Average daily production over the last `window` closed days, per format. */
export function dailyProduction(inventories: Inventory[], centreId: string, today: string, window = 7): Qty {
  const closed = inventories.filter((i) => i.centreId === centreId && i.status === "TERMINE" && i.date < today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, window);
  const out: Qty = {};
  for (const inv of closed) for (const [f, n] of Object.entries(producedBottles(inv))) add(out, f, n / closed.length);
  return out;
}

/**
 * Available to promise per format: fulls − reserved (when confirmed orders
 * reserve) + production expected within the horizon.
 */
export function atp(opts: { fulls: Qty; reserved: Qty; daily: Qty; horizonDays: number; reserveOnConfirm: boolean }): Qty {
  const out: Qty = {};
  const formats = new Set([...Object.keys(opts.fulls), ...Object.keys(opts.daily), ...Object.keys(opts.reserved)]);
  for (const f of formats) out[f] = Math.floor((opts.fulls[f] ?? 0) - (opts.reserveOnConfirm ? opts.reserved[f] ?? 0 : 0) + (opts.daily[f] ?? 0) * opts.horizonDays);
  return out;
}

export interface Shortfall {
  formatId: string;
  qty: number;
}

/** Bottle lines asking for more than is available. Bulk is not checked here. */
export function shortfalls(lines: OrderLine[], available: Qty): Shortfall[] {
  const want = orderedQty(lines.filter((l) => l.formatId !== BULK));
  return Object.entries(want)
    .map(([formatId, q]) => ({ formatId, qty: q - Math.max(available[formatId] ?? 0, 0) }))
    .filter((s) => s.qty > 0);
}

/** The ledger window: the sales history starts this many days back. */
export const LEDGER_DAYS = 60;
export const ledgerStart = (today: string) => shiftDate(today, -LEDGER_DAYS);
