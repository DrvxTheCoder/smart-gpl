import { describe, expect, it } from "vitest";
import { approveOrder, cancelOrder, checkOrder, closeOrder, confirmOrder, declareReliquat, planDispatch, saveDraft } from "../lib/sales/commands/orders";
import { accountBalance } from "../lib/sales/exposure";
import { centreSite, siteBalance } from "../lib/sales/bottle-ledger";
import { remainingQty } from "../lib/sales/stock";
import { after, demoEnv } from "./helpers";

const env = demoEnv();
const draft = (e: typeof env, customerId: string, qty: Record<string, number>, id = `t-${customerId}`) => after(e, saveDraft(e, { id, customerId, centreId: e.data.customers.find((c) => c.id === customerId)!.centreIds[0], mode: "LIVRAISON", date: e.today, qty }));
const find = (e: typeof env, id: string) => e.data.orders.find((o) => o.id === id)!;

describe("drafts", () => {
  it("prices lines from the contract in force and numbers the order", () => {
    const e = draft(env, "c01", { b125: 100, b6: 50 });
    const o = find(e, "t-c01");
    expect(o.status).toBe("BROUILLON");
    expect(o.number).toMatch(/^BC-2026\d{5}RUF$/);
    expect(o.lines.find((l) => l.formatId === "b125")?.price).toBe(6_050);
    expect(o.contractVersion).toBe(2);
  });

  it("refuses inactive customers, past dates, and editing a validated order", () => {
    expect(saveDraft(env, { id: "x", customerId: "c01", centreId: "ruf", mode: "LIVRAISON", date: "2026-10-01", qty: { b6: 1 } }).ok).toBe(false);
    const confirmed = env.data.orders.find((o) => o.status === "CONFIRMEE")!;
    const r = saveDraft(env, { id: confirmed.id, customerId: confirmed.customerId, centreId: confirmed.centreId, mode: confirmed.mode, date: env.today, qty: { b6: 1 } });
    expect(r.ok).toBe(false);
  });
});

describe("confirmation", () => {
  it("a customer within limits confirms straight away", () => {
    const e = draft(env, "c05", { b6: 100 });
    const e2 = after(e, confirmOrder(e, "t-c05"));
    expect(find(e2, "t-c05")).toMatchObject({ status: "CONFIRMEE", approval: { required: false } });
  });

  it("the overdue industrial customer is blocked; an override needs the permission and leaves an approval", () => {
    const blocked = env.data.orders.find((o) => o.customerId === "c08" && o.status === "BROUILLON")!;
    const c = checkOrder(env, blocked);
    expect(c.credit.decision).toBe("BLOCK");
    expect(confirmOrder(env, blocked.id).ok).toBe(false);
    expect(confirmOrder({ ...env, can: (a) => a !== "credit.override" }, blocked.id, { override: "Garantie" }).ok).toBe(false);
    const e2 = after(env, confirmOrder(env, blocked.id, { override: "Garantie bancaire reçue" }));
    const o = find(e2, blocked.id);
    expect(o.status).toBe("CONFIRMEE");
    expect(o.approval.required).toBe(true);
    expect(o.approval.reasons.join(" ")).toMatch(/Crédit forcé/);
    expect(o.history.map((h) => h.label)).toContain("Dépassement de crédit forcé");
  });

  it("above the threshold the order waits for a manager, whose approval is permission-checked", () => {
    const e = draft(env, "c02", { b125: 20_000 });
    const e2 = after(e, confirmOrder(e, "t-c02"));
    expect(find(e2, "t-c02").approval.required).toBe(true);
    expect(approveOrder({ ...e2, can: () => false }, "t-c02", "").ok).toBe(false);
    const e3 = after(e2, approveOrder(e2, "t-c02", "Client stratégique"));
    expect(find(e3, "t-c02").approval.by).toBe("Test");
  });

  it("over-ordering creates a planned reliquat by default, and is refused under hard-block", () => {
    const e = draft(env, "c05", { b38: 50_000 });
    expect(checkOrder(e, find(e, "t-c05")).shortfalls[0].formatId).toBe("b38");
    const ok = after(e, confirmOrder(e, "t-c05"));
    expect(find(ok, "t-c05").history.map((h) => h.label)).toContain("Reliquat prévu");
    const hard = { ...e, cfg: { ...e.cfg, sales: { ...e.cfg.sales, stock: { ...e.cfg.sales.stock, backorder: "BLOQUER" as const } } } };
    expect(confirmOrder(hard, "t-c05").ok).toBe(false);
  });

  it("a wholesaler at the block step of the ladder cannot receive new placements", () => {
    const e = draft(env, "g02", { b6: 100 });
    // 9 days without a passage: manager notified, not blocked yet (block at day 10).
    expect(checkOrder(e, find(e, "t-g02")).placementBlocked).toBeNull();
    const strict = { ...e, cfg: { ...e.cfg, sales: { ...e.cfg.sales, consignment: { ...e.cfg.sales.consignment, ladder: [{ day: 5, action: "TACHE" as const }, { day: 8, action: "BLOQUER" as const }] } } } };
    expect(checkOrder(strict, find(strict, "t-g02")).placementBlocked).toMatch(/bloquées/);
    expect(confirmOrder(strict, "t-g02").ok).toBe(false);
  });
});

