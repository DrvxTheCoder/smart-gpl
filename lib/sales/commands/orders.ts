import { clientSite, reverse, siteBalance } from "../bottle-ledger";
import { categoryOf, contractAt } from "../contracts";
import { overCap } from "../consignment";
import { wholesalerStatuses } from "../alerts";
import { at, dayOf } from "../dates";
import { ageing, decideCredit, openDebits, type CreditDecision } from "../exposure";
import { approvalReasons, formatNumber, ORDER_FLOW, run, syncOrder, type Failure } from "../lifecycle";
import { linesAmount, priceFor } from "../pricing";
import { customerPosition } from "../selectors";
import { atp, dailyProduction, ownFulls, remainingQty, reservedQty, shortfalls, type Shortfall } from "../stock";
import type { CommandResult, Env } from "../store";
import { BULK, type AccountEntry, type DeliveryMode, type Dispatch, type Order, type OrderLine } from "../types";

/* ------------------------------------------------------------------
   Orders (BC): draft, confirm, approve, cancel or rectify, reliquat,
   close, and planning a truck. Rules live in lifecycle.ts; this file
   gathers the facts they need and writes the resulting documents.
   ------------------------------------------------------------------ */

export interface OrderCheck {
  amount: number;
  credit: CreditDecision;
  shortfalls: Shortfall[];
  available: Record<string, number>;
  placementBlocked: string | null;
  overCap: string[];
  approval: string[]; // reasons a manager must validate, if confirmed as is
  failures: Failure[]; // what blocks confirmation right now
}

/** Everything the counter needs to know about an order before confirming it. */
export function checkOrder(env: Env, order: Order, override: { by: string; reason: string } | null = null): OrderCheck {
  const sc = env.cfg.sales;
  const customer = env.data.customers.find((c) => c.id === order.customerId);
  const amount = linesAmount(order.lines);
  const pos = customer ? customerPosition(env, customer, order.id) : null;
  const category = customer ? categoryOf(sc, customer) : undefined;
  const credit = pos && category
    ? decideCredit({ enabled: sc.workflow.steps.creditCheck, amount, exposure: pos.exposure, limit: pos.terms.creditLimit, rule: category.credit, overdue: ageing(openDebits(env.data.entries, order.customerId, env.today)), currency: sc.currency.label })
    : { decision: "ALLOW" as const, reasons: [] };
  const available = atp({
    fulls: ownFulls(env.ledger, order.centreId, env.own),
    reserved: reservedQty(env.data.orders, env.data.dispatches, order.centreId, order.id),
    daily: dailyProduction(env.inventories, order.centreId, env.today),
    horizonDays: sc.stock.atpHorizonDays,
    reserveOnConfirm: sc.workflow.steps.reserveOnConfirm,
  });
  const short = shortfalls(order.lines, available);

  // Wholesalers: placements stop when the ladder says so, and need approval beyond the float cap.
  let placementBlocked: string | null = null;
  const caps: string[] = [];
  if (pos?.wholesaler && customer) {
    const status = wholesalerStatuses({ cfg: env.cfg, data: env.data, ledger: env.ledger, today: env.today, own: env.own, centreId: "all" }).find((w) => w.customer.id === customer.id);
    if (status?.step?.action === "BLOQUER") placementBlocked = `Mises en consignation bloquées : ${status.daysSince} jours sans passage (seuil ${status.threshold} j). Enregistrez d'abord un passage du grossiste.`;
    const held = { ...(siteBalance(env.ledger, clientSite(customer.id)).PLEIN[env.own] ?? {}) };
    for (const l of order.lines) held[l.formatId] = (held[l.formatId] ?? 0) + l.qty;
    const label = (f: string) => env.cfg.bottleTypes.find((b) => b.id === f)?.label ?? f;
    for (const o of overCap(held, pos.terms.floatCap)) caps.push(`Plafond de consignation dépassé en ${label(o.formatId)} : ${o.held.toLocaleString("fr-FR")} bouteilles chez le grossiste pour un plafond de ${o.cap.toLocaleString("fr-FR")}.`);
  }

  const ctx = { order, amount, currency: sc.currency.label, credit, override, shortfalls: short, backorder: sc.stock.backorder, placementBlocked, loadingStarted: false, reason: "" };
  const r = run(ORDER_FLOW, "confirm", "BROUILLON", ctx, sc.workflow.steps);
  return { amount, credit, shortfalls: short, available, placementBlocked, overCap: caps, approval: approvalReasons(ctx, sc.workflow.steps, sc.workflow.approvalThreshold, caps), failures: r.ok ? [] : r.failures };
}

export interface DraftInput {
  id: string; // chosen by the caller, so a new draft can be confirmed right after
  customerId: string;
  centreId: string;
  mode: DeliveryMode;
  date: string;
  qty: Record<string, number>; // per format, kg for BULK
}

