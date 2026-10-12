import { Checker, isNum, isObj, type Obj } from "../checker";
import { ACTIONS, WORKFLOW_STEPS } from "./defaults";
import type {
  Action,
  BillingTrigger,
  Brand,
  ContractTerms,
  CustomerCategory,
  Decision,
  Invoicing,
  LadderAction,
  PaymentMethod,
  PaymentTrigger,
  PriceList,
  ReasonCode,
  ReportTemplate,
  Role,
  SalesConfig,
  WorkflowStep,
} from "./types";

export const PAYMENT_METHODS: readonly PaymentMethod[] = ["ESPECES", "VIREMENT", "CHEQUE", "MOBILE_MONEY", "EFFET"];
const BILLING: readonly BillingTrigger[] = ["A_L_EXPEDITION", "A_LA_VENTE"];
const PAYMENT_TRIGGERS: readonly PaymentTrigger[] = ["A_CHAQUE_PASSAGE", "PERIODIQUE", "A_L_ECHEANCE"];
const INVOICING: readonly Invoicing[] = ["PAR_PASSAGE", "RELEVE_PERIODIQUE"];
const DECISIONS: readonly Exclude<Decision, "ALLOW">[] = ["WARN", "APPROVAL", "BLOCK"];
const LADDER: readonly LadderAction[] = ["TACHE", "NOTIFIER", "BLOQUER"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Contract terms, shared by category defaults and contracts. */
export function checkTerms(c: Checker, t: Obj, at: string, priceListIds?: string[]): ContractTerms {
  const p = c.obj(t, "payment", at);
  const kind = c.oneOf(p, "kind", ["COMPTANT", "DIFFERE"] as const, at);
  const days = kind === "COMPTANT" ? 0 : c.int(p, "days", at, 1);
  const methods = c.strList(t, "methods", at);
  for (const m of methods) if (!PAYMENT_METHODS.includes(m as PaymentMethod)) c.fail(at, `mode de paiement « ${m} » inconnu.`);
  if (!methods.length) c.fail(at, "au moins un mode de paiement est requis.");
  const priceListId = c.str(t, "priceListId", at);
  if (priceListIds && priceListId && !priceListIds.includes(priceListId)) c.fail(at, `tarif « ${priceListId} » inconnu.`);
  const inactivity = t.inactivityDays;
  if (inactivity !== null && !(isNum(inactivity) && Number.isInteger(inactivity) && inactivity >= 1)) c.fail(at, "« inactivityDays » nombre de jours ou null attendu.");
  return {
    payment: { kind, days },
    methods: methods as PaymentMethod[],
    creditLimit: c.int(t, "creditLimit", at),
    guarantees: c.int(t, "guarantees", at),
    priceListId,
    billing: c.oneOf(t, "billing", BILLING, at),
    paymentTrigger: c.oneOf(t, "paymentTrigger", PAYMENT_TRIGGERS, at),
    invoicing: c.oneOf(t, "invoicing", INVOICING, at),
    floatCap: c.counts(t, "floatCap", at),
    inactivityDays: isNum(inactivity) ? inactivity : null,
  };
}

const reasons = (c: Checker, v: unknown, at: string): ReasonCode[] => {
  const list = c.list<ReasonCode>(v, at, (x, a) => ({ code: c.str(x, "code", a), label: c.str(x, "label", a) }));
  if (!list.length) c.fail(at, "au moins un motif est requis.");
  if (new Set(list.map((r) => r.code)).size !== list.length) c.fail(at, "codes en double.");
  return list;
};

const template = (c: Checker, v: unknown, at: string): ReportTemplate => {
  const t = isObj(v) ? v : (c.fail(at, "objet attendu."), {});
  const columns = c.strList(t, "columns", at);
  if (!columns.length) c.fail(at, "au moins une colonne est requise.");
  return {
    placeholder: c.bool(t, "placeholder", at),
    title: c.str(t, "title", at),
    header: c.str(t, "header", at),
    filename: c.str(t, "filename", at),
    columns,
    separator: c.str(t, "separator", at),
  };
};

/** Full structural and business check of `TenantConfig.sales`. */
export function checkSalesConfig(raw: unknown, c: Checker): SalesConfig | null {
  if (!isObj(raw)) {
    c.fail("Ventes", "objet attendu.");
    return null;
  }
  const before = c.errors.length;
  const cur = c.obj(raw, "currency", "Ventes, devise");
  const currency = { code: c.str(cur, "code", "Ventes, devise"), label: c.str(cur, "label", "Ventes, devise") };

  const brands = c.list<Brand>(raw.brands, "Marque", (x, at) => ({ id: c.str(x, "id", at), name: c.str(x, "name", at), own: c.bool(x, "own", at), deposit: c.counts(x, "deposit", at) }));
  if (brands.filter((b) => b.own).length !== 1) c.fail("Marques", "exactement une marque doit être la vôtre.");
  if (new Set(brands.map((b) => b.id)).size !== brands.length) c.fail("Marques", "identifiants en double.");

  const priceLists = c.list<PriceList>(raw.priceLists, "Tarif", (x, at) => ({
    id: c.str(x, "id", at),
    label: c.str(x, "label", at),
    lines: c.list(x.lines, `${at}, ligne`, (l, a) => {
      const from = c.str(l, "from", a);
      if (from && !DATE.test(from)) c.fail(a, "« from » date aaaa-mm-jj attendue.");
      return { formatId: c.str(l, "formatId", a), from, price: c.int(l, "price", a) };
    }),
  }));
  const plIds = priceLists.map((p) => p.id);

  const categories = c.list<CustomerCategory>(raw.categories, "Catégorie", (x, at) => {
    const cr = c.obj(x, "credit", at);
    const inactivity = x.inactivityDays;
    return {
      id: c.str(x, "id", at),
      label: c.str(x, "label", at),
      kind: c.oneOf(x, "kind", ["STANDARD", "GROSSISTE"] as const, at),
      defaults: checkTerms(c, c.obj(x, "defaults", at), at, plIds),
      credit: { onLimit: c.oneOf(cr, "onLimit", DECISIONS, at), overdueDays: c.int(cr, "overdueDays", at), onOverdue: c.oneOf(cr, "onOverdue", DECISIONS, at) },
      inactivityDays: isNum(inactivity) && inactivity >= 1 ? Math.round(inactivity) : null,
    };
  });
  if (!categories.length) c.fail("Catégories", "au moins une catégorie est requise.");

  const w = c.obj(raw, "workflow", "Flux");
  const st = c.obj(w, "steps", "Flux");
  const steps = Object.fromEntries(WORKFLOW_STEPS.map((s) => [s.id, c.bool(st, s.id, "Flux, étapes")])) as Record<WorkflowStep, boolean>;
  const num = c.obj(w, "numbering", "Flux, numérotation");
  const numbering = { order: c.str(num, "order", "Numérotation"), dispatch: c.str(num, "dispatch", "Numérotation"), settlement: c.str(num, "settlement", "Numérotation") };
  for (const [k, v] of Object.entries(numbering)) if (v && !v.includes("{N")) c.fail("Numérotation", `« ${k} » doit contenir un compteur {N} ou {N:5}.`);

  const so = c.obj(raw, "solvency", "Solvabilité");
  const ww = c.obj(so, "weights", "Solvabilité, pondérations");
  const solvency = {
    weights: { delay: c.num(ww, "delay", "Pondérations"), overdue: c.num(ww, "overdue", "Pondérations"), utilization: c.num(ww, "utilization", "Pondérations"), incidents: c.num(ww, "incidents", "Pondérations") },
    okFrom: c.num(so, "okFrom", "Solvabilité"),
    warnFrom: c.num(so, "warnFrom", "Solvabilité"),
    lookbackDays: c.int(so, "lookbackDays", "Solvabilité", 7),
  };
  if (solvency.warnFrom > solvency.okFrom) c.fail("Solvabilité", "le seuil « à surveiller » doit être inférieur au seuil « solvable ».");
  if (Object.values(solvency.weights).reduce((a, b) => a + b, 0) <= 0) c.fail("Solvabilité", "la somme des pondérations doit être positive.");

  const co = c.obj(raw, "consignment", "Consignation");
  const ladder = c.list(co.ladder, "Consignation, relance", (x, at) => ({ day: c.int(x, "day", at, 1), action: c.oneOf(x, "action", LADDER, at) }));
  if (ladder.some((s, i) => i > 0 && s.day <= ladder[i - 1].day)) c.fail("Consignation", "les étapes de relance doivent avoir des jours croissants.");
  const consignment = {
    inactivityDays: c.int(co, "inactivityDays", "Consignation", 1),
    ladder,
    priceBasis: c.oneOf(co, "priceBasis", ["SETTLEMENT", "PLACEMENT"] as const, "Consignation"),
    varianceTolerancePct: c.num(co, "varianceTolerancePct", "Consignation"),
    countEveryDays: c.int(co, "countEveryDays", "Consignation", 1),
    balanceBasis: c.oneOf(co, "balanceBasis", ["FORMAT", "BRAND"] as const, "Consignation"),
  };

  const sk = c.obj(raw, "stock", "Stock");
  const stock = { backorder: c.oneOf(sk, "backorder", ["RELIQUAT", "BLOQUER"] as const, "Stock"), safetyDays: c.int(sk, "safetyDays", "Stock"), atpHorizonDays: c.int(sk, "atpHorizonDays", "Stock") };

  const tg = c.obj(raw, "targets", "Objectifs");
  const pair = (k: string, higherIsBetter: boolean): [number, number] => {
    const v = tg[k];
    if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n)) && (higherIsBetter ? v[0] >= v[1] : v[0] <= v[1])) return [v[0], v[1]];
    c.fail("Objectifs", `« ${k} » deux seuils attendus, ${higherIsBetter ? "le premier supérieur ou égal" : "le premier inférieur ou égal"} au second.`);
    return [0, 0];
  };
  const targets = { fillRate: pair("fillRate", true), otif: pair("otif", true), mape: pair("mape", false), capacityWarnPct: c.num(tg, "capacityWarnPct", "Objectifs") };

  const rs = c.obj(raw, "reasons", "Motifs");
  const rp = c.obj(raw, "reports", "Rapports");
  const roles = c.list<Role>(raw.roles, "Rôle", (x, at) => ({ id: c.str(x, "id", at), label: c.str(x, "label", at), person: c.str(x, "person", at) }));
  if (!roles.length) c.fail("Rôles", "au moins un rôle est requis.");
  const pm = c.obj(raw, "permissions", "Permissions");
  const roleIds = roles.map((r) => r.id);
  const permissions = Object.fromEntries(
    ACTIONS.map((a) => {
      const list = c.strList(pm, a.id, "Permissions");
      for (const r of list) if (!roleIds.includes(r)) c.fail("Permissions", `rôle « ${r} » inconnu pour « ${a.label} ».`);
      return [a.id, list];
    }),
  ) as Record<Action, string[]>;

  const os = c.obj(raw, "openingStock", "Stock d'ouverture");
  const openingStock: Record<string, Record<string, number>> = {};
  for (const k of Object.keys(os)) openingStock[k] = c.counts(os, k, "Stock d'ouverture");

  const value: SalesConfig = {
    currency,
    brands,
    categories,
    priceLists,
    workflow: { version: c.int(w, "version", "Flux", 1), steps, approvalThreshold: c.int(w, "approvalThreshold", "Flux"), numbering },
    solvency,
    consignment,
    stock,
    targets,
    reasons: { variance: reasons(c, rs.variance, "Motifs d'écart"), reliquat: reasons(c, rs.reliquat, "Motifs de reliquat"), adjustment: reasons(c, rs.adjustment, "Motifs d'ajustement") },
    reports: { authority: template(c, rp.authority, "Rapport autorité"), sage: template(c, rp.sage, "Export Sage") },
    roles,
    permissions,
    openingStock,
  };
  return c.errors.length === before ? value : null;
}
