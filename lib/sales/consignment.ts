import { byFormat, gridTotal } from "./bottle-ledger";
import { daysBetween, dayOf } from "./dates";
import type { SalesEvent } from "./lifecycle";
import { valueOf } from "./pricing";
import type { BrandGrid, Confirmation, ConsignmentConfig, ContractTerms, CustomerCategory, LadderStep, Money, PaymentMethod, Settlement } from "./types";

/* ------------------------------------------------------------------
   Wholesalers on consignment. Their stock is a site in the bottle
   ledger: valued, not billed. A visit (passage) is the settlement: a
   wholesaler cannot sell without taking back an empty, so what it sold
   equals every empty it returns, whatever the brand.
   ------------------------------------------------------------------ */

type Qty = Record<string, number>;

/** Inactivity threshold: contract, else category, else tenant default. */
export const inactivityThreshold = (cfg: ConsignmentConfig, category: CustomerCategory | undefined, terms: ContractTerms | undefined) =>
  terms?.inactivityDays ?? category?.inactivityDays ?? cfg.inactivityDays;

export interface PassageInput {
  id: string;
  number: string;
  customerId: string;
  centreId: string;
  ts: string;
  by: string;
  own: string;
  empties: BrandGrid; // counted at the visit, any brand
  given?: Qty; // fulls handed over; defaults to the quantity sold
  price: (formatId: string) => Money | null;
  terms: ContractTerms;
  dueDate: string;
  paid: { amount: Money; method: PaymentMethod } | null;
  confirmations: Confirmation[];
}

/**
 * Builds the settlement and its events. The brand split of the empties
 * reaches the ledger (and the authority report), never the amount billed.
 */
export function passage(p: PassageInput): { settlement: Settlement; events: SalesEvent[] } {
  const sold = byFormat(p.empties);
  const given = p.given ?? sold;
  const amount = valueOf(sold, p.price);
  const refs = { settlementId: p.id };
  const base = { docId: p.id, customerId: p.customerId, ts: p.ts, by: p.by, refs };
  const events: SalesEvent[] = [
    { ...base, type: "EMPTIES_IN", centreId: p.centreId, empties: p.empties, damaged: {}, confirmedBy: p.confirmations.map((c) => c.name).join(", ") || undefined },
    { ...base, type: "CONSIGNMENT_SALE", own: p.own, qty: sold },
    { ...base, type: "FULLS_OUT", centreId: p.centreId, own: p.own, qty: given, consignment: true },
  ];
  // Billed at the sale: per visit, or later on the periodic statement.
  if (p.terms.billing === "A_LA_VENTE" && p.terms.invoicing === "PAR_PASSAGE") events.push({ ...base, type: "BILL", amount, dueDate: p.dueDate, label: `Passage ${p.number}` });
  if (p.paid && p.paid.amount > 0) events.push({ ...base, type: "PAYMENT", amount: p.paid.amount, method: p.paid.method, label: `Règlement ${p.number}` });
  return {
    settlement: {
      id: p.id,
      number: p.number,
      customerId: p.customerId,
      centreId: p.centreId,
      ts: p.ts,
      empties: p.empties,
      sold,
      given,
      amount,
      paid: p.paid,
      confirmations: p.confirmations,
      status: "CONFIRME",
      statementId: null,
      by: p.by,
    },
    events,
  };
}

/** Confirmed passages of a wholesaler, oldest first. */
export const passagesOf = (settlements: Settlement[], customerId: string) =>
  settlements.filter((s) => s.customerId === customerId && s.status === "CONFIRME").sort((a, b) => a.ts.localeCompare(b.ts));

/** Whole days since the last passage, or null if it never came. */
export function daysSincePassage(settlements: Settlement[], customerId: string, today: string): number | null {
  const list = passagesOf(settlements, customerId);
  return list.length ? daysBetween(dayOf(list[list.length - 1].ts), today) : null;
}

/** The wholesaler's own rhythm: median days between passages. */
export function typicalInterval(settlements: Settlement[], customerId: string): number | null {
  const days = passagesOf(settlements, customerId).map((s) => dayOf(s.ts));
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push(daysBetween(days[i - 1], days[i]));
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  const m = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[m] : (gaps[m - 1] + gaps[m]) / 2;
}

/**
 * Where a wholesaler sits on the escalation ladder. The ladder is written for
 * the tenant default; a customer with another threshold has it shifted so its
 * first step falls on its own threshold.
 */
export function ladderStep(daysSince: number | null, threshold: number, ladder: LadderStep[]): LadderStep | null {
  if (daysSince == null || !ladder.length) return null;
  const shift = threshold - ladder[0].day;
  let hit: LadderStep | null = null;
  for (const s of ladder) if (daysSince >= s.day + shift) hit = { day: s.day + shift, action: s.action };
  return hit;
}

/** Fulls sold by a wholesaler between two days (inclusive), per format. */
export function sellOut(settlements: Settlement[], customerId: string, from: string, to: string): Qty {
  const out: Qty = {};
  for (const s of passagesOf(settlements, customerId)) {
    const d = dayOf(s.ts);
    if (d < from || d > to) continue;
    for (const [f, n] of Object.entries(s.sold)) out[f] = (out[f] ?? 0) + n;
  }
  return out;
}

/** Formats over the float cap, given what the site would hold. */
export function overCap(held: Qty, cap: Qty): { formatId: string; held: number; cap: number }[] {
  return Object.entries(cap)
    .filter(([f, c]) => c > 0 && (held[f] ?? 0) > c)
    .map(([formatId, c]) => ({ formatId, held: held[formatId] ?? 0, cap: c }));
}

/** Days the stock at the site lasts at the recent daily sell-out. */
export const daysOfStock = (stock: number, dailySellOut: number) => (dailySellOut > 0 ? stock / dailySellOut : null);

export interface Variance {
  diff: Qty; // counted − expected, per format
  shrinkage: number; // bottles missing (positive), whatever the format
  pct: number; // of the expected total
  withinTolerance: boolean;
}

/** Physical count against the ledger. A shortfall is shrinkage: loss, theft, unreturned bottles. */
export function variance(counted: BrandGrid, expected: BrandGrid, tolerancePct: number): Variance {
  const c = byFormat(counted);
  const e = byFormat(expected);
  const diff: Qty = {};
  for (const f of new Set([...Object.keys(c), ...Object.keys(e)])) diff[f] = (c[f] ?? 0) - (e[f] ?? 0);
  const net = Object.values(diff).reduce((a, b) => a + b, 0);
  const total = gridTotal(expected);
  const pct = total ? (Math.abs(net) / total) * 100 : net ? 100 : 0;
  return { diff, shrinkage: Math.max(-net, 0), pct, withinTolerance: pct <= tolerancePct };
}