/** Lines priced from the contract in force on the order date. */
export function priceLines(env: Env, customerId: string, date: string, qty: Record<string, number>): OrderLine[] {
  const terms = contractAt(env.data.contracts, customerId, date)?.terms;
  const ids = [...env.cfg.bottleTypes.map((b) => b.id), BULK];
  return ids.filter((f) => (qty[f] ?? 0) > 0).map((f) => ({ formatId: f, qty: Math.round(qty[f]), price: terms ? priceFor(env.cfg.sales.priceLists, terms.priceListId, f, date) ?? 0 : 0 }));
}

function nextNumber(env: Env, centreId: string, date: string, pattern: string, docs: { centreId: string; createdAt?: string; slot?: string; ts?: string }[]) {
  const year = date.slice(0, 4);
  const seq = docs.filter((d) => d.centreId === centreId && dayOf(d.createdAt ?? d.slot ?? d.ts ?? "").startsWith(year)).length + 1;
  return formatNumber(pattern, { centre: env.cfg.centres.find((c) => c.id === centreId)?.code ?? centreId.toUpperCase(), date, seq });
}

/** Creates or updates a draft. Only a draft can change; validated orders go through rectification. */
export function saveDraft(env: Env, input: DraftInput): CommandResult {
  const customer = env.data.customers.find((c) => c.id === input.customerId);
  if (!customer) return { ok: false, error: "Client manquant : choisissez le client avant de saisir les quantités." };
  if (!customer.active) return { ok: false, error: "Client inactif : réactivez sa fiche pour lui vendre." };
  if (input.centreId === "all") return { ok: false, error: "Centre manquant : choisissez le centre qui sert la commande." };
  if (input.date < env.today) return { ok: false, error: "Date passée : la date souhaitée est aujourd'hui ou plus tard." };
  const contract = contractAt(env.data.contracts, customer.id, input.date);
  if (!contract) return { ok: false, error: "Aucun contrat en vigueur à cette date : créez une version du contrat sur la fiche client." };
  const existing = env.data.orders.find((o) => o.id === input.id);
  if (existing && existing.status !== "BROUILLON") return { ok: false, error: "Commande validée : elle est en lecture seule. Utilisez « Annuler / rectifier »." };
  const lines = priceLines(env, customer.id, input.date, input.qty);
  const order: Order = existing
    ? { ...existing, customerId: customer.id, centreId: input.centreId, mode: input.mode, date: input.date, lines, contractVersion: contract.version, workflowVersion: env.cfg.sales.workflow.version }
    : {
        id: input.id,
        number: nextNumber(env, input.centreId, env.today, env.cfg.sales.workflow.numbering.order, env.data.orders),
        centreId: input.centreId,
        customerId: customer.id,
        contractVersion: contract.version,
        workflowVersion: env.cfg.sales.workflow.version,
        mode: input.mode,
        date: input.date,
        createdAt: env.now,
        createdBy: env.by,
        lines,
        status: "BROUILLON",
        approval: { required: false, reasons: [], by: null, at: null, note: null },
        reliquats: [],
        history: [{ at: env.now, by: env.by, label: "Commande créée" }],
        replaces: null,
        replacedBy: null,
        exported: false,
      };
  return { ok: true, patch: { orders: [order] }, msg: existing ? "" : `Brouillon ${order.number} créé`, goTo: `/ventes/commandes/${order.id}` };
}

/** Confirms a draft. A blocked credit needs an override (permission + reason); approval may be required after. */
export function confirmOrder(env: Env, orderId: string, opts: { override?: string } = {}): CommandResult {
  const order = env.data.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, error: "Commande introuvable." };
  const override = opts.override?.trim() ? { by: env.by, reason: opts.override.trim() } : null;
  if (override && !env.can("credit.override")) return { ok: false, error: "Action réservée : seul un responsable peut forcer un dépassement de crédit." };
  const check = checkOrder(env, order, override);
  if (check.failures.length) return { ok: false, error: check.failures.map((f) => f.message).join(" ") };
  const history = [...order.history, { at: env.now, by: env.by, label: "Commande confirmée" }];
  if (override) history.push({ at: env.now, by: env.by, label: "Dépassement de crédit forcé", note: override.reason });
  if (check.shortfalls.length) history.push({ at: env.now, by: env.by, label: "Reliquat prévu", note: "Stock disponible insuffisant à la confirmation" });
  const required = check.approval.length > 0;
  const confirmed: Order = { ...order, status: "CONFIRMEE", history, approval: { required, reasons: check.approval, by: null, at: null, note: null }, workflowVersion: env.cfg.sales.workflow.version };
  return { ok: true, patch: { orders: [confirmed] }, msg: required ? `Commande ${order.number} confirmée, en attente de validation` : `Commande ${order.number} confirmée`, kind: required ? "warning" : "success" };
}

