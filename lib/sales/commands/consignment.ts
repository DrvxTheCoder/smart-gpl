import { centreSite, clientSite, siteBalance } from "../bottle-ledger";
import { contractAt, isWholesaler } from "../contracts";
import { overCap, passage } from "../consignment";
import { dayOf } from "../dates";
import { isClosed } from "../day-close";
import { dueDate } from "../exposure";
import { applyEvents, formatNumber } from "../lifecycle";
import { priceFor } from "../pricing";
import type { CommandResult, Env } from "../store";
import type { AccountEntry, BrandGrid, CallLog, CallOutcome, Confirmation, PaymentMethod, Settlement } from "../types";
import { recordCount } from "./warehouse";

/* ------------------------------------------------------------------
   Wholesalers on consignment: the passage (visit) settles what was
   sold, a periodic statement bills it for those invoiced monthly, a
   physical count checks the float, and calls keep track of the late.
   ------------------------------------------------------------------ */

/**
 * Unit price of what a wholesaler sold: on the settlement day by default,
 * or on the day the bottles were placed (latest placement of the format).
 */
export function consignmentPrice(env: Env, customerId: string, formatId: string, on: string): number {
  const terms = contractAt(env.data.contracts, customerId, on)?.terms;
  if (!terms) return 0;
  let date = on;
  if (env.cfg.sales.consignment.priceBasis === "PLACEMENT") {
    const site = clientSite(customerId);
    const last = env.ledger.filter((m) => m.site === site && m.kind === "PLACEMENT" && m.formatId === formatId && dayOf(m.ts) <= on).sort((a, b) => b.ts.localeCompare(a.ts))[0];
    if (last) date = dayOf(last.ts);
  }
  return priceFor(env.cfg.sales.priceLists, terms.priceListId, formatId, date) ?? 0;
}

export interface PassageForm {
  customerId: string;
  empties: BrandGrid;
  given: Record<string, number>;
  paid: { amount: number; method: PaymentMethod } | null;
  confirmations: Confirmation[];
}

export function recordPassage(env: Env, f: PassageForm): CommandResult {
  if (!env.can("settlement.validate")) return { ok: false, error: "Action réservée : un passage est enregistré par le commercial ou le magasinier." };
  const customer = env.data.customers.find((c) => c.id === f.customerId);
  if (!customer || !isWholesaler(env.cfg.sales, customer)) return { ok: false, error: "Ce client n'est pas un grossiste en consignation." };
  const terms = contractAt(env.data.contracts, customer.id, env.today)?.terms;
  if (!terms) return { ok: false, error: "Aucun contrat en vigueur : créez une version du contrat sur la fiche du grossiste." };
  const centreId = customer.centreIds[0];
  if (isClosed(env.data.closes, centreId, dayOf(env.now))) return { ok: false, error: "Journée clôturée : le passage sera enregistré demain." };
  if (new Set(f.confirmations.map((c) => c.role)).size < 2) return { ok: false, error: "Double confirmation requise : le commercial et le grossiste confirment le comptage." };

  const held = siteBalance(env.ledger, clientSite(customer.id)).PLEIN[env.own] ?? {};
  const sold: Record<string, number> = {};
  for (const row of Object.values(f.empties)) for (const [k, n] of Object.entries(row)) sold[k] = (sold[k] ?? 0) + n;
  if (!Object.values(sold).some((n) => n > 0) && !Object.values(f.given).some((n) => n > 0)) return { ok: false, error: "Passage vide : comptez les vides rendues ou les pleins remis." };
  const label = (k: string) => env.cfg.bottleTypes.find((b) => b.id === k)?.label ?? k;
  for (const [k, n] of Object.entries(sold))
    if (n > (held[k] ?? 0)) return { ok: false, error: `Plus de vides que de pleins en dépôt en ${label(k)} (${(held[k] ?? 0).toLocaleString("fr-FR")} chez le grossiste) : recomptez, ou faites d'abord un comptage du dépôt.` };
  const fulls = siteBalance(env.ledger, centreSite(centreId)).PLEIN[env.own] ?? {};
  for (const [k, n] of Object.entries(f.given)) if (n > (fulls[k] ?? 0)) return { ok: false, error: `Pleins insuffisants au magasin en ${label(k)} : ${(fulls[k] ?? 0).toLocaleString("fr-FR")} disponibles.` };
  // Topping up beyond the float cap needs someone allowed to approve.
  const after: Record<string, number> = { ...held };
  for (const [k, n] of Object.entries(sold)) after[k] = (after[k] ?? 0) - n;
  for (const [k, n] of Object.entries(f.given)) after[k] = (after[k] ?? 0) + n;
  const caps = overCap(after, terms.floatCap);
  if (caps.length && !env.can("order.approve")) return { ok: false, error: `Plafond de consignation dépassé en ${caps.map((c) => label(c.formatId)).join(", ")} : réduisez les pleins remis ou faites valider par un responsable.` };

  const year = env.today.slice(0, 4);
  const seq = env.data.settlements.filter((s) => s.centreId === centreId && dayOf(s.ts).startsWith(year)).length + 1;
  const id = crypto.randomUUID();
  const number = formatNumber(env.cfg.sales.workflow.numbering.settlement, { centre: env.cfg.centres.find((c) => c.id === centreId)?.code ?? centreId, date: env.today, seq });
  const r = passage({
    id,
    number,
    customerId: customer.id,
    centreId,
    ts: env.now,
    by: env.by,
    own: env.own,
    empties: f.empties,
    given: f.given,
    price: (k) => consignmentPrice(env, customer.id, k, env.today),
    terms,
    dueDate: dueDate(env.today, terms.payment),
    paid: f.paid && f.paid.amount > 0 ? { amount: Math.round(f.paid.amount), method: f.paid.method } : null,
    confirmations: f.confirmations,
  });
  const rows = applyEvents(r.events);
  return { ok: true, patch: { settlements: [r.settlement], movements: rows.movements, entries: rows.entries }, msg: `Passage ${number} enregistré` };
}

