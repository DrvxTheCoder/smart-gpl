import { adjustmentsFor, centreSite, gridTotal, siteBalance } from "../bottle-ledger";
import { variance } from "../consignment";
import { dayOf } from "../dates";
import { closeId, isClosed, reportRows } from "../day-close";
import type { CommandResult, Env } from "../store";
import type { BottleMovement, BottleState, BrandGrid, CountSheet, SiteId } from "../types";

/* ------------------------------------------------------------------
   Stock control: physical counts (variance reviewed with a reason),
   dated adjustments, settlements of empties with other companies, and
   the day-end close that freezes the authority report.
   ------------------------------------------------------------------ */

const todayClosed = (env: Env, centreId: string) => isClosed(env.data.closes, centreId, dayOf(env.now));

/**
 * Records a physical count against the ledger. Within tolerance it is
 * settled at once; beyond, it waits for a manager with its reason.
 */
export function recordCount(env: Env, o: { site: SiteId; state: BottleState; counted: BrandGrid; reason: string | null; note: string }): CommandResult {
  const centre = o.site.startsWith("centre:") ? o.site.slice(7) : null;
  if (centre && todayClosed(env, centre)) return { ok: false, error: "Journée clôturée : enregistrez le comptage demain, il sera daté." };
  const expected = siteBalance(env.ledger, o.site)[o.state];
  // Brands never counted are counted as zero only where the ledger expects some.
  const counted: BrandGrid = {};
  for (const [b, row] of Object.entries(expected)) counted[b] = Object.fromEntries(Object.keys(row).map((f) => [f, o.counted[b]?.[f] ?? 0]));
  for (const [b, row] of Object.entries(o.counted)) counted[b] = { ...counted[b], ...row };
  if (!gridTotal(counted) && !gridTotal(expected)) return { ok: false, error: "Comptage vide : saisissez au moins une quantité." };
  const v = variance(counted, expected, env.cfg.sales.consignment.varianceTolerancePct);
  const settled = v.withinTolerance || Object.values(v.diff).every((n) => n === 0);
  if (!settled && !o.reason) return { ok: false, error: `Écart de ${v.pct.toFixed(1).replace(".", ",")} % au-delà de la tolérance : choisissez un motif avant d'enregistrer.` };
  const sheet: CountSheet = {
    id: crypto.randomUUID(),
    site: o.site,
    ts: env.now,
    by: env.by,
    state: o.state,
    counted,
    expected,
    reason: o.reason,
    note: o.note.trim(),
    status: settled ? "VALIDE" : "A_VALIDER",
    decidedBy: settled ? env.by : null,
    decidedAt: settled ? env.now : null,
  };
  const movements = settled ? adjustmentsFor({ site: o.site, state: o.state, counted, expected, ts: env.now, by: env.by, reason: o.reason ?? "COMPTAGE", countId: sheet.id }) : [];
  return { ok: true, patch: { counts: [sheet], movements }, msg: settled ? "Comptage enregistré, stock ajusté" : "Écart à valider par un responsable", kind: settled ? "success" : "warning" };
}

/** A manager validates (the ledger is brought to the count) or rejects (a recount is needed). */
export function decideCount(env: Env, countId: string, approve: boolean, note: string): CommandResult {
  if (!env.can("variance.approve")) return { ok: false, error: "Action réservée : la validation d'un écart demande un responsable." };
  const k = env.data.counts.find((x) => x.id === countId);
  if (!k || k.status !== "A_VALIDER") return { ok: false, error: "Rien à valider sur ce comptage." };
  const decided: CountSheet = { ...k, status: approve ? "VALIDE" : "REJETE", decidedBy: env.by, decidedAt: env.now, note: [k.note, note.trim()].filter(Boolean).join(" · ") };
  // Dated now: a closed day is never rewritten.
  const movements = approve ? adjustmentsFor({ site: k.site, state: k.state, counted: k.counted, expected: k.expected, ts: env.now, by: env.by, reason: k.reason ?? "COMPTAGE", countId: k.id }) : [];
  return { ok: true, patch: { counts: [decided], movements }, msg: approve ? "Écart validé, stock ajusté" : "Écart refusé : recompter", kind: approve ? "success" : "warning" };
}

