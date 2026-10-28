import { describe, expect, it } from "vitest";
import { consignmentPrice, countFloat, issueStatement, logCall, logDeclaration, recordPassage } from "../lib/sales/commands/consignment";
import { alerts, wholesalerStatuses } from "../lib/sales/alerts";
import { clientSite, centreSite, siteBalance } from "../lib/sales/bottle-ledger";
import { daysOfStock, inactivityThreshold, ladderStep, passage, typicalInterval, variance } from "../lib/sales/consignment";
import { accountBalance } from "../lib/sales/exposure";
import { DEFAULT_SALES } from "../lib/sales/defaults";
import { UNKNOWN_BRAND, type Settlement } from "../lib/sales/types";
import { after, demoEnv } from "./helpers";

const env = demoEnv();
const confs = [
  { role: "Commerciale", name: "Fatou Diop", code: "1", at: env.now },
  { role: "Grossiste", name: "Mame Diarra Sow", code: "2", at: env.now },
];
const held = (e: typeof env, id: string) => siteBalance(e.ledger, clientSite(id)).PLEIN.baobab ?? {};

describe("passage engine", () => {
  const terms = { ...DEFAULT_SALES.categories[3].defaults };
  const run = (empties: Record<string, Record<string, number>>, given?: Record<string, number>) =>
    passage({ id: "s", number: "RG-1", customerId: "g", centreId: "ruf", ts: env.now, by: "t", own: "baobab", empties, given, price: (f) => (f === "b6" ? 2_800 : 5_900), terms, dueDate: env.today, paid: null, confirmations: [] });

  it("sold equals every empty returned, whatever its brand; the amount ignores brands", () => {
    const r = run({ baobab: { b6: 60 }, sahel: { b6: 30 }, [UNKNOWN_BRAND]: { b6: 10 }, delta: { b125: 5 } });
    expect(r.settlement.sold).toEqual({ b6: 100, b125: 5 });
    expect(r.settlement.given).toEqual({ b6: 100, b125: 5 });
    expect(r.settlement.amount).toBe(100 * 2_800 + 5 * 5_900);
    expect(r.events.map((e) => e.type)).toEqual(["EMPTIES_IN", "CONSIGNMENT_SALE", "FULLS_OUT", "BILL"]);
  });

  it("a periodic-statement wholesaler is not billed at the visit", () => {
    const r = passage({ id: "s", number: "RG-1", customerId: "g", centreId: "ruf", ts: env.now, by: "t", own: "baobab", empties: { baobab: { b6: 10 } }, price: () => 1, terms: { ...terms, invoicing: "RELEVE_PERIODIQUE" }, dueDate: env.today, paid: null, confirmations: [] });
    expect(r.events.some((e) => e.type === "BILL")).toBe(false);
  });

  it("variance: a shortfall is shrinkage, judged against the tolerance", () => {
    const v = variance({ baobab: { b6: 95, b125: 50 } }, { baobab: { b6: 100, b125: 50 } }, 2);
    expect(v.shrinkage).toBe(5);
    expect(v.pct).toBeCloseTo((5 / 150) * 100);
    expect(v.withinTolerance).toBe(false);
    expect(variance({ baobab: { b6: 99 } }, { baobab: { b6: 100 } }, 2).withinTolerance).toBe(true);
  });

  it("days of stock and the wholesaler's own rhythm", () => {
    expect(daysOfStock(300, 50)).toBe(6);
    expect(daysOfStock(300, 0)).toBeNull();
    const s = (d: string) => ({ customerId: "g", status: "CONFIRME", ts: `${d}T10:00:00` }) as Settlement;
    expect(typicalInterval([s("2026-10-01"), s("2026-10-04"), s("2026-10-07"), s("2026-10-12")], "g")).toBe(3);
  });
});

describe("inactivity ladder and default cascade", () => {
  const cat = DEFAULT_SALES.categories[3];
  it("contract, then category, then tenant default", () => {
    const cfg = DEFAULT_SALES.consignment;
    expect(inactivityThreshold(cfg, cat, cat.defaults)).toBe(5);
    expect(inactivityThreshold(cfg, { ...cat, inactivityDays: 6 }, cat.defaults)).toBe(6);
    expect(inactivityThreshold(cfg, { ...cat, inactivityDays: 6 }, { ...cat.defaults, inactivityDays: 3 })).toBe(3);
  });

  it("steps 5 / 7 / 10, shifted for a customer with its own threshold", () => {
    const ladder = DEFAULT_SALES.consignment.ladder;
    expect(ladderStep(4, 5, ladder)).toBeNull();
    expect(ladderStep(5, 5, ladder)?.action).toBe("TACHE");
    expect(ladderStep(8, 5, ladder)?.action).toBe("NOTIFIER");
    expect(ladderStep(10, 5, ladder)?.action).toBe("BLOQUER");
    expect(ladderStep(4, 4, ladder)?.action).toBe("TACHE");
    expect(ladderStep(9, 4, ladder)).toEqual({ day: 9, action: "BLOQUER" });
    expect(ladderStep(null, 5, ladder)).toBeNull();
  });

  it("the demo flags the late wholesaler with the right step, and every alert kind is present", () => {
    const st = wholesalerStatuses({ ...env, centreId: "all" });
    const late = st.find((w) => w.customer.id === "g02")!;
    expect(late.daysSince).toBeGreaterThanOrEqual(9);
    expect(late.step?.action).toBe("NOTIFIER");
    expect(st.find((w) => w.customer.id === "g04")?.threshold).toBe(4);
    const kinds = new Set(alerts({ ...env, centreId: "all" }).map((x) => x.kind));
    for (const k of ["GROSSISTE", "VALIDATION", "ECART", "CLOTURE"]) expect(kinds.has(k as never)).toBe(true);
  });
});

