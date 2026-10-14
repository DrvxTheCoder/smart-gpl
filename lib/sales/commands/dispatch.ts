import { categoryOf, contractVersions } from "../contracts";
import { dayOf } from "../dates";
import { isClosed } from "../day-close";
import { dueDate, prepaid } from "../exposure";
import { applyEvents, DISPATCH_FLOW, dispatchLocked, run, syncOrder, type DispatchCtx } from "../lifecycle";
import { linesAmount } from "../pricing";
import { dispatchedQty, remainingQty } from "../stock";
import type { CommandResult, Env } from "../store";
import { BULK, type Confirmation, type Dispatch, type DispatchStatus } from "../types";

/* ------------------------------------------------------------------
   The digital delivery note (BL): gate-in count, loading, expedition,
   delivery. Transitions come from lifecycle.ts; their events become
   ledger and account rows here, so every path gives the same records.
   ------------------------------------------------------------------ */

type Editable = Partial<Pick<Dispatch, "truck" | "driver" | "slot" | "empties" | "damaged" | "loaded" | "weighing" | "dispute">>;

const find = (env: Env, id: string) => env.data.dispatches.find((d) => d.id === id);

/** What a transition needs to know about a truck and its order. */
export function dispatchContext(env: Env, d: Dispatch): DispatchCtx | null {
  const order = env.data.orders.find((o) => o.id === d.orderId);
  const customer = env.data.customers.find((c) => c.id === d.customerId);
  if (!order || !customer) return null;
  // The terms the order was made under, not today's.
  const terms = contractVersions(env.data.contracts, customer.id).find((k) => k.version === order.contractVersion)?.terms ?? categoryOf(env.cfg.sales, customer)?.defaults ?? env.cfg.sales.categories[0].defaults;
  const amount = linesAmount(order.lines.map((l) => ({ qty: d.loaded[l.formatId] ?? 0, price: l.price })));
  const sent = dispatchedQty(env.data.dispatches, order.id);
  const fillable = Object.fromEntries(Object.entries(order.filled ?? {}).map(([f, n]) => [f, Math.max(n - (sent[f] ?? 0), 0)]));
  return {
    dispatch: d,
    order,
    own: env.own,
    bulk: (d.loaded[BULK] ?? 0) > 0,
    consignment: categoryOf(env.cfg.sales, customer)?.kind === "GROSSISTE",
    remaining: remainingQty(order, env.data.dispatches),
    fillable,
    prepaid: prepaid(env.data.entries, customer.id, amount),
    cash: terms.payment.kind === "COMPTANT",
    amount,
    billing: terms.billing,
    dueDate: dueDate(env.today, terms.payment),
    now: env.now,
    by: env.by,
  };
}

export function updateDispatch(env: Env, id: string, patch: Editable): CommandResult {
  const d = find(env, id);
  if (!d) return { ok: false, error: "Expédition introuvable." };
  if (dispatchLocked(d)) return { ok: false, error: "BL émis : l'expédition est en lecture seule. Une correction passe par l'annulation de la commande." };
  if ((patch.empties || patch.damaged) && d.status !== "PLANIFIE") return { ok: false, error: "Vides déjà validées : le comptage d'entrée est figé." };
  return { ok: true, patch: { dispatches: [{ ...d, ...patch }] }, msg: "" };
}

/** A party confirms a step (gate count, loading, delivery) with a name and a personal code. */
export function confirmParty(env: Env, id: string, phase: "gateIn" | "loading" | "delivery", c: Omit<Confirmation, "at">): CommandResult {
  const d = find(env, id);
  if (!d) return { ok: false, error: "Expédition introuvable." };
  if (!c.name.trim() || !c.code.trim()) return { ok: false, error: "Nom et code requis : chaque partie confirme avec son nom et son code personnel." };
  const list = d[phase].filter((x) => x.role !== c.role);
  const next = { ...d, [phase]: [...list, { ...c, name: c.name.trim(), code: c.code.trim(), at: env.now }] };
  return { ok: true, patch: { dispatches: [next] }, msg: `Confirmé par ${c.name.trim()}` };
}

const DONE: Record<string, string> = { gateIn: "Vides validées", load: "Chargement validé", expedite: "BL émis, camion expédié", deliver: "Livraison confirmée" };

/** Runs a dispatch transition and writes what its effects emit. */
export function advanceDispatch(env: Env, id: string, action: "gateIn" | "load" | "expedite" | "deliver"): CommandResult {
  const d = find(env, id);
  if (!d) return { ok: false, error: "Expédition introuvable." };
  const ctx = dispatchContext(env, d);
  if (!ctx) return { ok: false, error: "Commande ou client introuvable pour cette expédition." };
  if (ctx.order.status === "ANNULEE") return { ok: false, error: "Commande annulée : cette expédition ne peut plus avancer." };
  if (action !== "deliver" && isClosed(env.data.closes, d.centreId, dayOf(env.now))) return { ok: false, error: "Journée clôturée : le magasin ne peut plus enregistrer de mouvement aujourd'hui." };
  const r = run(DISPATCH_FLOW, action, d.status, ctx, env.cfg.sales.workflow.steps);
  if (!r.ok) return { ok: false, error: r.failures.map((f) => f.message).join(" ") };
  const rows = applyEvents(r.events);
  const next: Dispatch = { ...d, status: r.to as DispatchStatus, history: [...d.history, { at: env.now, by: env.by, label: DONE[action] }] };
  // Pick-up: the customer leaves with the load, so the truck is delivered at once.
  const final = action === "expedite" && ctx.order.mode === "ENLEVEMENT" ? { ...next, status: "LIVRE" as const, history: [...next.history, { at: env.now, by: env.by, label: "Enlevé par le client" }] } : next;
  const dispatches = env.data.dispatches.map((x) => (x.id === d.id ? final : x));
  const status = syncOrder(ctx.order, dispatches, remainingQty(ctx.order, dispatches));
  const orders = status !== ctx.order.status ? [{ ...ctx.order, status, history: [...ctx.order.history, { at: env.now, by: env.by, label: status === "LIVREE" ? "Commande livrée" : "Commande expédiée" }] }] : [];
  return { ok: true, patch: { dispatches: [final], orders, movements: rows.movements, entries: rows.entries }, msg: `${DONE[action]} (${d.number})` };
}