/** A one-off correction, dated now, with a reason code. */
export function adjust(env: Env, o: { centreId: string; state: BottleState; brand: string; formatId: string; qty: number; reason: string }): CommandResult {
  if (!o.qty) return { ok: false, error: "Quantité nulle : saisissez l'écart à corriger, positif ou négatif." };
  if (!env.cfg.sales.reasons.adjustment.some((r) => r.code === o.reason)) return { ok: false, error: "Motif manquant : choisissez la raison de l'ajustement." };
  if (todayClosed(env, o.centreId)) return { ok: false, error: "Journée clôturée : l'ajustement sera possible demain." };
  const m: BottleMovement = { id: crypto.randomUUID(), ts: env.now, site: centreSite(o.centreId), state: o.state, brand: o.brand, formatId: o.formatId, kind: "AJUSTEMENT", qty: Math.round(o.qty), refs: {}, by: env.by, reason: o.reason };
  return { ok: true, patch: { movements: [m] }, msg: "Ajustement enregistré" };
}

/**
 * Settlement with another company: their empties go back, ours come in
 * (or a partial swap). Distinct movements keep each competitor's net position.
 */
export function exchange(env: Env, o: { centreId: string; brand: string; given: Record<string, number>; received: Record<string, number> }): CommandResult {
  if (o.brand === env.own) return { ok: false, error: "Choisissez une autre marque : l'échange se fait avec un concurrent." };
  if (todayClosed(env, o.centreId)) return { ok: false, error: "Journée clôturée : l'échange sera enregistré demain." };
  const stock = siteBalance(env.ledger, centreSite(o.centreId)).VIDE[o.brand] ?? {};
  const label = (f: string) => env.cfg.bottleTypes.find((b) => b.id === f)?.label ?? f;
  for (const [f, n] of Object.entries(o.given)) if (n > (stock[f] ?? 0)) return { ok: false, error: `Plus de vides rendues que le stock de cette marque en ${label(f)} (${(stock[f] ?? 0).toLocaleString("fr-FR")}) : corrigez la quantité.` };
  const name = env.cfg.sales.brands.find((b) => b.id === o.brand)?.name ?? o.brand;
  const id = crypto.randomUUID();
  const site = centreSite(o.centreId);
  const movements: BottleMovement[] = [
    ...Object.entries(o.given).filter(([, n]) => n > 0).map(([f, n]) => ({ id: `${id}:out:${f}`, ts: env.now, site, state: "VIDE" as const, brand: o.brand, formatId: f, kind: "ECHANGE" as const, qty: -n, refs: {}, by: env.by, reason: `Échange avec ${name}` })),
    ...Object.entries(o.received).filter(([, n]) => n > 0).map(([f, n]) => ({ id: `${id}:in:${f}`, ts: env.now, site, state: "VIDE" as const, brand: env.own, formatId: f, kind: "ECHANGE" as const, qty: n, refs: {}, by: env.by, reason: `Échange avec ${name}` })),
  ];
  if (!movements.length) return { ok: false, error: "Échange vide : saisissez les bouteilles rendues et reçues." };
  return { ok: true, patch: { movements }, msg: `Échange avec ${name} enregistré` };
}

/** Freezes a day of a centre: its authority report rows, then no more movements dated that day. */
export function closeDay(env: Env, centreId: string, date: string): CommandResult {
  if (!env.can("day.close")) return { ok: false, error: "Action réservée : la clôture journalière revient au magasinier, au chef de production ou à la direction." };
  if (date > env.today) return { ok: false, error: "Journée future : on ne clôture que le jour même ou un jour passé." };
  if (isClosed(env.data.closes, centreId, date)) return { ok: false, error: "Journée déjà clôturée." };
  const busy = env.data.dispatches.filter((d) => d.centreId === centreId && dayOf(d.slot) === date && (d.status === "EN_CHARGEMENT" || d.status === "CHARGE"));
  if (busy.length) return { ok: false, error: `Camion en cours de chargement (${busy.map((d) => d.number).join(", ")}) : expédiez-le avant de clôturer.` };
  const rows = reportRows(env.ledger, centreId, date, env.cfg.sales.brands, env.cfg.bottleTypes.map((b) => b.id));
  return { ok: true, patch: { closes: [{ id: closeId(centreId, date), centreId, date, at: env.now, by: env.by, rows }] }, msg: "Journée clôturée" };
}
