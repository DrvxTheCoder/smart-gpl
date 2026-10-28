import { describe, expect, it } from "vitest";
import { advanceDispatch, confirmParty, updateDispatch } from "../lib/sales/commands/dispatch";
import { confirmFill, confirmOrder, planDispatch, saveDraft } from "../lib/sales/commands/orders";
import { recordPayment } from "../lib/sales/commands/customers";
import { adjust, closeDay, decideCount, exchange, recordCount } from "../lib/sales/commands/warehouse";
import { accountBalance } from "../lib/sales/exposure";
import { centreSite, siteBalance } from "../lib/sales/bottle-ledger";
import { authorityCsv, reportRows } from "../lib/sales/day-close";
import { UNKNOWN_BRAND } from "../lib/sales/types";
import { after, demoEnv } from "./helpers";

const base = demoEnv();
const fulls = (e: typeof base, f: string) => siteBalance(e.ledger, centreSite("ruf")).PLEIN.baobab?.[f] ?? 0;
const empties = (e: typeof base, brand: string, f: string) => siteBalance(e.ledger, centreSite("ruf")).VIDE[brand]?.[f] ?? 0;

/** A confirmed order for c05 (station, 30 days) with a planned truck. */
function planned(e = base) {
  let x = after(e, saveDraft(e, { id: "t1", customerId: "c05", centreId: "ruf", mode: "LIVRAISON", date: e.today, qty: { b6: 200, b125: 100 } }));
  x = after(x, confirmOrder(x, "t1"));
  x = after(x, confirmFill(x, "t1", { b6: 200, b125: 100 }));
  x = after(x, planDispatch(x, "t1", { truck: "DK-1", driver: "Samba", date: x.today, time: "10:00" }));
  return { env: x, id: x.data.dispatches.at(-1)!.id };
}

