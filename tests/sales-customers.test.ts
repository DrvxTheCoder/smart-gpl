import { describe, expect, it } from "vitest";
import { contractAt } from "../lib/sales/contracts";
import { accountBalance } from "../lib/sales/exposure";
import { newContract, recordIncident, recordPayment, reverseEntry, saveCustomer } from "../lib/sales/commands/customers";
import { customerPosition } from "../lib/sales/selectors";
import { paymentHistory, solvency } from "../lib/sales/solvency";
import { DEFAULT_SALES } from "../lib/sales/defaults";
import type { AccountEntry, Incident } from "../lib/sales/types";
import { after, demoEnv } from "./helpers";

const env = demoEnv();
const pos = (e: typeof env, id: string) => customerPosition(e, e.data.customers.find((c) => c.id === id)!);

describe("solvency", () => {
  const d = (id: string, amount: number, ts: string, due: string): AccountEntry => ({ id, customerId: "c", ts: `${ts}T08:00:00.000Z`, kind: "DEBIT", amount, dueDate: due, label: id, refs: {}, by: "t" });
  const p = (id: string, amount: number, ts: string): AccountEntry => ({ id, customerId: "c", ts: `${ts}T09:00:00.000Z`, kind: "CREDIT", amount, dueDate: null, label: id, refs: {}, by: "t" });
  const base = { cfg: DEFAULT_SALES.solvency, customerId: "c", today: "2026-10-12", termDays: 30, limit: 1_000_000, floatValue: 0 };

  it("reads days to pay from the account, oldest debit first", () => {
    const h = paymentHistory([d("a", 100, "2026-08-01", "2026-08-31"), d("b", 100, "2026-08-10", "2026-09-09"), p("x", 150, "2026-09-05"), p("y", 50, "2026-09-20")], "c", "2026-07-01");
    expect(h.map((x) => [x.e.id, x.on])).toEqual([
      ["a", "2026-09-05"],
      ["b", "2026-09-20"],
    ]);
  });

  it("a punctual customer within its limit is solvable; the explanation carries the figures", () => {
    const s = solvency({ ...base, entries: [d("a", 500_000, "2026-08-01", "2026-08-31"), p("x", 500_000, "2026-08-30")], incidents: [], exposure: 300_000, openTotal: 0, overdue: 0 });
    expect(s.tone).toBe("ok");
    expect(s.score).toBe(100);
    expect(s.parts.map((x) => x.key)).toEqual(["delay", "overdue", "utilization", "incidents"]);
    expect(s.parts[0].detail).toMatch(/29,0 j pour 30 j convenus/);
  });

  it("lateness, overdue share, limit use and incidents pull the score down", () => {
    const incidents: Incident[] = [{ id: "i", customerId: "c", ts: "2026-10-01T10:00:00.000Z", kind: "CHEQUE_IMPAYE", note: "", by: "t" }];
    const s = solvency({ ...base, entries: [d("a", 500_000, "2026-07-20", "2026-08-19"), p("x", 500_000, "2026-09-18"), d("b", 900_000, "2026-08-20", "2026-09-19")], incidents, exposure: 1_150_000, openTotal: 900_000, overdue: 900_000 });
    expect(s.tone).toBe("alert");
    // 500 000 paid 30 days late, 900 000 still open 23 days past due.
    expect(s.inputs.avgDaysLate).toBeCloseTo((500_000 * 30 + 900_000 * 23) / 1_400_000);
    expect(s.inputs.bounced).toBe(1);
    // The suggested limit is a figure to review, never applied.
    expect(s.suggestedLimit).toBeGreaterThan(0);
  });

  it("the demo has solvable, watched and unjustified customers", () => {
    const tones = env.data.customers.map((c) => pos(env, c.id).solvency.tone);
    expect(tones).toContain("ok");
    expect(tones).toContain("alert");
    expect(pos(env, "c08").solvency.tone).toBe("alert");
  });
});

describe("customer commands", () => {
  it("creates a customer with its category's terms as contract v1, and refuses duplicates", () => {
    const input = { name: "Gaz Plus Médina", categoryId: "station", zone: "Médina", contactName: "A", phone: "77", centreIds: ["ruf"], rep: "Fatou Diop", active: true };
    const r = saveCustomer(env, input);
    const e2 = after(env, r);
    const c = e2.data.customers.find((x) => x.name === "Gaz Plus Médina")!;
    expect(c.code).toBe("CL-013");
    const k = contractAt(e2.data.contracts, c.id, env.today)!;
    expect(k.version).toBe(1);
    expect(k.terms).toEqual(env.cfg.sales.categories.find((x) => x.id === "station")!.defaults);
    const dup = saveCustomer(e2, input);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toMatch(/Doublon/);
  });

  it("a new contract version takes effect on its date and keeps the old one for past orders", () => {
    const old = contractAt(env.data.contracts, "c02", env.today)!;
    const e2 = after(env, newContract(env, "c02", { ...old.terms, creditLimit: 2_000_000_000 }, "2026-10-13"));
    expect(contractAt(e2.data.contracts, "c02", "2026-10-12")!.version).toBe(old.version);
    expect(contractAt(e2.data.contracts, "c02", "2026-10-13")!.terms.creditLimit).toBe(2_000_000_000);
    expect(newContract(env, "c02", old.terms, "2026-10-01").ok).toBe(false);
  });

  it("payments are integer credits; future dates and zero amounts are refused", () => {
    const before = accountBalance(env.data.entries, "c03");
    const e2 = after(env, recordPayment(env, { customerId: "c03", amount: 1_000_000.4, method: "VIREMENT", date: env.today, note: "VIR 123" }));
    expect(accountBalance(e2.data.entries, "c03")).toBe(before - 1_000_000);
    expect(recordPayment(env, { customerId: "c03", amount: 0, method: "VIREMENT", date: env.today, note: "" }).ok).toBe(false);
    expect(recordPayment(env, { customerId: "c03", amount: 5, method: "VIREMENT", date: "2026-10-13", note: "" }).ok).toBe(false);
  });

  it("an entry is cancelled by its mirror image, once, with a reason and the right permission", () => {
    const e2 = after(env, recordPayment(env, { customerId: "c03", amount: 250_000, method: "CHEQUE", date: env.today, note: "" }));
    const pay = e2.data.entries[e2.data.entries.length - 1];
    expect(reverseEntry({ ...e2, can: () => false }, pay.id, "Doublon").ok).toBe(false);
    expect(reverseEntry(e2, pay.id, "  ").ok).toBe(false);
    const e3 = after(e2, reverseEntry(e2, pay.id, "Saisie en double"));
    expect(accountBalance(e3.data.entries, "c03")).toBe(accountBalance(env.data.entries, "c03"));
    expect(reverseEntry(e3, pay.id, "Encore").ok).toBe(false);
  });

  it("a bounced cheque is an incident and a debit due at once", () => {
    const e2 = after(env, recordIncident(env, { customerId: "c05", kind: "CHEQUE_IMPAYE", note: "Provision insuffisante", amount: 2_000_000 }));
    expect(e2.data.incidents.at(-1)?.kind).toBe("CHEQUE_IMPAYE");
    expect(e2.data.entries.at(-1)).toMatchObject({ kind: "DEBIT", amount: 2_000_000, dueDate: env.today });
    expect(pos(e2, "c05").solvency.inputs.bounced).toBe(1);
  });
});
