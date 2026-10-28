import { fmt, fmtMoney } from "../format";
import { daysBetween, shiftDate } from "./dates";
import { linesAmount } from "./pricing";
import { remainingQty } from "./stock";
import type { AccountEntry, CreditRule, Decision, Dispatch, Money, Order, PaymentTerm } from "./types";

/* ------------------------------------------------------------------
   Customer account and credit exposure. The account is an append-only
   ledger of debits (at the contract's billing trigger) and credits
   (payments); balances and ageing are derived.
   ------------------------------------------------------------------ */

/** Due date of a debit: billing date plus the contract's term. */
export const dueDate = (billingDate: string, term: PaymentTerm) => shiftDate(billingDate, term.kind === "COMPTANT" ? 0 : term.days);

/** Debits minus credits. Negative: the customer has paid ahead (unapplied credit). */
export function accountBalance(entries: AccountEntry[], customerId: string): Money {
  let b = 0;
  for (const e of entries) if (e.customerId === customerId) b += e.kind === "DEBIT" ? e.amount : -e.amount;
  return b;
}

export interface OpenDebit {
  entry: AccountEntry;
  open: Money; // not yet covered by payments
  daysLate: number; // past the due date, 0 when not due
}

/**
 * Payments settle the oldest debits first (by due date). What stays open is
 * the receivable, with its lateness.
 */
export function openDebits(entries: AccountEntry[], customerId: string, today: string): OpenDebit[] {
  const mine = entries.filter((e) => e.customerId === customerId);
  let credit = mine.filter((e) => e.kind === "CREDIT").reduce((a, e) => a + e.amount, 0);
  const debits = mine.filter((e) => e.kind === "DEBIT").sort((a, b) => (a.dueDate ?? a.ts).localeCompare(b.dueDate ?? b.ts) || a.ts.localeCompare(b.ts));
  const out: OpenDebit[] = [];
  for (const d of debits) {
    const used = Math.min(credit, d.amount);
    credit -= used;
    const open = d.amount - used;
    if (open > 0) out.push({ entry: d, open, daysLate: Math.max(daysBetween(d.dueDate ?? d.ts.slice(0, 10), today), 0) });
  }
  return out;
}

export interface Ageing {
  notDue: Money;
  d1_30: Money;
  d31_60: Money;
  d61_90: Money;
  d90: Money;
  overdue: Money;
  maxDaysLate: number;
  total: Money;
}

export function ageing(open: OpenDebit[]): Ageing {
  const a: Ageing = { notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, overdue: 0, maxDaysLate: 0, total: 0 };
  for (const o of open) {
    a.total += o.open;
    if (o.daysLate <= 0) a.notDue += o.open;
    else {
      a.overdue += o.open;
      a.maxDaysLate = Math.max(a.maxDaysLate, o.daysLate);
      if (o.daysLate <= 30) a.d1_30 += o.open;
      else if (o.daysLate <= 60) a.d31_60 += o.open;
      else if (o.daysLate <= 90) a.d61_90 += o.open;
      else a.d90 += o.open;
    }
  }
  return a;
}

/** Value of what is confirmed but not dispatched yet, at the order's prices. */
export function pendingOrdersValue(orders: Order[], dispatches: Dispatch[], customerId: string, exceptOrderId?: string): Money {
  let v = 0;
  for (const o of orders) {
    if (o.customerId !== customerId || o.id === exceptOrderId || (o.status !== "CONFIRMEE" && o.status !== "EXPEDIEE")) continue;
    const rem = remainingQty(o, dispatches);
    v += linesAmount(o.lines.map((l) => ({ qty: Math.min(l.qty, rem[l.formatId] ?? 0), price: l.price })));
  }
  return v;
}

export interface Exposure {
  receivables: Money; // unpaid debits (net of unapplied credit, never below zero)
  pendingOrders: Money;
  consignment: Money; // unsold stock held at a wholesaler, at its contract price
  total: Money;
}

export function exposure(parts: { balance: Money; pendingOrders: Money; consignment: Money }): Exposure {
  const receivables = Math.max(parts.balance, 0);
  return { receivables, pendingOrders: parts.pendingOrders, consignment: parts.consignment, total: receivables + parts.pendingOrders + parts.consignment };
}

export interface CreditDecision {
  decision: Decision;
  reasons: string[];
}

const RANK: Record<Decision, number> = { ALLOW: 0, WARN: 1, APPROVAL: 2, BLOCK: 3 };
const worst = (a: Decision, b: Decision) => (RANK[b] > RANK[a] ? b : a);

const CONSEQUENCE: Record<Exclude<Decision, "ALLOW">, string> = {
  WARN: "La commande peut être confirmée, à surveiller.",
  APPROVAL: "Validation du responsable requise.",
  BLOCK: "Commande bloquée : un responsable doit forcer avec un motif.",
};

/**
 * Credit decision for a new order. The category's rule says what a limit
 * breach or lateness beyond tolerance leads to; reasons are written for the
 * person at the counter, with the figures.
 */
export function decideCredit(opts: {
  enabled: boolean;
  amount: Money;
  exposure: Exposure;
  limit: Money;
  rule: CreditRule;
  overdue: Pick<Ageing, "overdue" | "maxDaysLate">;
  currency: string;
}): CreditDecision {
  if (!opts.enabled) return { decision: "ALLOW", reasons: [] };
  let decision: Decision = "ALLOW";
  const reasons: string[] = [];
  const after = opts.exposure.total + opts.amount;
  if (after > opts.limit) {
    decision = worst(decision, opts.rule.onLimit);
    reasons.push(
      `Plafond de crédit dépassé : ${fmtMoney(after, opts.currency)} d'encours avec cette commande pour un plafond de ${fmt(opts.limit)}. ${CONSEQUENCE[opts.rule.onLimit]}`,
    );
  }
  if (opts.overdue.overdue > 0 && opts.overdue.maxDaysLate > opts.rule.overdueDays) {
    decision = worst(decision, opts.rule.onOverdue);
    reasons.push(
      `Retard de paiement : ${fmtMoney(opts.overdue.overdue, opts.currency)} échus, le plus ancien depuis ${opts.overdue.maxDaysLate} jours (tolérance ${opts.rule.overdueDays} j). ${CONSEQUENCE[opts.rule.onOverdue]}`,
    );
  }
  return { decision, reasons };
}

/** Prepayment guard: unapplied credit on the account covers the amount. */
export const prepaid = (entries: AccountEntry[], customerId: string, amount: Money) => -accountBalance(entries, customerId) >= amount;