describe("dispatch flow, end to end", () => {
  it("gate-in needs two confirmations, then books every brand of empties", () => {
    let { env, id } = planned();
    env = after(env, updateDispatch(env, id, { empties: { baobab: { b6: 150 }, sahel: { b6: 40 }, [UNKNOWN_BRAND]: { b6: 2 } }, damaged: { baobab: { b125: 3 } } }));
    expect(advanceDispatch(env, id, "gateIn").ok).toBe(false);
    env = after(env, confirmParty(env, id, "gateIn", { role: "Magasinier", name: "Ousmane Ba", code: "1234" }));
    env = after(env, confirmParty(env, id, "gateIn", { role: "Chauffeur", name: "Samba", code: "9876" }));
    const before = { own: empties(env, "baobab", "b6"), sahel: empties(env, "sahel", "b6") };
    env = after(env, advanceDispatch(env, id, "gateIn"));
    expect(empties(env, "baobab", "b6")).toBe(before.own + 150);
    expect(empties(env, "sahel", "b6")).toBe(before.sahel + 40);
    expect(siteBalance(env.ledger, centreSite("ruf")).CASSE.baobab.b125).toBeGreaterThanOrEqual(3);
    // The count is frozen once validated.
    expect(updateDispatch(env, id, { empties: {} }).ok).toBe(false);
  });

  it("loading respects the remainder; expedition takes stock out and bills at the order's prices", () => {
    let { env, id } = planned();
    for (const role of ["Magasinier", "Chauffeur"]) env = after(env, confirmParty(env, id, "gateIn", { role, name: role, code: "1" }));
    env = after(env, advanceDispatch(env, id, "gateIn"));
    expect(updateDispatch(env, id, { loaded: { b6: 300, b125: 100 } }).ok).toBe(true);
    expect(advanceDispatch(after(env, updateDispatch(env, id, { loaded: { b6: 300, b125: 100 } })), id, "load").ok).toBe(false);
    env = after(env, updateDispatch(env, id, { loaded: { b6: 180, b125: 100 } }));
    env = after(env, advanceDispatch(env, id, "load"));
    expect(advanceDispatch(env, id, "expedite").ok).toBe(false); // loading not confirmed
    env = after(env, confirmParty(env, id, "loading", { role: "Magasinier", name: "Ousmane Ba", code: "1" }));
    const before = { b6: fulls(env, "b6"), bal: accountBalance(env.data.entries, "c05") };
    env = after(env, advanceDispatch(env, id, "expedite"));
    expect(fulls(env, "b6")).toBe(before.b6 - 180);
    expect(accountBalance(env.data.entries, "c05")).toBe(before.bal + 180 * 2_900 + 100 * 6_050);
    const order = env.data.orders.find((o) => o.id === "t1")!;
    expect(order.status).toBe("EXPEDIEE"); // 20 B6 still to serve: partial
    expect(env.data.entries.at(-1)?.dueDate).toBe("2026-11-11");
    expect(updateDispatch(env, id, { loaded: { b6: 1 } }).ok).toBe(false); // the BL is frozen
    // Proof of delivery, then delivered.
    expect(advanceDispatch(env, id, "deliver").ok).toBe(false);
    env = after(env, confirmParty(env, id, "delivery", { role: "Client", name: "Ibou Thiam", code: "55" }));
    env = after(env, advanceDispatch(env, id, "deliver"));
    expect(env.data.dispatches.find((d) => d.id === id)?.status).toBe("LIVRE");
  });

  it("a cash customer cannot load before paying, and a pick-up is delivered at expedition", () => {
    let x = after(base, saveDraft(base, { id: "t2", customerId: "c04", centreId: "ruf", mode: "ENLEVEMENT", date: base.today, qty: { b6: 100 } }));
    x = after(x, confirmOrder(x, "t2"));
    x = after(x, confirmFill(x, "t2", { b6: 100 }));
    x = after(x, planDispatch(x, "t2", { truck: "DK-2", driver: "", date: x.today, time: "11:00" }));
    const id = x.data.dispatches.at(-1)!.id;
    for (const role of ["Magasinier", "Client"]) x = after(x, confirmParty(x, id, "gateIn", { role, name: role, code: "1" }));
    x = after(x, advanceDispatch(x, id, "gateIn"));
    const r = advanceDispatch(x, id, "load");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Paiement attendu/);
    x = after(x, recordPayment(x, { customerId: "c04", amount: 290_000, method: "ESPECES", date: x.today, note: "" }));
    x = after(x, advanceDispatch(x, id, "load"));
    x = after(x, confirmParty(x, id, "loading", { role: "Magasinier", name: "M", code: "1" }));
    x = after(x, advanceDispatch(x, id, "expedite"));
    expect(x.data.dispatches.find((d) => d.id === id)?.status).toBe("LIVRE");
    expect(x.data.orders.find((o) => o.id === "t2")?.status).toBe("LIVREE");
  });

  it("the seeded bulk truck needs consistent weighings", () => {
    const d = base.data.dispatches.find((x) => x.loaded.vrac && x.status === "PLANIFIE")!;
    let x = after(base, advanceDispatch(base, d.id, "gateIn"));
    x = after(x, updateDispatch(x, d.id, { weighing: { tareKg: 14_000, grossKg: 14_000 + d.loaded.vrac - 500 }, loaded: { vrac: d.loaded.vrac } }));
    expect(advanceDispatch(x, d.id, "load").ok).toBe(false);
    x = after(x, updateDispatch(x, d.id, { weighing: { tareKg: 14_000, grossKg: 14_000 + d.loaded.vrac } }));
    expect(advanceDispatch(x, d.id, "load").ok).toBe(true);
  });
});