describe("after confirmation", () => {
  it("plans a truck for what remains, never more", () => {
    const e = draft(env, "c05", { b6: 100 });
    const e2 = after(e, confirmOrder(e, "t-c05"));
    const e3 = after(e2, planDispatch(e2, "t-c05", { truck: "dk-1", driver: "A", date: env.today, time: "10:00" }));
    const d = e3.data.dispatches.at(-1)!;
    expect(d).toMatchObject({ status: "PLANIFIE", truck: "DK-1", loaded: { b6: 100 } });
    expect(planDispatch(e3, "t-c05", { truck: "dk-2", driver: "", date: env.today, time: "11:00" }).ok).toBe(false);
  });

  it("a reliquat closes the remainder of a partly served order", () => {
    const partial = env.data.orders.find((o) => o.status === "EXPEDIEE")!;
    expect(declareReliquat(env, partial.id, "INCONNU").ok).toBe(false);
    const e2 = after(env, declareReliquat(env, partial.id, "STOCK"));
    const o = find(e2, partial.id);
    expect(Object.values(remainingQty(o, e2.data.dispatches)).every((n) => n === 0)).toBe(true);
    expect(o.status).toBe("LIVREE");
  });

  it("rectifying a shipped order reverses its movements and entries, and opens a linked draft", () => {
    const shipped = env.data.orders.find((o) => o.status === "LIVREE" && o.customerId === "c01")!;
    const before = { bal: accountBalance(env.data.entries, "c01"), fulls: siteBalance(env.ledger, centreSite("ruf")).PLEIN.baobab };
    expect(cancelOrder(env, shipped.id, "", true).ok).toBe(false);
    expect(cancelOrder({ ...env, can: () => false }, shipped.id, "Erreur", true).ok).toBe(false);
    const e2 = after(env, cancelOrder(env, shipped.id, "Quantités erronées", true));
    const o = find(e2, shipped.id);
    const copy = find(e2, o.replacedBy!);
    expect(o.status).toBe("ANNULEE");
    expect(copy).toMatchObject({ status: "BROUILLON", replaces: shipped.id, lines: shipped.lines });
    const amount = env.data.entries.filter((x) => x.refs.orderId === shipped.id && x.kind === "DEBIT").reduce((a, x) => a + x.amount, 0);
    expect(accountBalance(e2.data.entries, "c01")).toBe(before.bal - amount);
    const sent = shipped.lines.find((l) => l.formatId === "b6")!;
    expect(siteBalance(e2.ledger, centreSite("ruf")).PLEIN.baobab.b6).toBeGreaterThanOrEqual(before.fulls.b6 + 1);
    expect(e2.data.movements.filter((m) => m.reverses).every((m) => m.reason === "Quantités erronées")).toBe(true);
    expect(sent.qty).toBeGreaterThan(0);
  });

  it("a closed and exported order is corrected in Sage, not here", () => {
    const closed = env.data.orders.find((o) => o.status === "CLOTUREE")!;
    expect(cancelOrder(env, closed.id, "x", false).ok).toBe(false);
  });

  it("closing waits for the export when that step is on", () => {
    const delivered = env.data.orders.find((o) => o.status === "LIVREE" && !o.exported) ?? { ...env.data.orders.find((o) => o.status === "LIVREE")!, exported: false };
    const e = after(env, { ok: true, patch: { orders: [delivered] }, msg: "" });
    expect(closeOrder(e, delivered.id).ok).toBe(false);
    const off = { ...e, cfg: { ...e.cfg, sales: { ...e.cfg.sales, workflow: { ...e.cfg.sales.workflow, steps: { ...e.cfg.sales.workflow.steps, accountingExport: false } } } } };
    expect(find(after(off, closeOrder(off, delivered.id)), delivered.id).status).toBe("CLOTUREE");
  });
});
