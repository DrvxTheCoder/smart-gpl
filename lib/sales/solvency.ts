import { daysBetween, dayOf, shiftDate } from "./dates";
import { openDebits } from "./exposure";
import type { AccountEntry, Incident, Money, SolvencyConfig } from "./types";

/* ------------------------------------------------------------------
   Solvency: a rule-based score, never a black box. Four inputs, each
   turned into a 0–1 sub-score, weighted by the tenant:
     delay        average days paid past the due date (0 j → 1, 30 j → 0)
     overdue      share of open receivables already past due
     utilization  exposure / credit limit (≤ 70 % → 1, ≥ 120 % → 0)
     incidents    bounced cheque = 2 points, dispute = 1 (4 points → 0)
   Unpaid debits past due count in the delay at their lateness to date,
   so a customer who stops paying does not look punctual. The suggested
   limit is shown for review and never applied.
   ------------------------------------------------------------------ */

export type Tone = "ok" | "warn" | "alert";

export interface SolvencyInputs {
  termDays: number;
  avgDaysToPay: number | null; // billing to payment (or to today if still unpaid and overdue), weighted by amount
  avgDaysLate: number | null; // past the due date, weighted by amount
  paidCount: number;
  openTotal: Money;
  overdue: Money;
  overdueShare: number; // 0–1
  utilization: number; // 0–∞
  bounced: number;
  disputes: number;
  monthlyBilled: Money;
}

export interface Solvency {
  score: number; // 0–100
  tone: Tone;
  label: string;
  parts: { key: "delay" | "overdue" | "utilization" | "incidents"; label: string; sub: number; weight: number; detail: string }[];
  suggestedLimit: Money;
  inputs: SolvencyInputs;
}

export const TONE_LABEL: Record<Tone, string> = { ok: "Solvable", warn: "À surveiller", alert: "À justifier" };

const clamp = (n: number) => Math.min(Math.max(n, 0), 1);

/**
 * Days to pay, read from the account: payments settle the oldest debits
 * first, so each debit gets the date of the payment that closed it.
 */
export function paymentHistory(entries: AccountEntry[], customerId: string, since: string) {
  const mine = entries.filter((e) => e.customerId === customerId).sort((a, b) => a.ts.localeCompare(b.ts));
  const queue: { e: AccountEntry; left: Money }[] = [];
  let credit = 0;
  const paid: { e: AccountEntry; on: string }[] = [];
  const settle = (on: string) => {
    queue.sort((a, b) => (a.e.dueDate ?? a.e.ts).localeCompare(b.e.dueDate ?? b.e.ts));
    while (credit > 0 && queue.length) {
      const q = queue[0];
      const used = Math.min(credit, q.left);
      q.left -= used;
      credit -= used;
      if (q.left <= 0) {
        paid.push({ e: q.e, on });
        queue.shift();
      }
    }
  };
  for (const e of mine) {
    if (e.kind === "DEBIT") queue.push({ e, left: e.amount });
    else credit += e.amount;
    settle(dayOf(e.ts));
  }
  return paid.filter((p) => dayOf(p.e.ts) >= since);
}