describe("stock control", () => {
  it("a count within tolerance adjusts at once; beyond, it waits for a manager", () => {
    const site = centreSite("ruf");
    const expected = siteBalance(base.ledger, site).PLEIN;
    const near = structuredClone(expected);
    near.baobab.b6 -= 5;
    const e1 = after(base, recordCount(base, { site, state: "PLEIN", counted: near, reason: null, note: "" }));
    expect(e1.data.counts.at(-1)?.status).toBe("VALIDE");
    expect(fulls(e1, "b6")).toBe(fulls(base, "b6") - 5);

    const far = structuredClone(expected);
    far.baobab.b125 = Math.round(far.baobab.b125 * 0.5);
    expect(recordCount(base, { site, state: "PLEIN", counted: far, reason: null, note: "" }).ok).toBe(false);
    const e2 = after(base, recordCount(base, { site, state: "PLEIN", counted: far, reason: "PERTE", note: "" }));
    const k = e2.data.counts.at(-1)!;
    expect(k.status).toBe("A_VALIDER");
    expect(fulls(e2, "b125")).toBe(fulls(base, "b125"));
    expect(decideCount({ ...e2, can: () => false }, k.id, true, "").ok).toBe(false);
    const e3 = after(e2, decideCount(e2, k.id, true, "Vu"));
    expect(fulls(e3, "b125")).toBe(far.baobab.b125);
  });

  it("the pending wholesaler count is a shrinkage the manager can validate", () => {
    const k = base.data.counts.find((c) => c.status === "A_VALIDER")!;
    const e = after(base, decideCount(base, k.id, true, ""));
    expect(e.data.movements.filter((m) => m.refs.countId === k.id).every((m) => m.qty < 0 && m.kind === "AJUSTEMENT")).toBe(true);
  });

  it("an exchange gives back competitor empties for our own, never more than held", () => {
    const held = empties(base, "sahel", "b6");
    expect(exchange(base, { centreId: "ruf", brand: "sahel", given: { b6: held + 1 }, received: { b6: 1 } }).ok).toBe(false);
    const e = after(base, exchange(base, { centreId: "ruf", brand: "sahel", given: { b6: held }, received: { b6: held } }));
    expect(empties(e, "sahel", "b6")).toBe(0);
    expect(empties(e, "baobab", "b6")).toBe(empties(base, "baobab", "b6") + held);
  });

  it("adjustments carry a reason code", () => {
    expect(adjust(base, { centreId: "ruf", state: "VIDE", brand: "baobab", formatId: "b6", qty: -3, reason: "?" }).ok).toBe(false);
    const e = after(base, adjust(base, { centreId: "ruf", state: "VIDE", brand: "baobab", formatId: "b6", qty: -3, reason: "CASSE" }));
    expect(e.data.movements.at(-1)).toMatchObject({ kind: "AJUSTEMENT", qty: -3, reason: "CASSE" });
  });
});

describe("day close and authority report", () => {
  it("closes once, with the permission, and then refuses movements dated that day", () => {
    const e = after(base, closeDay(base, "kao", "2026-10-10"));
    expect(closeDay(e, "kao", "2026-10-10").ok).toBe(false);
    expect(closeDay({ ...base, can: () => false }, "kao", "2026-10-10").ok).toBe(false);
    // Today a truck is loading at each centre, so neither day can close yet.
    expect(closeDay(base, "ruf", base.today).ok).toBe(false);
    expect(closeDay(base, "kao", base.today).ok).toBe(false);
    // Anything recorded while the clock is on a closed day is refused.
    const onClosedDay = { ...e, now: "2026-10-10T15:00:00" };
    expect(adjust(onClosedDay, { centreId: "kao", state: "VIDE", brand: "baobab", formatId: "b6", qty: 1, reason: "CASSE" }).ok).toBe(false);
    expect(adjust({ ...e, now: "2026-10-12T15:00:00" }, { centreId: "kao", state: "VIDE", brand: "baobab", formatId: "b6", qty: 1, reason: "CASSE" }).ok).toBe(true);
  });

  it("report rows balance: opening + in − out = closing, by brand and format", () => {
    const rows = reportRows(base.ledger, "ruf", "2026-10-09", base.cfg.sales.brands, base.cfg.bottleTypes.map((b) => b.id));
    expect(rows.length).toBeGreaterThan(8);
    for (const r of rows) {
      expect(r.closing).toBe(r.opening + r.in - r.out);
      expect(r.closing).toBe(r.fulls + r.empties + r.damaged);
    }
    expect(rows.some((r) => r.brand === "sahel")).toBe(true);
  });

  it("the CSV follows the template and says when it is provisional", async () => {
    const rows = reportRows(base.ledger, "ruf", "2026-10-09", base.cfg.sales.brands, base.cfg.bottleTypes.map((b) => b.id));
    const f = authorityCsv({ rows, template: base.cfg.sales.reports.authority, centre: "RUF", date: "2026-10-09", brand: (b) => b, format: (x) => x });
    expect(f.filename).toBe("etat-bouteilles-RUF-2026-10-09.csv");
    const text = await f.blob.text();
    const lines = text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toMatch(/^MODÈLE PROVISOIRE/);
    expect(lines[1]).toBe("Marque;Format;Stock d'ouverture;Entrées;Sorties;Stock de clôture;Dont pleins;Dont vides;Dont réformées");
    expect(lines).toHaveLength(rows.length + 2);
  });
});

