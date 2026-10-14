import { describe, expect, it } from "vitest";
import { ANY_BRAND, adjustmentsFor, centreSite, clientSite, customerBottleBalance, effective, emptiesBuckets, isFillable, reverse, siteBalance } from "../lib/sales/bottle-ledger";
import { contractAt, newVersion } from "../lib/sales/contracts";
import { DEFAULT_SALES } from "../lib/sales/defaults";
import { accountBalance, ageing, decideCredit, dueDate, exposure, openDebits, pendingOrdersValue, prepaid } from "../lib/sales/exposure";
import { applyEvents, DISPATCH_FLOW, formatNumber, ORDER_FLOW, run, syncOrder, type DispatchCtx, type OrderCtx } from "../lib/sales/lifecycle";
import { lineAmount, priceFor } from "../lib/sales/pricing";
import { atp, dispatchedQty, remainingQty, reservedQty, shortfalls } from "../lib/sales/stock";
import { BULK, UNKNOWN_BRAND, type AccountEntry, type BottleMovement, type Contract, type Dispatch, type Order, type WorkflowStep } from "../lib/sales/types";

const ALL_ON = DEFAULT_SALES.workflow.steps;
const ALL_OFF = Object.fromEntries(Object.keys(ALL_ON).map((k) => [k, false])) as Record<WorkflowStep, boolean>;
const NOW = "2026-10-12T10:00:00.000Z";

const debit = (id: string, amount: number, due: string): AccountEntry => ({ id, customerId: "c", ts: `${due}T08:00:00.000Z`, kind: "DEBIT", amount, dueDate: due, label: id, refs: {}, by: "t" });
const credit = (id: string, amount: number, ts = "2026-10-01T08:00:00.000Z"): AccountEntry => ({ id, customerId: "c", ts, kind: "CREDIT", amount, dueDate: null, method: "VIREMENT", label: id, refs: {}, by: "t" });

const order = (patch: Partial<Order> = {}): Order => ({
  id: "o1",
  number: "BC-1",
  centreId: "ruf",
  customerId: "c",
  contractVersion: 1,
  workflowVersion: 1,
  mode: "LIVRAISON",
  date: "2026-10-12",
  createdAt: NOW,
  createdBy: "t",
  lines: [
    { formatId: "b6", qty: 100, price: 2_900 },
    { formatId: "b125", qty: 50, price: 6_050 },
  ],
  status: "CONFIRMEE",
  approval: { required: false, reasons: [], by: null, at: null, note: null },
  reliquats: [],
  filled: {},
  history: [],
  replaces: null,
  replacedBy: null,
  exported: false,
  ...patch,
});

const dispatch = (patch: Partial<Dispatch> = {}): Dispatch => ({
  id: "d1",
  number: "BL-1",
  orderId: "o1",
  centreId: "ruf",
  customerId: "c",
  truck: "DK-1",
  driver: "Chauffeur",
  slot: NOW,
  status: "PLANIFIE",
  empties: { baobab: { b6: 80 }, sahel: { b6: 15 }, [UNKNOWN_BRAND]: { b6: 2 } },
  damaged: { baobab: { b6: 3 } },
  loaded: { b6: 100, b125: 50 },
  weighing: null,
  gateIn: [],
  loading: [],
  delivery: [],
  dispute: null,
  history: [],
  ...patch,
});

describe("pricing", () => {
  it("reads the latest effective line and keeps money integer", () => {
    const lists = DEFAULT_SALES.priceLists;
    expect(priceFor(lists, "pl-std", "b125", "2026-08-31")).toBe(5_900);
    expect(priceFor(lists, "pl-std", "b125", "2026-09-01")).toBe(6_050);
    expect(priceFor(lists, "pl-std", "b125", "2024-12-31")).toBeNull();
    expect(priceFor(lists, "pl-ind", BULK, "2026-10-01")).toBe(485);
    expect(Number.isInteger(lineAmount({ qty: 3, price: 6_050 }))).toBe(true);
  });
});

describe("contracts", () => {
  it("versions by effective date, closing the previous version", () => {
    const terms = DEFAULT_SALES.categories[0].defaults;
    const base: Contract[] = [{ id: "k1", customerId: "c", version: 1, validFrom: "2026-01-01", validTo: null, terms, createdBy: "t", createdAt: NOW }];
    const next = newVersion(base, "c", { ...terms, creditLimit: 1 }, "2026-10-15", "t", NOW, "k2");
    expect(contractAt(next, "c", "2026-10-14")?.version).toBe(1);
    expect(contractAt(next, "c", "2026-10-15")?.version).toBe(2);
    expect(next.find((k) => k.id === "k1")?.validTo).toBe("2026-10-14");
  });
});

