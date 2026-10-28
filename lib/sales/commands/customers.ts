import { fmtMoney } from "../../format";
import { contractAt, newVersion } from "../contracts";
import { at, shiftDate } from "../dates";
import type { CommandResult, Env } from "../store";
import type { AccountEntry, ContractTerms, Customer, IncidentKind, Money, PaymentMethod } from "../types";

/* Customer master data, contracts and the account: plain functions from
   the current state to a patch. The provider commits and reports. */

export interface CustomerInput {
  id?: string;
  name: string;
  categoryId: string;
  zone: string;
  contactName: string;
  phone: string;
  centreIds: string[];
  rep: string;
  active: boolean;
}

export function saveCustomer(env: Env, input: CustomerInput): CommandResult {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Nom manquant : saisissez la raison sociale du client." };
  if (!input.centreIds.length) return { ok: false, error: "Aucun centre : choisissez au moins un centre qui sert ce client." };
  const category = env.cfg.sales.categories.find((c) => c.id === input.categoryId);
  if (!category) return { ok: false, error: "Catégorie inconnue : choisissez une catégorie de client." };
  const existing = input.id ? env.data.customers.find((c) => c.id === input.id) : undefined;
  const dup = env.data.customers.find((c) => c.id !== input.id && c.name.trim().toLowerCase() === name.toLowerCase());
  if (dup) return { ok: false, error: `Doublon : ${dup.code} porte déjà ce nom. Ouvrez sa fiche plutôt que d'en créer une autre.` };

  const next = env.data.customers.reduce((m, c) => Math.max(m, Number(c.code.replace(/\D/g, "")) || 0), 0) + 1;
  const customer: Customer = {
    id: existing?.id ?? crypto.randomUUID(),
    code: existing?.code ?? `CL-${String(next).padStart(3, "0")}`,
    name,
    categoryId: category.id,
    contact: { name: input.contactName.trim(), phone: input.phone.trim() },
    zone: input.zone.trim(),
    centreIds: input.centreIds,
    active: input.active,
    rep: input.rep.trim(),
  };
  if (existing) return { ok: true, patch: { customers: [customer] }, msg: "Fiche client enregistrée" };
  // A new customer starts with its category's terms, effective today.
  const contracts = newVersion(env.data.contracts, customer.id, category.defaults, env.today, env.by, env.now, crypto.randomUUID()).filter((k) => k.customerId === customer.id);
  return { ok: true, patch: { customers: [customer], contracts }, msg: `Client ${customer.code} créé`, goTo: `/ventes/clients/${customer.id}` };
}

/** A new contract version from `from`; the one in force ends the day before. */
export function newContract(env: Env, customerId: string, terms: ContractTerms, from: string): CommandResult {
  if (from < env.today) return { ok: false, error: "Date passée : une nouvelle version prend effet aujourd'hui ou plus tard, les commandes passées gardent leurs conditions." };
  if (!terms.methods.length) return { ok: false, error: "Aucun mode de paiement : cochez au moins un mode accepté." };
  const current = contractAt(env.data.contracts, customerId, from);
  if (current && current.validFrom === from) return { ok: false, error: "Une version commence déjà ce jour-là : choisissez une autre date d'effet." };
  const next = newVersion(env.data.contracts, customerId, terms, from, env.by, env.now, crypto.randomUUID());
  const changed = next.filter((k) => k.customerId === customerId && !env.data.contracts.includes(k));
  const version = changed.find((k) => k.validTo == null)?.version ?? 0;
  return { ok: true, patch: { contracts: changed }, msg: `Contrat v${version} enregistré` };
}

export function recordPayment(env: Env, o: { customerId: string; amount: Money; method: PaymentMethod; date: string; note: string }): CommandResult {
  const amount = Math.round(o.amount);
  if (amount <= 0) return { ok: false, error: "Montant nul : saisissez le montant reçu." };
  if (o.date > env.today) return { ok: false, error: "Date future : un règlement s'enregistre le jour où il est reçu." };
  const entry: AccountEntry = {
    id: crypto.randomUUID(),
    customerId: o.customerId,
    ts: o.date === env.today ? env.now : at(o.date, 12),
    kind: "CREDIT",
    amount,
    dueDate: null,
    method: o.method,
    label: o.note.trim() || "Règlement",
    refs: {},
    by: env.by,
  };
  return { ok: true, patch: { entries: [entry] }, msg: `Règlement de ${fmtMoney(amount, env.cfg.sales.currency.label)} enregistré` };
}

/** An entry is never edited: it is cancelled by its mirror image, with a reason. */
export function reverseEntry(env: Env, entryId: string, reason: string): CommandResult {
  if (!env.can("order.cancel")) return { ok: false, error: "Action réservée : annuler une écriture demande un responsable." };
  const e = env.data.entries.find((x) => x.id === entryId);
  if (!e) return { ok: false, error: "Écriture introuvable." };
  if (!reason.trim()) return { ok: false, error: "Motif obligatoire : indiquez pourquoi l'écriture est annulée." };
  if (e.reverses || env.data.entries.some((x) => x.reverses === e.id)) return { ok: false, error: "Déjà annulée : cette écriture a déjà son écriture inverse." };
  const rev: AccountEntry = { ...e, id: `${e.id}:rev`, ts: env.now, kind: e.kind === "DEBIT" ? "CREDIT" : "DEBIT", dueDate: e.kind === "CREDIT" ? env.today : null, label: `Annulation : ${e.label}`, by: env.by, reason: reason.trim(), reverses: e.id };
  return { ok: true, patch: { entries: [rev] }, msg: "Écriture annulée par écriture inverse" };
}

export function recordIncident(env: Env, o: { customerId: string; kind: IncidentKind; note: string; amount: Money }): CommandResult {
  if (!o.note.trim()) return { ok: false, error: "Description manquante : décrivez l'incident en une phrase." };
  const id = crypto.randomUUID();
  const entries: AccountEntry[] = [];
  // A bounced cheque puts the amount back on the customer's account, due at once.
  if (o.kind === "CHEQUE_IMPAYE") {
    if (o.amount <= 0) return { ok: false, error: "Montant manquant : saisissez le montant du chèque rejeté." };
    entries.push({ id: `${id}:db`, customerId: o.customerId, ts: env.now, kind: "DEBIT", amount: Math.round(o.amount), dueDate: env.today, label: "Rejet de chèque", refs: {}, by: env.by });
  }
  return { ok: true, patch: { incidents: [{ id, customerId: o.customerId, ts: env.now, kind: o.kind, note: o.note.trim(), by: env.by }], entries }, msg: "Incident enregistré", kind: "warning" };
}

/** Default effective date of a new contract version: tomorrow. */
export const nextContractDate = (today: string) => shiftDate(today, 1);
