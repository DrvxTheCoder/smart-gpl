import { fmtMoney } from "../format";
import { centreSite, clientSite } from "./bottle-ledger";
import type { CreditDecision } from "./exposure";
import type { Shortfall } from "./stock";
import {
  BULK,
  type AccountEntry,
  type Action,
  type BillingTrigger,
  type BottleMovement,
  type BrandGrid,
  type Dispatch,
  type DispatchStatus,
  type Money,
  type Order,
  type OrderStatus,
  type PaymentMethod,
  type WorkflowStep,
} from "./types";

/* ------------------------------------------------------------------
   Document lifecycles as data. A transition lists its guards (some tied
   to an optional workflow step) and its effects. Effects never write
   anything: they emit events, and the ledger and account modules turn
   events into rows. Protected effects run whatever the tenant enabled.
   ------------------------------------------------------------------ */

type Qty = Record<string, number>;

export interface Guard<C> {
  id: string;
  step?: WorkflowStep; // only checked when this step is enabled
  check: (c: C) => string | null; // the failure, with cause and fix
}

export interface Effect<C> {
  id: string;
  protected: boolean; // runs even when every optional step is off
  emit: (c: C) => SalesEvent[];
}

export interface Transition<S extends string, C> {
  action: string;
  label: string;
  from: S[];
  to: S;
  permission?: Action;
  guards: Guard<C>[];
  effects: Effect<C>[];
}

export interface Failure {
  guard: string;
  message: string;
}

export type RunResult<S> = { ok: true; to: S; events: SalesEvent[] } | { ok: false; failures: Failure[] };

/* ---------------- events ---------------- */

interface EventBase {
  docId: string; // idempotency key: rows derived from it reuse it
  customerId: string;
  ts: string;
  by: string;
  refs: { orderId?: string; dispatchId?: string; settlementId?: string };
}

export type SalesEvent =
  | (EventBase & { type: "EMPTIES_IN"; centreId: string; empties: BrandGrid; damaged: BrandGrid; confirmedBy?: string })
  | (EventBase & { type: "FULLS_OUT"; centreId: string; own: string; qty: Qty; consignment: boolean })
  | (EventBase & { type: "CONSIGNMENT_SALE"; own: string; qty: Qty })
  | (EventBase & { type: "BILL"; amount: Money; dueDate: string; label: string })
  | (EventBase & { type: "PAYMENT"; amount: Money; method: PaymentMethod; label: string });

/** Bottle-ledger rows of an event. Bulk has no bottles. */
function movementsFor(e: SalesEvent): BottleMovement[] {
  const refs = { ...e.refs, customerId: e.customerId };
  const out: BottleMovement[] = [];
  const row = (id: string, m: Omit<BottleMovement, "id" | "ts" | "by" | "refs">) => out.push({ id, ts: e.ts, by: e.by, refs, ...m });
  switch (e.type) {
    case "EMPTIES_IN":
      for (const [brand, fs] of Object.entries(e.empties))
        for (const [f, n] of Object.entries(fs)) if (n) row(`${e.docId}:vi:${brand}:${f}`, { site: centreSite(e.centreId), state: "VIDE", brand, formatId: f, kind: "VIDES_ENTREE", qty: n, confirmedBy: e.confirmedBy });
      for (const [brand, fs] of Object.entries(e.damaged))
        for (const [f, n] of Object.entries(fs)) if (n) row(`${e.docId}:ca:${brand}:${f}`, { site: centreSite(e.centreId), state: "CASSE", brand, formatId: f, kind: "VIDES_ENTREE", qty: n, confirmedBy: e.confirmedBy });
      break;
    case "FULLS_OUT":
      for (const [f, n] of Object.entries(e.qty)) {
        if (!n || f === BULK) continue;
        row(`${e.docId}:po:${f}`, { site: centreSite(e.centreId), state: "PLEIN", brand: e.own, formatId: f, kind: e.consignment ? "PLACEMENT" : "PLEINS_SORTIE", qty: -n });
        if (e.consignment) row(`${e.docId}:pc:${f}`, { site: clientSite(e.customerId), state: "PLEIN", brand: e.own, formatId: f, kind: "PLACEMENT", qty: n });
      }
      break;
    case "CONSIGNMENT_SALE":
      for (const [f, n] of Object.entries(e.qty)) if (n) row(`${e.docId}:vc:${f}`, { site: clientSite(e.customerId), state: "PLEIN", brand: e.own, formatId: f, kind: "VENTE_CONSIGNATION", qty: -n });
      break;
  }
  return out;
}