describe("credit and due dates", () => {
  const rule = { onLimit: "APPROVAL" as const, overdueDays: 15, onOverdue: "BLOCK" as const };

  it("due date is the billing date plus the term", () => {
    expect(dueDate("2026-10-12", { kind: "DIFFERE", days: 30 })).toBe("2026-11-11");
    expect(dueDate("2026-10-12", { kind: "COMPTANT", days: 0 })).toBe("2026-10-12");
  });

  it("payments settle the oldest debits first; ageing follows", () => {
    const entries = [debit("a", 500_000, "2026-08-01"), debit("b", 300_000, "2026-10-01"), debit("c", 200_000, "2026-11-01"), credit("p", 600_000)];
    const open = openDebits(entries, "c", "2026-10-12");
    expect(open.map((o) => [o.entry.id, o.open])).toEqual([
      ["b", 200_000],
      ["c", 200_000],
    ]);
    const a = ageing(open);
    expect(a.overdue).toBe(200_000);
    expect(a.maxDaysLate).toBe(11);
    expect(a.notDue).toBe(200_000);
    expect(accountBalance(entries, "c")).toBe(400_000);
  });

  it("allows under the limit, asks approval above it, with the figures", () => {
    const e = exposure({ balance: 600_000, pendingOrders: 0, consignment: 0 });
    expect(decideCredit({ enabled: true, amount: 300_000, exposure: e, limit: 1_000_000, rule, overdue: { overdue: 0, maxDaysLate: 0 }, currency: "F CFA" }).decision).toBe("ALLOW");
    const d = decideCredit({ enabled: true, amount: 650_000, exposure: e, limit: 1_000_000, rule, overdue: { overdue: 0, maxDaysLate: 0 }, currency: "F CFA" });
    expect(d.decision).toBe("APPROVAL");
    expect(d.reasons[0].replace(/[  ]/g, " ")).toBe("Plafond de crédit dépassé : 1 250 000 F CFA d'encours avec cette commande pour un plafond de 1 000 000. Validation du responsable requise.");
  });

  it("blocks on lateness beyond tolerance, and the worst outcome wins", () => {
    const e = exposure({ balance: 2_000_000, pendingOrders: 0, consignment: 0 });
    const d = decideCredit({ enabled: true, amount: 1, exposure: e, limit: 1_000_000, rule, overdue: { overdue: 400_000, maxDaysLate: 40 }, currency: "F CFA" });
    expect(d.decision).toBe("BLOCK");
    expect(d.reasons).toHaveLength(2);
    expect(decideCredit({ enabled: true, amount: 1, exposure: e, limit: 3_000_000, rule, overdue: { overdue: 400_000, maxDaysLate: 10 }, currency: "F CFA" }).decision).toBe("ALLOW");
  });

  it("does nothing when the credit check is off", () => {
    const e = exposure({ balance: 9e9, pendingOrders: 0, consignment: 0 });
    expect(decideCredit({ enabled: false, amount: 1, exposure: e, limit: 0, rule, overdue: { overdue: 9e9, maxDaysLate: 999 }, currency: "F CFA" })).toEqual({ decision: "ALLOW", reasons: [] });
  });

  it("consignment exposure counts unsold stock held at the wholesaler", () => {
    const e = exposure({ balance: -50_000, pendingOrders: 100_000, consignment: 2_000_000 });
    expect(e.receivables).toBe(0);
    expect(e.total).toBe(2_100_000);
  });

  it("pending orders count only what is still to dispatch", () => {
    const o = order();
    const d = dispatch({ status: "EXPEDIE", loaded: { b6: 60, b125: 50 } });
    expect(pendingOrdersValue([o], [d], "c")).toBe(40 * 2_900);
  });

  it("prepayment guard needs unapplied credit covering the amount", () => {
    expect(prepaid([credit("p", 500_000)], "c", 500_000)).toBe(true);
    expect(prepaid([credit("p", 500_000), debit("x", 1, "2026-10-01")], "c", 500_000)).toBe(false);
  });
});

