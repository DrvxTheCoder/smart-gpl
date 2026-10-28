import { summarize } from "../calc";
import type { Inventory, TenantConfig } from "../types";
import { centreSite, customerBottleBalance, clientSite, siteBalance } from "./bottle-ledger";
import { categoryOf, contractAt } from "./contracts";
import { dayOf, periodOf, shiftDate } from "./dates";
import { fillPlan, type FillPlan } from "./fill-plan";
import { demandCells, forecastCells, versionsOf } from "./forecast";
import { reservedQty } from "./stock";
import { accountBalance, ageing, exposure, openDebits, pendingOrdersValue, type Ageing, type Exposure, type OpenDebit } from "./exposure";
import { priceFor, valueOf } from "./pricing";
import { solvency, type Solvency } from "./solvency";
import type { BottleMovement, BrandGrid, Contract, ContractTerms, Customer, CustomerCategory, Forecast, Money, SalesData } from "./types";

/* Read models for screens: plain inputs in, plain figures out. */

export interface Position {
  customer: Customer;
  category: CustomerCategory | undefined;
  contract: Contract | null;
  terms: ContractTerms;
  wholesaler: boolean;
  balance: Money;
  open: OpenDebit[];
  ageing: Ageing;
  floatQty: Record<string, number>; // fulls held at the wholesaler's site
  floatValue: Money;
  exposure: Exposure;
  solvency: Solvency;
  bottles: BrandGrid;
}

export function customerPosition(o: { cfg: TenantConfig; data: SalesData; ledger: BottleMovement[]; today: string; own: string }, customer: Customer, exceptOrderId?: string): Position {
  const sc = o.cfg.sales;
  const category = categoryOf(sc, customer);
  const contract = contractAt(o.data.contracts, customer.id, o.today);
  const terms = contract?.terms ?? category?.defaults ?? sc.categories[0].defaults;
  const wholesaler = category?.kind === "GROSSISTE";
  const balance = accountBalance(o.data.entries, customer.id);
  const open = openDebits(o.data.entries, customer.id, o.today);
  const age = ageing(open);
  const floatQty = wholesaler ? { ...(siteBalance(o.ledger, clientSite(customer.id)).PLEIN[o.own] ?? {}) } : {};
  const floatValue = valueOf(floatQty, (f) => priceFor(sc.priceLists, terms.priceListId, f, o.today));
  const exp = exposure({ balance, pendingOrders: pendingOrdersValue(o.data.orders, o.data.dispatches, customer.id, exceptOrderId), consignment: floatValue });
  return {
    customer,
    category,
    contract,
    terms,
    wholesaler,
    balance,
    open,
    ageing: age,
    floatQty,
    floatValue,
    exposure: exp,
    solvency: solvency({
      cfg: sc.solvency,
      entries: o.data.entries,
      incidents: o.data.incidents,
      customerId: customer.id,
      today: o.today,
      termDays: terms.payment.kind === "COMPTANT" ? 0 : terms.payment.days,
      limit: terms.creditLimit,
      exposure: exp.total,
      openTotal: age.total,
      overdue: age.overdue,
      floatValue,
    }),
    bottles: customerBottleBalance(o.ledger, customer.id, sc.consignment.balanceBasis),
  };
}

/** Customers served by a centre ("all" = every centre). */
export const customersIn = (customers: Customer[], centreId: string) => (centreId === "all" ? customers : customers.filter((c) => c.centreIds.includes(centreId)));

/* ---------------- forecasts ---------------- */

export interface ForecastSeries {
  latest: Map<string, number>;
  initial: Map<string, number>;
  actual: Map<string, number>;
  versions: Forecast[]; // newest first, every centre in scope
}