/** Account rows of an event. */
function entriesFor(e: SalesEvent): AccountEntry[] {
  if (e.type === "BILL" && e.amount > 0) return [{ id: `${e.docId}:db`, customerId: e.customerId, ts: e.ts, kind: "DEBIT", amount: e.amount, dueDate: e.dueDate, label: e.label, refs: e.refs, by: e.by }];
  if (e.type === "PAYMENT" && e.amount > 0) return [{ id: `${e.docId}:cr`, customerId: e.customerId, ts: e.ts, kind: "CREDIT", amount: e.amount, dueDate: null, method: e.method, label: e.label, refs: e.refs, by: e.by }];
  return [];
}

export const applyEvents = (events: SalesEvent[]) => ({ movements: events.flatMap(movementsFor), entries: events.flatMap(entriesFor) });

/* ---------------- running a transition ---------------- */

export function run<S extends string, C>(defs: Transition<S, C>[], action: string, status: S, ctx: C, steps: Record<WorkflowStep, boolean>): RunResult<S> {
  const def = defs.find((d) => d.action === action);
  if (!def) return { ok: false, failures: [{ guard: "action", message: `Action « ${action} » inconnue.` }] };
  if (!def.from.includes(status)) return { ok: false, failures: [{ guard: "state", message: `« ${def.label} » n'est pas possible dans cet état.` }] };
  const failures = def.guards
    .filter((g) => !g.step || steps[g.step])
    .flatMap((g) => {
      const message = g.check(ctx);
      return message ? [{ guard: g.id, message }] : [];
    });
  if (failures.length) return { ok: false, failures };
  return { ok: true, to: def.to, events: def.effects.flatMap((e) => e.emit(ctx)) };
}

/** Guards that would fail now, without running anything: the "next step" hints. */
export function blockers<S extends string, C>(defs: Transition<S, C>[], action: string, status: S, ctx: C, steps: Record<WorkflowStep, boolean>): Failure[] {
  const r = run(defs, action, status, ctx, steps);
  return r.ok ? [] : r.failures;
}

/* ---------------- orders ---------------- */

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: "muted" | "warn" | "brand" | "ok" | "alert" }> = {
  BROUILLON: { label: "Brouillon", tone: "muted" },
  CONFIRMEE: { label: "Confirmée", tone: "warn" },
  EXPEDIEE: { label: "Expédiée", tone: "brand" },
  LIVREE: { label: "Livrée", tone: "ok" },
  CLOTUREE: { label: "Clôturée", tone: "ok" },
  ANNULEE: { label: "Annulée", tone: "alert" },
};

export interface OrderCtx {
  order: Order;
  amount: Money;
  currency: string;
  credit: CreditDecision;
  override: { by: string; reason: string } | null;
  shortfalls: Shortfall[];
  backorder: "RELIQUAT" | "BLOQUER";
  placementBlocked: string | null; // wholesaler: settlement overdue
  loadingStarted: boolean; // a dispatch is past "planned"
  reason: string;
}

export const ORDER_FLOW: Transition<OrderStatus, OrderCtx>[] = [
  {
    action: "confirm",
    label: "Confirmer la commande",
    from: ["BROUILLON"],
    to: "CONFIRMEE",
    guards: [
      { id: "lines", check: (c) => (c.order.lines.some((l) => l.qty > 0) ? null : "Commande vide : saisissez au moins une quantité.") },
      { id: "prices", check: (c) => (c.order.lines.every((l) => l.qty <= 0 || l.price > 0) ? null : "Prix manquant : le tarif du contrat ne couvre pas un des formats. Complétez le tarif dans Paramètres.") },
      {
        id: "credit",
        step: "creditCheck",
        check: (c) => (c.credit.decision === "BLOCK" && !c.override ? `${c.credit.reasons.join(" ")} Un responsable peut forcer en indiquant un motif.` : null),
      },
      {
        id: "stock",
        check: (c) =>
          c.backorder === "BLOQUER" && c.shortfalls.length
            ? `Stock insuffisant pour ${c.shortfalls.length} format${c.shortfalls.length > 1 ? "s" : ""} : réduisez les quantités ou passez la politique de reliquat sur « autoriser ».`
            : null,
      },
      { id: "placement", check: (c) => c.placementBlocked },
    ],
    effects: [],
  },
  {
    action: "close",
    label: "Clôturer la commande",
    from: ["LIVREE"],
    to: "CLOTUREE",
    guards: [{ id: "exported", step: "accountingExport", check: (c) => (c.order.exported ? null : "Pas encore exportée : lancez l'export Sage avant de clôturer.") }],
    effects: [],
  },
  {
    action: "cancel",
    label: "Annuler la commande",
    from: ["BROUILLON", "CONFIRMEE"],
    to: "ANNULEE",
    guards: [
      { id: "reason", check: (c) => (c.reason.trim() ? null : "Motif obligatoire : indiquez pourquoi la commande est annulée.") },
      { id: "loading", check: (c) => (c.loadingStarted ? "Chargement commencé : annulez d'abord l'expédition en cours." : null) },
    ],
    effects: [],
  },
];