describe("fill confirmation by production", () => {
  function confirmed(e = base) {
    let x = after(e, saveDraft(e, { id: "f1", customerId: "c05", centreId: "ruf", mode: "LIVRAISON", date: e.today, qty: { b6: 200, b125: 100 } }));
    x = after(x, confirmOrder(x, "f1"));
    x = after(x, planDispatch(x, "f1", { truck: "DK-9", driver: "A", date: x.today, time: "10:00" }));
    const id = x.data.dispatches.at(-1)!.id;
    for (const role of ["Magasinier", "Chauffeur"]) x = after(x, confirmParty(x, id, "gateIn", { role, name: role, code: "1" }));
    return { x: after(x, advanceDispatch(x, id, "gateIn")), id };
  }

  it("loading waits for the fill when the step is on, and only for what was filled", () => {
    const { x, id } = confirmed();
    const r = advanceDispatch(x, id, "load");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Remplissage non confirmé/);
    const partly = after(x, confirmFill(x, "f1", { b6: 200, b125: 40 }));
    expect(advanceDispatch(partly, id, "load").ok).toBe(false);
    const loadPart = after(partly, updateDispatch(partly, id, { loaded: { b6: 200, b125: 40 } }));
    expect(advanceDispatch(loadPart, id, "load").ok).toBe(true);
    const off = { ...x, cfg: { ...x.cfg, sales: { ...x.cfg.sales, workflow: { ...x.cfg.sales.workflow, steps: { ...x.cfg.sales.workflow.steps, fillConfirmation: false } } } } };
    expect(advanceDispatch(off, id, "load").ok).toBe(true);
  });

  it("is a running total, bounded by the need and by what already left, and needs the permission", () => {
    const { x } = confirmed();
    expect(confirmFill({ ...x, can: (a) => a !== "order.fill" }, "f1", { b6: 10 }).ok).toBe(false);
    expect(confirmFill(x, "f1", { b6: 201 }).ok).toBe(false);
    const e = after(x, confirmFill(x, "f1", { b6: 120 }));
    expect(e.data.orders.find((o) => o.id === "f1")?.filled).toEqual({ b6: 120, b125: 0 });
    expect(e.data.orders.find((o) => o.id === "f1")?.history.at(-1)?.label).toBe("Remplissage partiel confirmé");
    expect(confirmFill(e, "f1", { b6: 120 }).ok).toBe(false);
    const bulk = base.data.orders.find((o) => o.lines.every((l) => l.formatId === "vrac") && o.status === "CONFIRMEE")!;
    expect(confirmFill(base, bulk.id, {}).ok).toBe(false);
  });

  it("the demo leaves today's queue partly filled", () => {
    const today = base.data.orders.filter((o) => o.date === base.today && o.status === "CONFIRMEE" && o.lines.some((l) => l.formatId !== "vrac"));
    expect(today.some((o) => Object.values(o.filled).some((n) => n > 0))).toBe(true);
    expect(today.some((o) => !Object.values(o.filled).some((n) => n > 0))).toBe(true);
  });
});

