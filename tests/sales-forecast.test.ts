import { describe, expect, it } from "vitest";
import { periodsAround, weekRange, isoWeek, periodLabel } from "../lib/sales/dates";
import { fillPlan } from "../lib/sales/fill-plan";
import { accuracy, band, demandCells, fillRate, forecastCells, nextVersion, otif, parseBlock, reliquats } from "../lib/sales/forecast";
import { saveForecast } from "../lib/sales/commands/forecast";
import { centreFillPlan } from "../lib/sales/selectors";
import type { Customer, Dispatch, Forecast, Order } from "../lib/sales/types";
import { after, demoEnv } from "./helpers";

const NOW = "2026-10-12T10:00:00.000Z";
const order = (id: string, date: string, lines: [string, number][], patch: Partial<Order> = {}): Order => ({
  id,
  number: id,
  centreId: "ruf",
  customerId: "c",
  contractVersion: 1,
  workflowVersion: 1,
  mode: "LIVRAISON",
  date,
  createdAt: NOW,
  createdBy: "t",
  lines: lines.map(([formatId, qty]) => ({ formatId, qty, price: 1000 })),
  status: "LIVREE",
  approval: { required: false, reasons: [], by: null, at: null, note: null },
  reliquats: [],
  filled: {},
  history: [],
  replaces: null,
  replacedBy: null,
  exported: false,
  ...patch,
});
const truck = (orderId: string, day: string, loaded: Record<string, number>): Dispatch => ({
  id: `${orderId}-${day}`,
  number: "BL",
  orderId,
  centreId: "ruf",
  customerId: "c",
  truck: "",
  driver: "",
  slot: `${day}T10:00:00`,
  status: "LIVRE",
  empties: {},
  damaged: {},
  loaded,
  weighing: null,
  gateIn: [],
  loading: [],
  delivery: [],
  dispute: null,
  history: [],
});