export function approveOrder(env: Env, orderId: string, note: string): CommandResult {
  if (!env.can("order.approve")) return { ok: false, error: "Action réservée : la validation demande un responsable commercial ou la direction." };
  const order = env.data.orders.find((o) => o.id === orderId);
  if (!order || order.status !== "CONFIRMEE" || !order.approval.required || order.approval.by) return { ok: false, error: "Rien à valider sur cette commande." };
  const approved: Order = { ...order, approval: { ...order.approval, by: env.by, at: env.now, note: note.trim() || null }, history: [...order.history, { at: env.now, by: env.by, label: "Commande validée", note: note.trim() || undefined }] };
  return { ok: true, patch: { orders: [approved] }, msg: `Commande ${order.number} validée` };
}

/**
 * Cancels an order. A draft or an untouched confirmed order is simply
 * cancelled. Anything already loaded or expedited is reversed: mirror
 * movements and entries carry the reason, and nothing is deleted.
 * With `rectify`, a new draft copies the order and points back to it.
 */
export function cancelOrder(env: Env, orderId: string, reason: string, rectify: boolean): CommandResult {
  const order = env.data.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, error: "Commande introuvable." };
  if (!reason.trim()) return { ok: false, error: "Motif obligatoire : indiquez pourquoi la commande est annulée." };
  if (order.status === "ANNULEE") return { ok: false, error: "Commande déjà annulée." };
  if (order.status !== "BROUILLON" && !env.can("order.cancel")) return { ok: false, error: "Action réservée : annuler un document validé demande un responsable." };
  if (order.status === "CLOTUREE") return { ok: false, error: "Commande clôturée et exportée : la correction se fait par un avoir dans Sage." };

  const mine = env.data.dispatches.filter((d) => d.orderId === order.id);
  const touched = new Set(mine.filter((d) => d.status !== "PLANIFIE").map((d) => d.id));
  // Nothing through the gate yet: the plain lifecycle cancellation applies.
  if (!touched.size) {
    const r = run(ORDER_FLOW, "cancel", order.status, { order, amount: 0, currency: "", credit: { decision: "ALLOW", reasons: [] }, override: null, shortfalls: [], backorder: "RELIQUAT", placementBlocked: null, loadingStarted: false, reason }, env.cfg.sales.workflow.steps);
    if (!r.ok) return { ok: false, error: r.failures.map((f) => f.message).join(" ") };
  }
  const ts = env.now;
  const movements = env.data.movements.filter((m) => m.refs.dispatchId && touched.has(m.refs.dispatchId) && !m.reverses && !env.data.movements.some((x) => x.reverses === m.id)).map((m) => reverse(m, { ts, by: env.by, reason: reason.trim() }));
  const entries: AccountEntry[] = env.data.entries
    .filter((e) => e.refs.dispatchId && touched.has(e.refs.dispatchId) && !e.reverses && !env.data.entries.some((x) => x.reverses === e.id))
    .map((e) => ({ ...e, id: `${e.id}:rev`, ts, kind: e.kind === "DEBIT" ? "CREDIT" : "DEBIT", dueDate: e.kind === "CREDIT" ? env.today : null, label: `Annulation : ${e.label}`, by: env.by, reason: reason.trim(), reverses: e.id }));

  const copy: Order | null = rectify
    ? {
        ...order,
        id: crypto.randomUUID(),
        number: nextNumber(env, order.centreId, env.today, env.cfg.sales.workflow.numbering.order, env.data.orders),
        createdAt: env.now,
        createdBy: env.by,
        status: "BROUILLON",
        approval: { required: false, reasons: [], by: null, at: null, note: null },
        reliquats: [],
        history: [{ at: env.now, by: env.by, label: `Rectifie ${order.number}`, note: reason.trim() }],
        replaces: order.id,
        replacedBy: null,
        exported: false,
      }
    : null;
  const cancelled: Order = {
    ...order,
    status: "ANNULEE",
    replacedBy: copy?.id ?? null,
    history: [...order.history, { at: env.now, by: env.by, label: touched.size ? "Commande annulée, mouvements contre-passés" : "Commande annulée", note: reason.trim() }],
  };
  // Planned trucks go with it; trucks already through the gate stay, reversed, for the record.
  const dispatches: Dispatch[] = mine.map((d) => ({ ...d, history: [...d.history, { at: env.now, by: env.by, label: "Commande annulée", note: reason.trim() }] }));
  return {
    ok: true,
    patch: { orders: copy ? [cancelled, copy] : [cancelled], movements, entries, dispatches },
    msg: copy ? `Commande annulée, brouillon ${copy.number} créé` : `Commande ${order.number} annulée`,
    kind: "warning",
    goTo: copy ? `/ventes/commandes/${copy.id}` : undefined,
  };
}

