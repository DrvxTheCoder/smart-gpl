import { describe, expect, it } from "vitest";
import { BOARD_COLUMNS, CONFIRMED_ON_DROP, moveFor, NEXT_ACTION, nextStatus } from "../lib/sales/board";
import { DISPATCH_FLOW } from "../lib/sales/lifecycle";

describe("truck board moves", () => {
  it("has one column per dispatch state, in lifecycle order", () => {
    expect(BOARD_COLUMNS.map((c) => c.status)).toEqual(["PLANIFIE", "EN_CHARGEMENT", "CHARGE", "EXPEDIE", "LIVRE"]);
  });

  it("each next action is the lifecycle transition out of that state", () => {
    for (const [from, n] of Object.entries(NEXT_ACTION)) {
      const t = DISPATCH_FLOW.find((x) => x.action === n!.action)!;
      expect(t.from).toContain(from);
      expect(t.label).toBe(n!.label);
    }
  });

  it("only the next column forward is a valid drop", () => {
    expect(moveFor("PLANIFIE", "EN_CHARGEMENT", "LIVRAISON")).toEqual({ ok: true, action: "gateIn" });
    expect(moveFor("CHARGE", "EXPEDIE", "LIVRAISON")).toEqual({ ok: true, action: "expedite" });
    expect(moveFor("EXPEDIE", "LIVRE", "LIVRAISON")).toEqual({ ok: true, action: "deliver" });
    expect(moveFor("PLANIFIE", "PLANIFIE", "LIVRAISON")).toBeNull();
    const skip = moveFor("PLANIFIE", "CHARGE", "LIVRAISON");
    expect(skip?.ok).toBe(false);
    expect(skip && !skip.ok && skip.reason).toMatch(/Une étape à la fois/);
    const back = moveFor("CHARGE", "PLANIFIE", "LIVRAISON");
    expect(back && !back.ok && back.reason).toMatch(/retour en arrière/);
  });

  it("a pick-up leaves delivered: « En route » and « Livrés » both expedite it", () => {
    expect(nextStatus("CHARGE", "ENLEVEMENT")).toBe("LIVRE");
    expect(moveFor("CHARGE", "LIVRE", "ENLEVEMENT")).toEqual({ ok: true, action: "expedite" });
    expect(moveFor("CHARGE", "EXPEDIE", "ENLEVEMENT")).toEqual({ ok: true, action: "expedite" });
    expect(moveFor("CHARGE", "LIVRE", "LIVRAISON")?.ok).toBe(false);
  });

  it("transitions that write ledger rows are always confirmed in a dialog", () => {
    const writing = DISPATCH_FLOW.filter((t) => t.effects.some((e) => e.protected)).map((t) => t.action);
    expect([...CONFIRMED_ON_DROP].sort()).toEqual(writing.sort());
  });
});