export function solvency(o: {
  cfg: SolvencyConfig;
  entries: AccountEntry[];
  incidents: Incident[];
  customerId: string;
  today: string;
  termDays: number;
  limit: Money;
  exposure: Money;
  openTotal: Money;
  overdue: Money;
  floatValue: Money; // consignment stock held, which the limit must cover too
}): Solvency {
  const since = shiftDate(o.today, -o.cfg.lookbackDays);
  const paid = paymentHistory(o.entries, o.customerId, since);
  let w = 0;
  let toPay = 0;
  let late = 0;
  for (const p of paid) {
    w += p.e.amount;
    toPay += p.e.amount * daysBetween(dayOf(p.e.ts), p.on);
    late += p.e.amount * Math.max(daysBetween(p.e.dueDate ?? dayOf(p.e.ts), p.on), 0);
  }
  // A debit still unpaid past its due date counts too, as late as it is today.
  for (const d of openDebits(o.entries, o.customerId, o.today)) {
    if (d.daysLate <= 0) continue;
    w += d.open;
    toPay += d.open * daysBetween(dayOf(d.entry.ts), o.today);
    late += d.open * d.daysLate;
  }
  const billed = o.entries.filter((e) => e.customerId === o.customerId && e.kind === "DEBIT" && dayOf(e.ts) >= since).reduce((a, e) => a + e.amount, 0);
  const recent = o.incidents.filter((i) => i.customerId === o.customerId && dayOf(i.ts) >= since);
  const inputs: SolvencyInputs = {
    termDays: o.termDays,
    avgDaysToPay: w ? toPay / w : null,
    avgDaysLate: w ? late / w : null,
    paidCount: paid.length,
    openTotal: o.openTotal,
    overdue: o.overdue,
    overdueShare: o.openTotal ? o.overdue / o.openTotal : 0,
    utilization: o.limit ? o.exposure / o.limit : o.exposure ? 2 : 0,
    bounced: recent.filter((i) => i.kind === "CHEQUE_IMPAYE").length,
    disputes: recent.filter((i) => i.kind === "LITIGE").length,
    monthlyBilled: Math.round((billed / o.cfg.lookbackDays) * 30),
  };

  const points = inputs.bounced * 2 + inputs.disputes;
  const subs = {
    delay: inputs.avgDaysLate == null ? 1 : clamp(1 - inputs.avgDaysLate / 30),
    overdue: clamp(1 - inputs.overdueShare),
    utilization: inputs.utilization <= 0.7 ? 1 : clamp(1 - (inputs.utilization - 0.7) / 0.5),
    incidents: clamp(1 - points / 4),
  };
  const wt = o.cfg.weights;
  const total = wt.delay + wt.overdue + wt.utilization + wt.incidents || 1;
  const score = Math.round(((subs.delay * wt.delay + subs.overdue * wt.overdue + subs.utilization * wt.utilization + subs.incidents * wt.incidents) / total) * 100);
  const tone: Tone = score >= o.cfg.okFrom ? "ok" : score >= o.cfg.warnFrom ? "warn" : "alert";

  const pct = (n: number) => `${Math.round(n * 100)} %`;
  const days = (n: number | null) => (n == null ? "aucun paiement sur la période" : `${n.toFixed(1).replace(".", ",")} j`);
  const parts: Solvency["parts"] = [
    {
      key: "delay",
      label: "Délai de paiement",
      sub: subs.delay,
      weight: wt.delay / total,
      detail:
        inputs.avgDaysToPay == null
          ? "Aucune facture payée ni échue sur la période : critère neutre."
          : `Payé en ${days(inputs.avgDaysToPay)} pour ${o.termDays} j convenus, soit ${days(inputs.avgDaysLate)} de retard moyen (${inputs.paidCount} facture${inputs.paidCount > 1 ? "s" : ""} payée${inputs.paidCount > 1 ? "s" : ""}, impayés échus comptés à ce jour).`,
    },
    { key: "overdue", label: "Impayés échus", sub: subs.overdue, weight: wt.overdue / total, detail: `${pct(inputs.overdueShare)} des créances ouvertes sont échues.` },
    { key: "utilization", label: "Utilisation du plafond", sub: subs.utilization, weight: wt.utilization / total, detail: `Encours à ${pct(inputs.utilization)} du plafond.` },
    { key: "incidents", label: "Incidents", sub: subs.incidents, weight: wt.incidents / total, detail: `${inputs.bounced} chèque${inputs.bounced > 1 ? "s" : ""} impayé${inputs.bounced > 1 ? "s" : ""}, ${inputs.disputes} litige${inputs.disputes > 1 ? "s" : ""} sur ${o.cfg.lookbackDays} jours.` },
  ];

  // Sales over the term plus a week, and any consignment float, cut back when the score is weak.
  const factor = tone === "ok" ? 1 : tone === "warn" ? 0.8 : 0.5;
  const raw = ((inputs.monthlyBilled / 30) * (o.termDays + 7) + o.floatValue) * factor;
  const step = raw >= 100_000_000 ? 10_000_000 : raw >= 10_000_000 ? 1_000_000 : 100_000;
  const rounded = Math.round(raw / step) * step;
  // A weak score never suggests raising the limit.
  return { score, tone, label: TONE_LABEL[tone], parts, suggestedLimit: tone === "ok" ? rounded : Math.min(rounded, o.limit), inputs };
}