/** Reasons a confirmed order waits for a manager, if any. */
export function approvalReasons(c: Pick<OrderCtx, "credit" | "override" | "amount" | "currency">, steps: Record<WorkflowStep, boolean>, threshold: Money, overCap: string[]): string[] {
  const out: string[] = [];
  if (steps.creditCheck && c.credit.decision === "APPROVAL") out.push(...c.credit.reasons);
  if (c.override) out.push(`Crédit forcé par ${c.override.by} : ${c.override.reason}`);
  if (steps.approval && c.amount > threshold) out.push(`Montant de ${fmtMoney(c.amount, c.currency)} au-delà du seuil de validation (${fmtMoney(threshold, c.currency)}).`);
  out.push(...overCap);
  return out;
}

/**
 * An order follows its dispatches: expedited as soon as something left,
 * delivered once nothing remains and every truck has arrived.
 */
export function syncOrder(order: Order, dispatches: Dispatch[], remaining: Qty): OrderStatus {
  if (order.status !== "CONFIRMEE" && order.status !== "EXPEDIEE") return order.status;
  const mine = dispatches.filter((d) => d.orderId === order.id);
  const shipped = mine.some((d) => d.status === "EXPEDIE" || d.status === "LIVRE");
  if (!shipped) return order.status;
  const nothingLeft = Object.values(remaining).every((n) => n <= 0);
  const allDelivered = mine.every((d) => d.status === "LIVRE");
  return nothingLeft && allDelivered ? "LIVREE" : "EXPEDIEE";
}

/** Some but not everything has left. */
export function isPartial(order: Order, dispatched: Qty, remaining: Qty) {
  const sent = Object.values(dispatched).some((n) => n > 0);
  const left = Object.values(remaining).some((n) => n > 0);
  return sent && left && order.status !== "ANNULEE";
}

/* ---------------- dispatches ---------------- */

export const DISPATCH_STATUS: Record<DispatchStatus, { label: string; tone: "muted" | "warn" | "brand" | "ok" }> = {
  PLANIFIE: { label: "Planifié", tone: "muted" },
  EN_CHARGEMENT: { label: "En chargement", tone: "warn" },
  CHARGE: { label: "Chargé", tone: "warn" },
  EXPEDIE: { label: "Expédié", tone: "brand" },
  LIVRE: { label: "Livré", tone: "ok" },
};

export interface DispatchCtx {
  dispatch: Dispatch;
  order: Order;
  own: string;
  bulk: boolean;
  consignment: boolean;
  remaining: Qty; // what the order still needs, this truck excluded
  prepaid: boolean; // cash customer: payment covering the load is recorded
  cash: boolean;
  amount: Money; // value of the load at the order's prices
  billing: BillingTrigger;
  dueDate: string;
  now: string;
  by: string;
}

const approved: Guard<DispatchCtx> = {
  id: "approval",
  check: (c) => (c.order.approval.required && !c.order.approval.by ? "En attente de validation : un responsable doit valider la commande avant le chargement." : null),
};

const refs = (c: DispatchCtx) => ({ orderId: c.order.id, dispatchId: c.dispatch.id });