describe("periods", () => {
  it("ISO weeks and months around today", () => {
    expect(isoWeek("2026-10-12")).toBe("2026-W42");
    expect(weekRange("2026-W42")).toEqual(["2026-10-12", "2026-10-18"]);
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(periodsAround("2026-03-15", "MOIS", 3, 1)).toEqual(["2025-12", "2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(periodsAround("2026-10-12", "SEMAINE", 1, 1)).toEqual(["2026-W41", "2026-W42", "2026-W43"]);
    expect(periodLabel("2026-W42", "SEMAINE")).toBe("S42");
  });
});

describe("forecast accuracy and bias", () => {
  const fc = new Map([
    ["W1|c|b6", 110],
    ["W1|c|b125", 50],
    ["W2|c|b6", 90],
  ]);
  const actual = new Map([
    ["W1|c|b6", 100],
    ["W1|c|b125", 100],
    ["W2|c|b6", 100],
  ]);

  it("MAPE averages absolute errors over cells with demand; bias is signed", () => {
    const a = accuracy(fc, actual, ["W1", "W2"]);
    expect(a.mape).toBeCloseTo(((0.1 + 0.5 + 0.1) / 3) * 100);
    expect(a.bias).toBeCloseTo(((250 - 300) / 300) * 100);
    expect(accuracy(fc, actual, ["W1", "W2"], { formatId: "b6" }).bias).toBe(0);
    expect(accuracy(new Map(), new Map(), ["W1"]).mape).toBeNull();
  });

  it("category lines spread over their customers; demand includes wholesaler sell-out", () => {
    const customers = [{ id: "a", categoryId: "x", zone: "z" }, { id: "b", categoryId: "x", zone: "z" }] as Customer[];
    const f: Forecast = { id: "f", centreId: "ruf", granularity: "SEMAINE", version: 1, basis: "INITIALE", createdBy: "t", createdAt: NOW, lines: [{ period: "W1", formatId: "b6", scope: "CATEGORIE", key: "x", qty: 100 }] };
    expect(forecastCells(f, customers).get("W1|a|b6")).toBe(50);
    const d = demandCells({
      orders: [order("o", "2026-10-12", [["b6", 40]], { customerId: "a" })],
      settlements: [{ id: "s", number: "", customerId: "g", centreId: "ruf", ts: "2026-10-13T10:00:00", empties: {}, sold: { b6: 30 }, given: {}, amount: 0, paid: null, confirmations: [], status: "CONFIRME", statementId: null, by: "" }],
      centreId: "ruf",
      granularity: "SEMAINE",
    });
    expect(d.get("2026-W42|a|b6")).toBe(40);
    expect(d.get("2026-W42|g|b6")).toBe(30);
  });

  it("tones follow the tenant's thresholds", () => {
    expect(band(12, [15, 30], true)).toBe("ok");
    expect(band(40, [15, 30], true)).toBe("alert");
    expect(band(96, [98, 95])).toBe("warn");
    expect(band(null, [98, 95])).toBeNull();
  });
});

describe("service level", () => {
  const orders = [
    order("full", "2026-10-05", [["b6", 100]]),
    order("late", "2026-10-05", [["b6", 100]]),
    order("short", "2026-10-06", [["b6", 100]], { reliquats: [{ formatId: "b6", qty: 20, reason: "CAMION", at: NOW, by: "t" }] }),
    order("draft", "2026-10-06", [["b6", 100]], { status: "BROUILLON" }),
  ];
  const ds = [truck("full", "2026-10-05", { b6: 100 }), truck("late", "2026-10-07", { b6: 100 }), truck("short", "2026-10-06", { b6: 80 })];

  it("fill rate is served over ordered; drafts do not count", () => {
    expect(fillRate(orders, ds, "2026-10-01", "2026-10-10", "ruf")).toEqual({ ordered: 300, served: 280, rate: (280 / 300) * 100 });
  });

  it("OTIF needs every line in full and the last truck on time", () => {
    const r = otif(orders, ds, "2026-10-01", "2026-10-10", "ruf");
    expect([r.judged, r.ok]).toEqual([3, 1]);
    expect(r.rate).toBeCloseTo(100 / 3);
  });

  it("reliquats are summed by reason", () => {
    expect(reliquats(orders, "2026-10-01", "2026-10-10", "ruf")).toEqual({ CAMION: 20 });
  });
});

describe("fill plan vs capacity", () => {
  const formats = [
    { id: "b6", label: "B6", kg: 6 },
    { id: "b125", label: "B12,5", kg: 12.5 },
  ];
  const base = { formats, reliquat: {}, reserved: {}, incomingEmpties: {}, dailyForecast: { b6: 100, b125: 100 }, safetyDays: 2, capacityTph: 10, usefulHoursPerDay: 7, days: 6, warnPct: 85 };

  it("needed = forecast + reliquat − free stock + safety, in tonnes against capacity", () => {
    const p = fillPlan({ ...base, forecast: { b6: 600, b125: 600 }, reliquat: { b6: 50 }, fulls: { b6: 300, b125: 100 }, reserved: { b6: 100 }, ownEmpties: { b6: 5000, b125: 5000 } });
    expect(p.rows[0].needed).toBe(600 + 50 - 200 + 200);
    expect(p.rows[1].needed).toBe(600 - 100 + 200);
    expect(p.totalT).toBeCloseTo((650 * 6 + 700 * 12.5) / 1000);
    expect(p.capacityT).toBe(420);
    expect(p.tone).toBe("ok");
  });

  it("missing own empties or too much tonnage is an alert, a tight load a warning", () => {
    expect(fillPlan({ ...base, forecast: { b6: 600 }, fulls: {}, ownEmpties: { b6: 100 } }).tone).toBe("alert");
    const empties = { b6: 9_999, b125: 99_999 };
    expect(fillPlan({ ...base, forecast: { b125: 35_000 }, fulls: {}, ownEmpties: empties }).tone).toBe("alert"); // 441 T for 420
    expect(fillPlan({ ...base, forecast: { b125: 29_000 }, fulls: {}, ownEmpties: empties }).tone).toBe("warn"); // 87 % of the lines
  });

  it("the demo centre has a plan with every format", () => {
    const env = demoEnv();
    const p = centreFillPlan(env, "ruf");
    expect(p.rows).toHaveLength(env.cfg.bottleTypes.length);
    expect(p.capacityT).toBeGreaterThan(0);
  });
});

describe("forecast versions", () => {
  it("a revision never overwrites: untouched periods keep the previous figures", () => {
    const v1: Forecast = { id: "1", centreId: "ruf", granularity: "SEMAINE", version: 1, basis: "INITIALE", createdBy: "t", createdAt: NOW, lines: [{ period: "A", formatId: "b6", scope: "CLIENT", key: "c", qty: 10 }, { period: "B", formatId: "b6", scope: "CLIENT", key: "c", qty: 20 }] };
    const v2 = nextVersion(v1, { id: "2", centreId: "ruf", granularity: "SEMAINE", by: "t", now: NOW, lines: [{ period: "B", formatId: "b6", scope: "CLIENT", key: "c", qty: 0 }] });
    expect(v2.version).toBe(2);
    expect(v2.basis).toBe("REVISION");
    expect(v2.lines).toEqual([v1.lines[0]]);
    expect(v1.lines).toHaveLength(2);
  });

  it("saving needs the permission and a change", () => {
    const env = demoEnv();
    const lines = [{ period: "2026-W43", formatId: "b6", scope: "CLIENT" as const, key: "c01", qty: 4242 }];
    expect(saveForecast({ ...env, can: () => false }, { centreId: "ruf", granularity: "SEMAINE", lines }).ok).toBe(false);
    const e2 = after(env, saveForecast(env, { centreId: "ruf", granularity: "SEMAINE", lines }));
    const v = e2.data.forecasts.filter((f) => f.centreId === "ruf").sort((a, b) => b.version - a.version)[0];
    expect(v.version).toBe(3);
    expect(saveForecast(e2, { centreId: "ruf", granularity: "SEMAINE", lines }).ok).toBe(false);
  });

  it("parses a block pasted from a spreadsheet", () => {
    expect(parseBlock("1 200\t300\r\n4,5\t\n")).toEqual([
      [1200, 300],
      [5, 0],
    ]);
  });
});
