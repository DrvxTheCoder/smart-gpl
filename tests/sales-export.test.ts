import { describe, expect, it } from "vitest";
import { markExported, salesToExport } from "../lib/sales/commands/export";
import { sageCsv } from "../lib/sales/sage";
import { after, demoEnv } from "./helpers";

const env = demoEnv();

describe("Sage export", () => {
  const lines = salesToExport(env, { from: "2026-10-05", to: "2026-10-10", centreId: "ruf" });

  it("one line per format of every expedited BL and passage; placements are not sales", () => {
    expect(lines.length).toBeGreaterThan(20);
    expect(lines.every((l) => l.centreId === "ruf" && l.date >= "2026-10-05" && l.date <= "2026-10-10")).toBe(true);
    expect(lines.every((l) => l.amount === l.qty * l.price && Number.isInteger(l.amount))).toBe(true);
    // Wholesalers appear through their passages (no BL number), never through placements.
    const wholesale = lines.filter((l) => l.customer?.categoryId === "grossiste");
    expect(wholesale.length).toBeGreaterThan(0);
    expect(wholesale.every((l) => l.bl === "")).toBe(true);
  });

  it("writes the template's columns and marks the orders exported", async () => {
    const f = sageCsv(lines, env.cfg.sales.reports.sage, { format: (x) => x, centre: (x) => x.toUpperCase() }, { centre: "RUF", date: "2026-10-10" });
    expect(f.filename).toBe("ventes-sage-RUF-2026-10-10.csv");
    const rows = (await f.blob.text()).replace(/^﻿/, "").trim().split("\r\n");
    expect(rows[1].split(";")).toHaveLength(env.cfg.sales.reports.sage.columns.length);
    expect(rows).toHaveLength(lines.length + 2);
    const e = after(env, markExported(env, lines));
    const ids = new Set(lines.map((l) => l.orderId).filter(Boolean));
    expect(e.data.orders.filter((o) => ids.has(o.id)).every((o) => o.exported)).toBe(true);
    expect(markExported(env, []).ok).toBe(false);
  });
});