describe("bottle ledger", () => {
  const m = (id: string, patch: Partial<BottleMovement>): BottleMovement => ({ id, ts: NOW, site: centreSite("ruf"), state: "VIDE", brand: "baobab", formatId: "b6", kind: "VIDES_ENTREE", qty: 0, refs: {}, by: "t", ...patch });
  const brands = DEFAULT_SALES.brands;

  it("sums by brand × format and sorts own, competitor and damaged", () => {
    const list = [
      m("1", { qty: 100 }),
      m("2", { brand: "sahel", qty: 40 }),
      m("3", { brand: UNKNOWN_BRAND, qty: 5 }),
      m("4", { state: "CASSE", qty: 2 }),
      m("5", { state: "PLEIN", qty: 300, kind: "PRODUCTION" }),
      m("6", { qty: -300, kind: "PRODUCTION" }),
    ];
    const b = emptiesBuckets(siteBalance(list, centreSite("ruf")), brands);
    expect(b.ownEmpties.b6).toBe(-200);
    expect(b.ownFulls.b6).toBe(300);
    expect(b.competitor.sahel.b6).toBe(40);
    expect(b.competitor[UNKNOWN_BRAND].b6).toBe(5);
    expect(b.damaged.b6).toBe(2);
    expect(isFillable("baobab", brands)).toBe(true);
    expect(isFillable("sahel", brands)).toBe(false);
    expect(isFillable(UNKNOWN_BRAND, brands)).toBe(false);
  });

  it("a reversal cancels its movement and carries a reason", () => {
    const a = m("a", { qty: 50 });
    const r = reverse(a, { ts: NOW, by: "t", reason: "ERREUR_SAISIE" });
    expect(r.qty).toBe(-50);
    expect(r.reverses).toBe("a");
    expect(siteBalance([a, r], centreSite("ruf")).VIDE.baobab.b6).toBe(0);
    expect(effective([a, r, m("b", { qty: 1 })]).map((x) => x.id)).toEqual(["b"]);
  });

  it("customer balance by format vs by brand; returning more than taken goes negative", () => {
    const refs = { customerId: "c" };
    const list = [
      m("o", { state: "PLEIN", kind: "PLEINS_SORTIE", qty: -100, refs }),
      m("e1", { qty: 30, refs }),
      m("e2", { brand: "sahel", qty: 90, refs }),
    ];
    expect(customerBottleBalance(list, "c", "FORMAT")[ANY_BRAND].b6).toBe(-20);
    const byBrand = customerBottleBalance(list, "c", "BRAND");
    expect(byBrand.baobab.b6).toBe(70);
    expect(byBrand.sahel.b6).toBe(-90);
  });

  it("a validated count becomes one adjustment per differing cell", () => {
    const adj = adjustmentsFor({ site: clientSite("g"), state: "PLEIN", counted: { baobab: { b6: 95, b125: 40 } }, expected: { baobab: { b6: 100, b125: 40 } }, ts: NOW, by: "t", reason: "PERTE", countId: "k" });
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ qty: -5, kind: "AJUSTEMENT", reason: "PERTE", refs: { customerId: "g" } });
  });
});

describe("stock, reservation and availability", () => {
  it("remaining = ordered − dispatched − reliquats", () => {
    const o = order({ reliquats: [{ formatId: "b125", qty: 10, reason: "STOCK", at: NOW, by: "t" }] });
    const ds = [dispatch({ status: "EXPEDIE", loaded: { b6: 60, b125: 20 } }), dispatch({ id: "d2", status: "EN_CHARGEMENT", loaded: { b6: 40 } })];
    expect(dispatchedQty(ds, "o1")).toEqual({ b6: 60, b125: 20 });
    expect(remainingQty(o, ds)).toEqual({ b6: 40, b125: 20 });
  });

  it("reserves confirmed orders, not drafts, and computes ATP", () => {
    const orders = [order(), order({ id: "o2", status: "BROUILLON" }), order({ id: "o3", status: "LIVREE" })];
    const reserved = reservedQty(orders, [], "ruf");
    expect(reserved).toEqual({ b6: 100, b125: 50 });
    const a = atp({ fulls: { b6: 120, b125: 30 }, reserved, daily: { b6: 50, b125: 40 }, horizonDays: 1, reserveOnConfirm: true });
    expect(a).toEqual({ b6: 70, b125: 20 });
    expect(atp({ fulls: { b6: 120 }, reserved, daily: {}, horizonDays: 0, reserveOnConfirm: false }).b6).toBe(120);
  });

  it("over-ordering produces shortfalls for bottles only", () => {
    const s = shortfalls([...order().lines, { formatId: BULK, qty: 9_000, price: 485 }], { b6: 70, b125: 60 });
    expect(s).toEqual([{ formatId: "b6", qty: 30 }]);
  });
});