export const DISPATCH_FLOW: Transition<DispatchStatus, DispatchCtx>[] = [
  {
    action: "gateIn",
    label: "Valider les vides reçues",
    from: ["PLANIFIE"],
    to: "EN_CHARGEMENT",
    guards: [
      { id: "order", check: (c) => (c.order.status === "CONFIRMEE" || c.order.status === "EXPEDIEE" ? null : "Commande non confirmée : confirmez-la avant d'accueillir le camion.") },
      approved,
      {
        id: "gateCount",
        step: "gateInspection",
        check: (c) =>
          c.bulk || new Set(c.dispatch.gateIn.map((x) => x.role)).size >= 2 ? null : "Double confirmation requise : le magasinier et le chauffeur (ou le client) confirment le comptage des vides.",
      },
    ],
    effects: [
      {
        id: "emptiesIn",
        protected: true,
        emit: (c) =>
          c.bulk
            ? []
            : [
                {
                  type: "EMPTIES_IN",
                  docId: c.dispatch.id,
                  customerId: c.order.customerId,
                  centreId: c.dispatch.centreId,
                  ts: c.now,
                  by: c.by,
                  refs: refs(c),
                  empties: c.dispatch.empties,
                  damaged: c.dispatch.damaged,
                  confirmedBy: c.dispatch.gateIn.map((x) => x.name).join(", ") || undefined,
                },
              ],
      },
    ],
  },
  {
    action: "load",
    label: "Valider le chargement",
    from: ["EN_CHARGEMENT"],
    to: "CHARGE",
    guards: [
      approved,
      { id: "loaded", check: (c) => (Object.values(c.dispatch.loaded).some((n) => n > 0) ? null : "Rien de chargé : saisissez les quantités chargées.") },
      {
        id: "notOver",
        check: (c) => {
          const over = Object.entries(c.dispatch.loaded).filter(([f, n]) => n > (c.remaining[f] ?? 0));
          return over.length ? "Chargement supérieur au restant à livrer : corrigez les quantités ou complétez la commande." : null;
        },
      },
      {
        id: "weighbridge",
        step: "weighbridge",
        check: (c) => {
          if (!c.bulk) return null;
          const w = c.dispatch.weighing;
          if (!w || w.tareKg <= 0 || w.grossKg <= w.tareKg) return "Pesées manquantes : saisissez la tare et le poids en charge du camion.";
          return w.grossKg - w.tareKg === (c.dispatch.loaded[BULK] ?? 0) ? null : "Pesées incohérentes : le net (charge − tare) doit égaler la quantité chargée.";
        },
      },
      {
        id: "prepayment",
        step: "prepayment",
        check: (c) => (c.cash && !c.prepaid ? "Paiement attendu : client au comptant, enregistrez le règlement couvrant le chargement avant de charger." : null),
      },
    ],
    effects: [],
  },
  {
    action: "expedite",
    label: "Émettre le BL et expédier",
    from: ["CHARGE"],
    to: "EXPEDIE",
    guards: [{ id: "loadingConfirmed", check: (c) => (c.dispatch.loading.length ? null : "Chargement non confirmé : le magasinier confirme les quantités chargées.") }],
    effects: [
      {
        id: "stockOut",
        protected: true,
        emit: (c) => [{ type: "FULLS_OUT", docId: c.dispatch.id, customerId: c.order.customerId, centreId: c.dispatch.centreId, own: c.own, ts: c.now, by: c.by, refs: refs(c), qty: c.dispatch.loaded, consignment: c.consignment }],
      },
      {
        id: "billing",
        protected: true,
        emit: (c) =>
          c.billing === "A_L_EXPEDITION"
            ? [{ type: "BILL", docId: c.dispatch.id, customerId: c.order.customerId, ts: c.now, by: c.by, refs: refs(c), amount: c.amount, dueDate: c.dueDate, label: `BL ${c.dispatch.number}` }]
            : [],
      },
    ],
  },
  {
    action: "deliver",
    label: "Confirmer la livraison",
    from: ["EXPEDIE"],
    to: "LIVRE",
    guards: [
      {
        id: "pod",
        step: "proofOfDelivery",
        check: (c) => (c.order.mode === "LIVRAISON" && !c.dispatch.delivery.length ? "Preuve de livraison manquante : le client confirme la réception." : null),
      },
    ],
    effects: [],
  },
];

/* ---------------- immutability ---------------- */

export const dispatchLocked = (d: Dispatch) => d.status === "EXPEDIE" || d.status === "LIVRE";

/* ---------------- numbering ---------------- */

/**
 * Document number from a tenant pattern: {CENTRE}, {AAAA}, {MM}, {JJ} and a
 * counter {N} or {N:5} (zero-padded). The counter runs per centre and year.
 */
export function formatNumber(pattern: string, o: { centre: string; date: string; seq: number }): string {
  const [y, m, d] = o.date.split("-");
  return pattern
    .replace(/\{CENTRE\}/g, o.centre)
    .replace(/\{AAAA\}/g, y)
    .replace(/\{MM\}/g, m)
    .replace(/\{JJ\}/g, d)
    .replace(/\{N(?::(\d+))?\}/g, (_, w) => String(o.seq).padStart(Number(w) || 1, "0"));
}