/** What will not be served becomes a reliquat with a reason; the order may then be delivered. */
export function declareReliquat(env: Env, orderId: string, reason: string): CommandResult {
  const order = env.data.orders.find((o) => o.id === orderId);
  if (!order || (order.status !== "CONFIRMEE" && order.status !== "EXPEDIEE")) return { ok: false, error: "Reliquat impossible : la commande doit être confirmée ou partiellement expédiée." };
  if (!env.cfg.sales.reasons.reliquat.some((r) => r.code === reason)) return { ok: false, error: "Motif manquant : choisissez pourquoi le reste n'est pas servi." };
  const planned = env.data.dispatches.filter((d) => d.orderId === order.id && d.status !== "EXPEDIE" && d.status !== "LIVRE");
  if (planned.length) return { ok: false, error: "Camion en cours : terminez ou retirez l'expédition prévue avant de déclarer le reliquat." };
  if (order.status === "CONFIRMEE") return { ok: false, error: "Rien n'est encore parti : annulez la commande plutôt que de tout déclarer en reliquat." };
  const rem = remainingQty(order, env.data.dispatches);
  const items = Object.entries(rem).filter(([, n]) => n > 0).map(([formatId, qty]) => ({ formatId, qty, reason, at: env.now, by: env.by }));
  if (!items.length) return { ok: false, error: "Rien à déclarer : tout a été servi." };
  const label = env.cfg.sales.reasons.reliquat.find((r) => r.code === reason)?.label ?? reason;
  const next: Order = { ...order, reliquats: [...order.reliquats, ...items], history: [...order.history, { at: env.now, by: env.by, label: "Reliquat déclaré", note: label }] };
  const after = { ...next, status: syncOrder(next, env.data.dispatches, remainingQty(next, env.data.dispatches)) };
  return { ok: true, patch: { orders: [after] }, msg: "Reliquat déclaré", kind: "warning" };
}

export function closeOrder(env: Env, orderId: string): CommandResult {
  const order = env.data.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, error: "Commande introuvable." };
  const r = run(ORDER_FLOW, "close", order.status, { order, amount: 0, currency: "", credit: { decision: "ALLOW", reasons: [] }, override: null, shortfalls: [], backorder: "RELIQUAT", placementBlocked: null, loadingStarted: false, reason: "" }, env.cfg.sales.workflow.steps);
  if (!r.ok) return { ok: false, error: r.failures.map((f) => f.message).join(" ") };
  return { ok: true, patch: { orders: [{ ...order, status: r.to, history: [...order.history, { at: env.now, by: env.by, label: "Commande clôturée" }] }] }, msg: `Commande ${order.number} clôturée` };
}

/** Books a truck for what remains to serve. Quantities can be lowered at loading. */
export function planDispatch(env: Env, orderId: string, o: { truck: string; driver: string; date: string; time: string }): CommandResult {
  const order = env.data.orders.find((x) => x.id === orderId);
  if (!order || (order.status !== "CONFIRMEE" && order.status !== "EXPEDIEE")) return { ok: false, error: "Commande non confirmée : confirmez-la avant de planifier un camion." };
  if (!o.truck.trim()) return { ok: false, error: "Immatriculation manquante : saisissez le camion." };
  const rem = remainingQty(order, env.data.dispatches);
  for (const d of env.data.dispatches) if (d.orderId === order.id && d.status !== "EXPEDIE" && d.status !== "LIVRE") for (const [f, n] of Object.entries(d.loaded)) rem[f] = Math.max((rem[f] ?? 0) - n, 0);
  if (!Object.values(rem).some((n) => n > 0)) return { ok: false, error: "Tout est déjà planifié ou servi pour cette commande." };
  const [hh, mm] = o.time.split(":").map(Number);
  const slot = at(o.date, hh || 8, mm || 0);
  const d: Dispatch = {
    id: crypto.randomUUID(),
    number: nextNumber(env, order.centreId, o.date, env.cfg.sales.workflow.numbering.dispatch, env.data.dispatches),
    orderId: order.id,
    centreId: order.centreId,
    customerId: order.customerId,
    truck: o.truck.trim().toUpperCase(),
    driver: o.driver.trim(),
    slot,
    status: "PLANIFIE",
    empties: {},
    damaged: {},
    loaded: Object.fromEntries(Object.entries(rem).filter(([, n]) => n > 0)),
    weighing: null,
    gateIn: [],
    loading: [],
    delivery: [],
    dispute: null,
    history: [{ at: env.now, by: env.by, label: "Expédition planifiée" }],
  };
  return { ok: true, patch: { dispatches: [d] }, msg: `Expédition ${d.number} planifiée`, goTo: `/expeditions/${d.id}` };
}