/** Latest and initial forecast cells against demand, merged over the centres in scope. */
export function forecastSeries(o: { cfg: TenantConfig; data: SalesData; centreId: string; granularity: Forecast["granularity"] }): ForecastSeries {
  const centres = o.centreId === "all" ? o.cfg.centres.map((c) => c.id) : [o.centreId];
  const latest = new Map<string, number>();
  const initial = new Map<string, number>();
  const actual = new Map<string, number>();
  const versions: Forecast[] = [];
  const merge = (into: Map<string, number>, from: Map<string, number>) => from.forEach((v, k) => into.set(k, (into.get(k) ?? 0) + v));
  for (const id of centres) {
    const vs = versionsOf(o.data.forecasts, id, o.granularity);
    versions.push(...vs);
    const customers = customersIn(o.data.customers, id);
    if (vs[0]) merge(latest, forecastCells(vs[0], customers));
    if (vs.length) merge(initial, forecastCells(vs[vs.length - 1], customers));
    merge(actual, demandCells({ orders: o.data.orders, settlements: o.data.settlements, centreId: id, granularity: o.granularity }));
  }
  return { latest, initial, actual, versions: versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}

/** The coming working week's fill plan for a centre. */
export function centreFillPlan(o: { cfg: TenantConfig; data: SalesData; ledger: BottleMovement[]; inventories: Inventory[]; today: string; own: string }, centreId: string): FillPlan {
  const centre = o.cfg.centres.find((c) => c.id === centreId) ?? o.cfg.centres[0];
  const week = periodOf(o.today, "SEMAINE");
  const next = periodOf(shiftDate(o.today, 7), "SEMAINE");
  const vs = versionsOf(o.data.forecasts, centre.id, "SEMAINE");
  const cells = vs[0] ? forecastCells(vs[0], customersIn(o.data.customers, centre.id)) : new Map<string, number>();
  const daily: Record<string, number> = {};
  for (const [k, v] of cells) {
    const [p, , f] = k.split("|");
    if (p === week || p === next) daily[f] = (daily[f] ?? 0) + v / 12; // two weeks of six working days
  }
  // What is already ordered for the coming week is reserved; the forecast covers the rest.
  const horizonEnd = shiftDate(o.today, 7);
  const ordered: Record<string, number> = {};
  for (const ord of o.data.orders)
    if (ord.centreId === centre.id && (ord.status === "CONFIRMEE" || ord.status === "BROUILLON") && ord.date >= o.today && ord.date <= horizonEnd)
      for (const l of ord.lines) ordered[l.formatId] = (ordered[l.formatId] ?? 0) + l.qty;
  const forecast: Record<string, number> = {};
  for (const [f, d] of Object.entries(daily)) forecast[f] = Math.max(d * 6 - (ordered[f] ?? 0), 0);
  const reliquat: Record<string, number> = {};
  const since = shiftDate(o.today, -7);
  for (const ord of o.data.orders) if (ord.centreId === centre.id) for (const r of ord.reliquats) if ((r.reason === "STOCK" || r.reason === "VIDES") && dayOf(r.at) >= since) reliquat[r.formatId] = (reliquat[r.formatId] ?? 0) + r.qty;
  const bal = siteBalance(o.ledger, centreSite(centre.id));
  // Own empties come back with sales: the recent own-brand share of returns (and exchanges) per full sent.
  const site = centreSite(centre.id);
  const from14 = shiftDate(o.today, -14);
  const out: Record<string, number> = {};
  const back: Record<string, number> = {};
  for (const m of o.ledger) {
    if (m.site !== site || dayOf(m.ts) < from14 || m.brand !== o.own) continue;
    if (m.state === "PLEIN" && (m.kind === "PLEINS_SORTIE" || m.kind === "PLACEMENT")) out[m.formatId] = (out[m.formatId] ?? 0) - m.qty;
    if (m.state === "VIDE" && (m.kind === "VIDES_ENTREE" || (m.kind === "ECHANGE" && m.qty > 0))) back[m.formatId] = (back[m.formatId] ?? 0) + m.qty;
  }
  const incoming: Record<string, number> = {};
  for (const [f, d] of Object.entries(daily)) incoming[f] = out[f] ? d * 6 * Math.min(back[f] ?? 0, out[f]) / out[f] : 0;
  const recent = o.inventories.filter((i) => i.centreId === centre.id && i.status === "TERMINE").sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  // Capacity is judged on the useful hours the centre actually achieved lately.
  let hours = 7;
  if (recent.length) {
    let sum = 0;
    for (const i of recent) {
      const s = summarize(i, centre, o.cfg);
      sum += (s.utileMin + s.nightUtileMin) / 60;
    }
    hours = sum / recent.length;
  }
  return fillPlan({
    formats: o.cfg.bottleTypes,
    forecast,
    reliquat,
    fulls: bal.PLEIN[o.own] ?? {},
    reserved: reservedQty(o.data.orders, o.data.dispatches, centre.id),
    dailyForecast: daily,
    safetyDays: o.cfg.sales.stock.safetyDays,
    ownEmpties: bal.VIDE[o.own] ?? {},
    incomingEmpties: incoming,
    capacityTph: centre.lines.reduce((a, l) => a + l.capacityTph, 0),
    usefulHoursPerDay: hours,
    days: 6,
    warnPct: o.cfg.sales.targets.capacityWarnPct,
  });
}
