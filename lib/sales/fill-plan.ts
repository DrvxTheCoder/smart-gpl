import type { BottleType } from "../types";
import type { Tone } from "./solvency";

/* ------------------------------------------------------------------
   Fill plan over a horizon. Per format:
     needed = forecast not yet ordered + recent reliquats
              − (fulls − reserved) + safety cover
   Only own empties can be filled, so they bound the plan: the stock on
   hand plus the own-brand empties expected back over the horizon (a
   customer returning competitor bottles shrinks them). Tonnes come
   from the format weight and are compared with the lines' capacity over
   the useful hours actually achieved lately.
   ------------------------------------------------------------------ */

type Qty = Record<string, number>;

export interface FillRow {
  formatId: string;
  label: string;
  forecast: number; // forecast for the horizon, not yet ordered
  reliquat: number;
  free: number; // fulls − reserved
  safety: number;
  needed: number; // bottles to fill
  ownEmpties: number; // on hand
  incoming: number; // own empties expected back over the horizon
  emptiesShort: number;
  tonnes: number;
}

export interface FillPlan {
  rows: FillRow[];
  totalT: number;
  capacityT: number;
  loadPct: number;
  tone: Tone;
  reasons: string[];
}

export function fillPlan(o: {
  formats: BottleType[];
  forecast: Qty;
  reliquat: Qty;
  fulls: Qty;
  reserved: Qty;
  dailyForecast: Qty;
  safetyDays: number;
  ownEmpties: Qty;
  incomingEmpties: Qty;
  capacityTph: number;
  usefulHoursPerDay: number;
  days: number;
  warnPct: number;
}): FillPlan {
  const rows: FillRow[] = o.formats.map((b) => {
    const free = (o.fulls[b.id] ?? 0) - (o.reserved[b.id] ?? 0);
    const safety = Math.round((o.dailyForecast[b.id] ?? 0) * o.safetyDays);
    const forecast = Math.round(o.forecast[b.id] ?? 0);
    const reliquat = Math.round(o.reliquat[b.id] ?? 0);
    const needed = Math.max(forecast + reliquat - free + safety, 0);
    const ownEmpties = Math.max(o.ownEmpties[b.id] ?? 0, 0);
    const incoming = Math.max(Math.round(o.incomingEmpties[b.id] ?? 0), 0);
    return { formatId: b.id, label: b.label, forecast, reliquat, free, safety, needed, ownEmpties, incoming, emptiesShort: Math.max(needed - ownEmpties - incoming, 0), tonnes: (needed * b.kg) / 1000 };
  });
  const totalT = rows.reduce((a, r) => a + r.tonnes, 0);
  const capacityT = o.capacityTph * o.usefulHoursPerDay * o.days;
  const loadPct = capacityT ? (totalT / capacityT) * 100 : totalT ? Infinity : 0;
  const reasons: string[] = [];
  const short = rows.filter((r) => r.emptiesShort > 0);
  const tight = rows.filter((r) => r.needed > 0 && r.emptiesShort === 0 && r.ownEmpties + r.incoming < r.needed * 1.1);
  for (const r of short) reasons.push(`Vides insuffisantes en ${r.label} : ${r.emptiesShort.toLocaleString("fr-FR")} bouteilles de votre marque manquent, retours attendus compris.`);
  if (loadPct > 100) reasons.push(`Capacité dépassée : ${Math.round(loadPct)} % des lignes sur l'horizon. Prévoyez un quart de nuit ou étalez les livraisons.`);
  else if (loadPct > o.warnPct) reasons.push(`Lignes chargées à ${Math.round(loadPct)} % : peu de marge en cas d'arrêt.`);
  for (const r of tight) reasons.push(`Vides justes en ${r.label} : moins de 10 % de marge.`);
  const tone: Tone = short.length || loadPct > 100 ? "alert" : loadPct > o.warnPct || tight.length ? "warn" : "ok";
  return { rows, totalT, capacityT, loadPct, tone, reasons };
}