/** Wholesalers invoiced by statement: bills every passage not yet billed, due after the contract term. */
export function issueStatement(env: Env, customerId: string): CommandResult {
  const terms = contractAt(env.data.contracts, customerId, env.today)?.terms;
  if (!terms || terms.invoicing !== "RELEVE_PERIODIQUE") return { ok: false, error: "Ce grossiste est facturé à chaque passage : pas de relevé à émettre." };
  const open = env.data.settlements.filter((s) => s.customerId === customerId && s.status === "CONFIRME" && !s.statementId);
  if (!open.length) return { ok: false, error: "Aucun passage à facturer depuis le dernier relevé." };
  const id = crypto.randomUUID();
  const amount = open.reduce((a, s) => a + s.amount, 0);
  const entry: AccountEntry = { id: `${id}:db`, customerId, ts: env.now, kind: "DEBIT", amount, dueDate: dueDate(env.today, terms.payment), label: `Relevé ${open.length} passage${open.length > 1 ? "s" : ""}`, refs: {}, by: env.by };
  const settlements: Settlement[] = open.map((s) => ({ ...s, statementId: id }));
  return { ok: true, patch: { settlements, entries: [entry] }, msg: `Relevé de ${open.length} passage${open.length > 1 ? "s" : ""} émis` };
}

/** Count of the fulls held at the wholesaler: any gap is shrinkage, reviewed with a reason. */
export function countFloat(env: Env, customerId: string, counted: Record<string, number>, reason: string | null, note: string): CommandResult {
  return recordCount(env, { site: clientSite(customerId), state: "PLEIN", counted: { [env.own]: counted }, reason, note });
}

export function logCall(env: Env, o: { customerId: string; outcome: CallOutcome; promised: string | null; note: string }): CommandResult {
  if (o.outcome === "PASSAGE_PROMIS" && !o.promised) return { ok: false, error: "Date manquante : indiquez le jour de passage promis." };
  const call: CallLog = { id: crypto.randomUUID(), customerId: o.customerId, ts: env.now, by: env.by, outcome: o.outcome, promised: o.outcome === "PASSAGE_PROMIS" ? o.promised : null, note: o.note.trim() };
  return { ok: true, patch: { calls: [call] }, msg: "Appel noté" };
}

/** What the wholesaler says it sold, by phone: a cross-check only, never billed. */
export function logDeclaration(env: Env, o: { customerId: string; sold: Record<string, number>; note: string }): CommandResult {
  if (!Object.values(o.sold).some((n) => n > 0)) return { ok: false, error: "Déclaration vide : saisissez au moins une quantité annoncée." };
  return { ok: true, patch: { declarations: [{ id: crypto.randomUUID(), customerId: o.customerId, ts: env.now, by: env.by, sold: o.sold, note: o.note.trim() }] }, msg: "Déclaration notée" };
}