describe("passage command", () => {
  it("settles sales from the float, puts fulls back, bills and records the payment", () => {
    const before = { held: held(env, "g01"), centre: siteBalance(env.ledger, centreSite("ruf")).PLEIN.baobab, bal: accountBalance(env.data.entries, "g01") };
    const price = consignmentPrice(env, "g01", "b6", env.today);
    const e = after(env, recordPassage(env, { customerId: "g01", empties: { baobab: { b6: 70 }, teranga: { b6: 30 } }, given: { b6: 100 }, paid: { amount: 100 * price, method: "ESPECES" }, confirmations: confs }));
    expect(held(e, "g01").b6).toBe(before.held.b6);
    expect(siteBalance(e.ledger, centreSite("ruf")).PLEIN.baobab.b6).toBe(before.centre.b6 - 100);
    expect(siteBalance(e.ledger, centreSite("ruf")).VIDE.teranga.b6).toBe((siteBalance(env.ledger, centreSite("ruf")).VIDE.teranga?.b6 ?? 0) + 30);
    expect(accountBalance(e.data.entries, "g01")).toBe(before.bal);
    expect(e.data.settlements.at(-1)).toMatchObject({ sold: { b6: 100 }, amount: 100 * price });
  });

  it("needs both confirmations, the permission, a wholesaler, and cannot sell more than the float", () => {
    const f = { customerId: "g01", empties: { baobab: { b6: 10 } }, given: { b6: 10 }, paid: null };
    expect(recordPassage(env, { ...f, confirmations: confs.slice(0, 1) }).ok).toBe(false);
    expect(recordPassage({ ...env, can: () => false }, { ...f, confirmations: confs }).ok).toBe(false);
    expect(recordPassage(env, { ...f, empties: { baobab: { b6: (held(env, "g01").b6 ?? 0) + 1 } }, confirmations: confs }).ok).toBe(false);
    expect(recordPassage(env, { ...f, customerId: "c01", confirmations: confs }).ok).toBe(false);
  });

  it("topping up beyond the float cap needs an approver", () => {
    const r = recordPassage({ ...env, can: (a) => a !== "order.approve" }, { customerId: "g01", empties: {}, given: { b6: 5_000 }, paid: null, confirmations: confs });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Plafond de consignation/);
  });

  it("price basis: settlement day by default, placement day when configured", () => {
    const placement = { ...env, cfg: { ...env.cfg, sales: { ...env.cfg.sales, consignment: { ...env.cfg.sales.consignment, priceBasis: "PLACEMENT" as const } } } };
    expect(consignmentPrice(env, "g01", "b125", env.today)).toBe(5_900);
    const last = env.ledger.filter((m) => m.site === clientSite("g01") && m.kind === "PLACEMENT" && m.formatId === "b125").sort((a, b) => b.ts.localeCompare(a.ts))[0];
    expect(consignmentPrice(placement, "g01", "b125", env.today)).toBe(last.ts < "2026-09-01" ? 5_750 : 5_900);
  });
});

describe("statement, counts, calls", () => {
  it("bills every unbilled passage of a statement wholesaler once", () => {
    const e1 = after(env, recordPassage(env, { customerId: "g04", empties: { baobab: { b6: 20 } }, given: { b6: 20 }, paid: null, confirmations: confs }));
    const open = e1.data.settlements.filter((s) => s.customerId === "g04" && !s.statementId);
    expect(open.length).toBeGreaterThan(0);
    const e2 = after(e1, issueStatement(e1, "g04"));
    expect(e2.data.entries.at(-1)).toMatchObject({ kind: "DEBIT", amount: open.reduce((a, s) => a + s.amount, 0) });
    expect(issueStatement(e2, "g04").ok).toBe(false);
    expect(issueStatement(env, "g01").ok).toBe(false);
  });

  it("a float count with shrinkage beyond tolerance needs a reason and waits for review", () => {
    const h = held(env, "g01");
    const counted = { ...h, b6: Math.round((h.b6 ?? 0) * 0.8) };
    expect(countFloat(env, "g01", counted, null, "").ok).toBe(false);
    const e = after(env, countFloat(env, "g01", counted, "NON_RENDU", "Prêtées"));
    expect(e.data.counts.at(-1)).toMatchObject({ status: "A_VALIDER", reason: "NON_RENDU" });
  });

  it("logs calls with a promised date, and declarations as a cross-check only", () => {
    expect(logCall(env, { customerId: "g02", outcome: "PASSAGE_PROMIS", promised: null, note: "" }).ok).toBe(false);
    const e = after(env, logCall(env, { customerId: "g02", outcome: "PASSAGE_PROMIS", promised: "2026-10-13", note: "Demain" }));
    expect(e.data.calls.at(-1)?.promised).toBe("2026-10-13");
    const before = accountBalance(env.data.entries, "g02");
    const e2 = after(env, logDeclaration(env, { customerId: "g02", sold: { b6: 500 }, note: "" }));
    expect(accountBalance(e2.data.entries, "g02")).toBe(before);
  });
});