describe("order lifecycle", () => {
  const ctx = (patch: Partial<OrderCtx> = {}): OrderCtx => ({
    order: order({ status: "BROUILLON" }),
    amount: 592_500,
    currency: "F CFA",
    credit: { decision: "ALLOW", reasons: [] },
    override: null,
    shortfalls: [],
    backorder: "RELIQUAT",
    placementBlocked: null,
    loadingStarted: false,
    reason: "",
    ...patch,
  });

  it("confirms a valid draft and refuses invalid transitions", () => {
    expect(run(ORDER_FLOW, "confirm", "BROUILLON", ctx(), ALL_ON)).toMatchObject({ ok: true, to: "CONFIRMEE" });
    expect(run(ORDER_FLOW, "confirm", "CONFIRMEE", ctx(), ALL_ON).ok).toBe(false);
    expect(run(ORDER_FLOW, "close", "CONFIRMEE", ctx(), ALL_ON).ok).toBe(false);
    expect(run(ORDER_FLOW, "cancel", "LIVREE", ctx({ reason: "x" }), ALL_ON).ok).toBe(false);
  });

  it("blocked credit stops confirmation unless overridden, only when the step is on", () => {
    const blocked = ctx({ credit: { decision: "BLOCK", reasons: ["Retard."] } });
    const r = run(ORDER_FLOW, "confirm", "BROUILLON", blocked, ALL_ON);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures[0].guard).toBe("credit");
    expect(run(ORDER_FLOW, "confirm", "BROUILLON", { ...blocked, override: { by: "Resp", reason: "Garantie reçue" } }, ALL_ON).ok).toBe(true);
    expect(run(ORDER_FLOW, "confirm", "BROUILLON", blocked, ALL_OFF).ok).toBe(true);
  });

  it("hard-block backorder policy refuses shortfalls; the default lets them through", () => {
    const short = ctx({ shortfalls: [{ formatId: "b6", qty: 10 }] });
    expect(run(ORDER_FLOW, "confirm", "BROUILLON", short, ALL_ON).ok).toBe(true);
    expect(run(ORDER_FLOW, "confirm", "BROUILLON", { ...short, backorder: "BLOQUER" }, ALL_ON).ok).toBe(false);
  });

  it("closing waits for the accounting export only when that step is on", () => {
    const delivered = ctx({ order: order({ status: "LIVREE" }) });
    expect(run(ORDER_FLOW, "close", "LIVREE", delivered, ALL_ON).ok).toBe(false);
    expect(run(ORDER_FLOW, "close", "LIVREE", delivered, ALL_OFF).ok).toBe(true);
  });

  it("follows its dispatches: partial, then delivered", () => {
    const o = order();
    const d1 = dispatch({ status: "LIVRE", loaded: { b6: 100, b125: 20 } });
    expect(syncOrder(o, [d1], remainingQty(o, [d1]))).toBe("EXPEDIEE");
    const d2 = dispatch({ id: "d2", status: "LIVRE", loaded: { b125: 30 } });
    expect(syncOrder(o, [d1, d2], remainingQty(o, [d1, d2]))).toBe("LIVREE");
  });
});

