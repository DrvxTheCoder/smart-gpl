import { isNum, isObj, isStr, type Obj } from "../checker";
import type { Collection, SalesData } from "./types";

/* ------------------------------------------------------------------
   Sales state = deterministic demo seed + what was created on this
   device (the overlay). Only the overlay is persisted, so the demo keeps
   rolling with "today" while user documents and ledger rows survive.
   ------------------------------------------------------------------ */

const SALES_STORAGE_VERSION = 1;

const COLLECTIONS: Collection[] = ["customers", "contracts", "forecasts", "orders", "dispatches", "movements", "entries", "incidents", "settlements", "counts", "declarations", "calls", "closes"];

export const emptyData = (): SalesData => ({
  customers: [],
  contracts: [],
  forecasts: [],
  orders: [],
  dispatches: [],
  movements: [],
  entries: [],
  incidents: [],
  settlements: [],
  counts: [],
  declarations: [],
  calls: [],
  closes: [],
});

/** Items to add or replace, by id, per collection. Ledger rows are only ever added. */
export type Patch = { [K in Collection]?: SalesData[K] };
export type Overlay = { [K in Collection]?: Record<string, SalesData[K][number]> };

/** Upserts by id; replaced items keep their place, new ones are appended. */
export function applyPatch(data: SalesData, patch: Patch): SalesData {
  const next = { ...data };
  for (const k of COLLECTIONS) {
    const items = patch[k] as { id: string }[] | undefined;
    if (!items?.length) continue;
    const byId = new Map(items.map((x) => [x.id, x]));
    const list = (data[k] as { id: string }[]).map((x) => {
      const hit = byId.get(x.id);
      if (hit) byId.delete(x.id);
      return hit ?? x;
    });
    (next[k] as { id: string }[]) = [...list, ...byId.values()];
  }
  return next;
}

export function addToOverlay(overlay: Overlay, patch: Patch): Overlay {
  const next: Overlay = { ...overlay };
  for (const k of COLLECTIONS) {
    const items = patch[k] as { id: string }[] | undefined;
    if (!items?.length) continue;
    const rec = { ...((overlay[k] as Record<string, { id: string }> | undefined) ?? {}) };
    for (const x of items) rec[x.id] = x;
    (next[k] as Record<string, { id: string }>) = rec;
  }
  return next;
}

const overlayPatch = (o: Overlay): Patch => Object.fromEntries(COLLECTIONS.filter((k) => o[k]).map((k) => [k, Object.values(o[k] as object)])) as Patch;

export const mergeOverlay = (seed: SalesData, overlay: Overlay) => applyPatch(seed, overlayPatch(overlay));

export const storedOverlay = (o: Overlay) => JSON.stringify({ version: SALES_STORAGE_VERSION, overlay: o });

/* What each stored item must have to be usable; anything else is dropped. */
const SHAPE: Record<Collection, { str: string[]; arr?: string[]; obj?: string[]; num?: string[] }> = {
  customers: { str: ["code", "name", "categoryId", "zone"], arr: ["centreIds"], obj: ["contact"] },
  contracts: { str: ["customerId", "validFrom"], num: ["version"], obj: ["terms"] },
  forecasts: { str: ["centreId", "granularity", "basis", "createdAt"], num: ["version"], arr: ["lines"] },
  orders: { str: ["number", "centreId", "customerId", "status", "mode", "createdAt"], arr: ["lines", "reliquats", "history"], obj: ["approval"] },
  dispatches: { str: ["number", "orderId", "centreId", "customerId", "status", "slot"], obj: ["empties", "damaged", "loaded"], arr: ["gateIn", "loading", "delivery", "history"] },
  movements: { str: ["ts", "site", "state", "brand", "formatId", "kind"], num: ["qty"], obj: ["refs"] },
  entries: { str: ["customerId", "ts", "kind", "label"], num: ["amount"], obj: ["refs"] },
  incidents: { str: ["customerId", "ts", "kind"] },
  settlements: { str: ["number", "customerId", "centreId", "ts", "status"], num: ["amount"], obj: ["empties", "sold", "given"] },
  counts: { str: ["site", "ts", "state", "status"], obj: ["counted", "expected"] },
  declarations: { str: ["customerId", "ts"], obj: ["sold"] },
  calls: { str: ["customerId", "ts", "outcome"] },
  closes: { str: ["centreId", "date", "at"], arr: ["rows"] },
};

const usable = (x: unknown, s: (typeof SHAPE)[Collection]): x is Obj & { id: string } =>
  isObj(x) &&
  isStr(x.id) &&
  s.str.every((k) => isStr(x[k])) &&
  (s.arr ?? []).every((k) => Array.isArray(x[k])) &&
  (s.obj ?? []).every((k) => isObj(x[k])) &&
  (s.num ?? []).every((k) => isNum(x[k]));

/**
 * Reads the persisted overlay. Never throws: unreadable storage gives an
 * empty overlay and a notice; malformed items are dropped one by one.
 */
export function loadOverlay(text: string | null): { overlay: Overlay; notice: string | null } {
  if (text == null) return { overlay: {}, notice: null };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { overlay: {}, notice: "Données de vente enregistrées illisibles : démo restaurée." };
  }
  if (!isObj(raw) || raw.version !== SALES_STORAGE_VERSION || !isObj(raw.overlay)) return { overlay: {}, notice: "Données de vente enregistrées illisibles : démo restaurée." };
  const overlay: Overlay = {};
  let dropped = 0;
  for (const k of COLLECTIONS) {
    const rec = raw.overlay[k];
    if (rec === undefined) continue;
    if (!isObj(rec)) {
      dropped++;
      continue;
    }
    const kept: Record<string, unknown> = {};
    for (const [id, x] of Object.entries(rec)) {
      if (usable(x, SHAPE[k]) && x.id === id) kept[id] = x;
      else dropped++;
    }
    (overlay[k] as Record<string, unknown>) = kept;
  }
  return { overlay, notice: dropped ? `${dropped} élément${dropped > 1 ? "s" : ""} de vente enregistré${dropped > 1 ? "s" : ""} illisible${dropped > 1 ? "s" : ""}, ignoré${dropped > 1 ? "s" : ""}.` : null };
}