describe("dispatch lifecycle", () => {
  const ctx = (patch: Partial<DispatchCtx> = {}): DispatchCtx => ({
    dispatch: dispatch(),
    order: order(),
    own: "baobab",
    bulk: false,
    consignment: false,
    remaining: { b6: 100, b125: 50 },
    fillable: { b6: 100, b125: 50 },
    prepaid: false,
    cash: false,
    amount: 592_500,
    billing: "A_L_EXPEDITION",
    dueDate: "2026-11-11",
    now: NOW,
    by: "Magasinier",
    ...patch,
  });

  it("gate-in needs two confirmations when inspection is on", () => {
    expect(run(DISPATCH_FLOW, "gateIn", "PLANIFIE", ctx(), ALL_ON).ok).toBe(false);
    const ok = ctx({ dispatch: dispatch({ gateIn: [{ name: "A", code: "1", role: "Magasinier", at: NOW }, { name: "B", code: "2", role: "Chauffeur", at: NOW }] }) });
    expect(run(DISPATCH_FLOW, "gateIn", "PLANIFIE", ok, ALL_ON).ok).toBe(true);
  });

  it("protected effects always run, whatever the toggles", () => {
    for (const steps of [ALL_ON, ALL_OFF]) {
      const c = ctx({ dispatch: dispatch({ gateIn: [{ name: "A", code: "1", role: "Magasinier", at: NOW }, { name: "B", code: "2", role: "Chauffeur", at: NOW }], loading: [{ name: "A", code: "1", role: "Magasinier", at: NOW }] }) });
      const gate = run(DISPATCH_FLOW, "gateIn", "PLANIFIE", c, steps);
      const out = run(DISPATCH_FLOW, "expedite", "CHARGE", c, steps);
      if (!gate.ok || !out.ok) throw new Error("transition refused");
      expect(gate.events.map((e) => e.type)).toEqual(["EMPTIES_IN"]);
      expect(out.events.map((e) => e.type)).toEqual(["FULLS_OUT", "BILL"]);
      const rows = applyEvents([...gate.events, ...out.events]);
      expect(rows.movements.filter((m) => m.kind === "PLEINS_SORTIE").reduce((a, m) => a + m.qty, 0)).toBe(-150);
      expect(rows.movements.filter((m) => m.kind === "VIDES_ENTREE").reduce((a, m) => a + m.qty, 0)).toBe(100);
      expect(rows.entries).toEqual([expect.objectContaining({ kind: "DEBIT", amount: 592_500, dueDate: "2026-11-11" })]);
    }
  });

  it("consignment placements move fulls to the wholesaler's site and bill nothing", () => {
    const c = ctx({ consignment: true, billing: "A_LA_VENTE", dispatch: dispatch({ loading: [{ name: "A", code: "1", role: "Magasinier", at: NOW }] }) });
    const r = run(DISPATCH_FLOW, "expedite", "CHARGE", c, ALL_OFF);
    if (!r.ok) throw new Error("refused");
    const rows = applyEvents(r.events);
    expect(rows.entries).toEqual([]);
    expect(siteBalance(rows.movements, clientSite("c")).PLEIN.baobab).toEqual({ b6: 100, b125: 50 });
    expect(siteBalance(rows.movements, centreSite("ruf")).PLEIN.baobab).toEqual({ b6: -100, b125: -50 });
  });

  it("optional guards: prepayment, weighbridge, approval, proof of delivery", () => {
    const loading = ctx({ cash: true });
    expect(run(DISPATCH_FLOW, "load", "EN_CHARGEMENT", loading, ALL_ON).ok).toBe(false);
    expect(run(DISPATCH_FLOW, "load", "EN_CHARGEMENT", loading, ALL_OFF).ok).toBe(true);
    expect(run(DISPATCH_FLOW, "load", "EN_CHARGEMENT", { ...loading, prepaid: true }, ALL_ON).ok).toBe(true);

    const bulk = ctx({ bulk: true, remaining: { [BULK]: 20_000 }, dispatch: dispatch({ loaded: { [BULK]: 18_000 }, weighing: { tareKg: 14_000, grossKg: 32_000 } }) });
    expect(run(DISPATCH_FLOW, "load", "EN_CHARGEMENT", bulk, ALL_ON).ok).toBe(true);
    const badWeigh = { ...bulk, dispatch: { ...bulk.dispatch, weighing: { tareKg: 14_000, grossKg: 31_000 } } };
    expect(run(DISPATCH_FLOW, "load", "EN_CHARGEMENT", badWeigh, ALL_ON).ok).toBe(false);
    expect(run(DISPATCH_FLOW, "load", "EN_CHARGEMENT", badWeigh, ALL_OFF).ok).toBe(true);

    // A manager's approval is not optional once it is required.
    const waiting = ctx({ order: order({ approval: { required: true, reasons: ["x"], by: null, at: null, note: null } }) });
    expect(run(DISPATCH_FLOW, "load", "EN_CHARGEMENT", waiting, ALL_OFF).ok).toBe(false);

    expect(run(DISPATCH_FLOW, "deliver", "EXPEDIE", ctx(), ALL_ON).ok).toBe(false);
    expect(run(DISPATCH_FLOW, "deliver", "EXPEDIE", ctx({ order: order({ mode: "ENLEVEMENT" }) }), ALL_ON).ok).toBe(true);
  });

  it("refuses to load more than the order still needs", () => {
    const over = ctx({ remaining: { b6: 50, b125: 50 } });
    const r = run(DISPATCH_FLOW, "load", "EN_CHARGEMENT", over, ALL_OFF);
    expect(r.ok).toBe(false);
  });
});

describe("numbering", () => {
  it("fills the tenant pattern", () => {
    expect(formatNumber("BC-{CENTRE}-{AAAA}-{N:5}", { centre: "RUF", date: "2026-10-12", seq: 42 })).toBe("BC-RUF-2026-00042");
    expect(formatNumber("{AAAA}{MM}{JJ}/{N}", { centre: "X", date: "2026-01-05", seq: 7 })).toBe("20260105/7");
  });
});
