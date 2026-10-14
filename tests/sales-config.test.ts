import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, generateInventories } from "../lib/seed";
import { addToOverlay, emptyData, loadOverlay, mergeOverlay, storedOverlay } from "../lib/sales/data";
import { PRESETS } from "../lib/sales/defaults";
import { centreSite, ownBrand, siteBalance } from "../lib/sales/bottle-ledger";
import { ymd } from "../lib/sales/dates";
import { reportRows } from "../lib/sales/day-close";
import { generateSales } from "../lib/sales/seed";
import { dispatchedQty, ledgerStart, openingMovements, productionMovements } from "../lib/sales/stock";
import { exportTenantJson, migrateStoredConfig, parseTenantJson, STORAGE_VERSION } from "../lib/tenant-io";
import type { Order } from "../lib/types";

const v2 = () => {
  const { sales: _s, ...rest } = DEFAULT_CONFIG;
  void _s;
  return rest;
};

describe("sales configuration", () => {
  it("migrates a v2 stored config by injecting the sales defaults", () => {
    const m = migrateStoredConfig(JSON.stringify({ version: 2, config: { ...v2(), branding: { ...DEFAULT_CONFIG.branding, shortName: "XY" } } }));
    expect(STORAGE_VERSION).toBe(3);
    expect(m.migrated).toBe(true);
    expect(m.notice).toBeNull();
    expect(m.config.branding.shortName).toBe("XY");
    expect(m.config.sales.brands.filter((b) => b.own)).toHaveLength(1);
    expect(m.config.sales.workflow.steps.creditCheck).toBe(true);
  });

  it("keeps only the tenant's own formats and centres when injecting defaults", () => {
    const cfg = { ...v2(), bottleTypes: [{ id: "b125", label: "B12,5", kg: 12.5 }], centres: DEFAULT_CONFIG.centres.slice(1) };
    const m = migrateStoredConfig(JSON.stringify({ version: 2, config: cfg }));
    expect(m.notice).toBeNull();
    const formats = new Set(m.config.sales.priceLists.flatMap((p) => p.lines.map((l) => l.formatId)));
    expect([...formats].sort()).toEqual(["b125", "vrac"]);
    expect(Object.keys(m.config.sales.openingStock)).toEqual(["kao"]);
  });

  it("accepts v2 template files and round-trips v3 ones", () => {
    expect(parseTenantJson(JSON.stringify({ format: "jauge-tenant-config", version: 2, config: v2() })).value?.sales).toBeDefined();
    const parsed = parseTenantJson(exportTenantJson(DEFAULT_CONFIG));
    expect(parsed.errors).toEqual([]);
    expect(parsed.value).toEqual(DEFAULT_CONFIG);
  });

  it("rejects invalid sales settings with located messages", () => {
    const bad = structuredClone(DEFAULT_CONFIG);
    bad.sales.brands = bad.sales.brands.map((b) => ({ ...b, own: true }));
    bad.sales.workflow.numbering.order = "BC-{CENTRE}";
    bad.sales.priceLists[0].lines[0].price = 12.5;
    bad.sales.permissions["day.close"] = ["inconnu"];
    bad.sales.categories[0].defaults.priceListId = "absent";
    const parsed = parseTenantJson(exportTenantJson(bad));
    expect(parsed.value).toBeNull();
    const text = parsed.errors.join("\n");
    expect(text).toMatch(/exactement une marque/);
    expect(text).toMatch(/compteur \{N\}/);
    expect(text).toMatch(/price/);
    expect(text).toMatch(/rôle « inconnu »/);
    expect(text).toMatch(/tarif « absent »/);
  });

  it("restores sales defaults when only the stored sales part is broken", () => {
    const cfg = { ...DEFAULT_CONFIG, sales: { ...DEFAULT_CONFIG.sales, brands: "x" } };
    const m = migrateStoredConfig(JSON.stringify({ version: 3, config: cfg }));
    expect(m.config.branding).toEqual(DEFAULT_CONFIG.branding);
    expect(m.config.sales.brands.length).toBeGreaterThan(1);
    expect(m.notice).toMatch(/vente/);
  });

  it("a configuration saved before a step or permission existed loads with their defaults", () => {
    const old = structuredClone(DEFAULT_CONFIG) as unknown as { sales: { workflow: { steps: Record<string, boolean> }; permissions: Record<string, string[]> } };
    delete old.sales.workflow.steps.fillConfirmation;
    delete old.sales.permissions["order.fill"];
    const m = migrateStoredConfig(JSON.stringify({ version: 3, config: old }));
    expect(m.notice).toBeNull();
    expect(m.config.sales.workflow.steps.fillConfirmation).toBe(true);
    expect(m.config.sales.permissions["order.fill"]).toEqual(["production", "direction"]);
  });

  it("presets switch the optional steps in one go", () => {
    const simple = PRESETS.find((p) => p.id === "simple")!.steps;
    expect(Object.entries(simple).filter(([, on]) => on).map(([k]) => k)).toEqual(["creditCheck"]);
    expect(Object.values(PRESETS.find((p) => p.id === "complet")!.steps).every(Boolean)).toBe(true);
  });
});

describe("sales persistence", () => {
  it("never throws, and drops malformed items one by one", () => {
    for (const raw of ["{", "null", "42", "[]", '{"version":1}', '{"version":9,"overlay":{}}', '{"version":1,"overlay":{"orders":7}}']) {
      expect(() => loadOverlay(raw)).not.toThrow();
    }
    expect(loadOverlay(null)).toEqual({ overlay: {}, notice: null });
    const good = { id: "x", customerId: "c", ts: "2026-10-12T10:00:00.000Z", kind: "CALL", outcome: "JOINT", by: "t", promised: null, note: "" };
    const r = loadOverlay(JSON.stringify({ version: 1, overlay: { calls: { x: good, y: { id: "y" } } } }));
    expect(Object.keys(r.overlay.calls ?? {})).toEqual(["x"]);
    expect(r.notice).toMatch(/1 élément/);
  });

  it("an overlay replaces seed items by id and appends new ones", () => {
    const o = (id: string, status: Order["status"]): Order => ({
      id,
      number: id,
      centreId: "ruf",
      customerId: "c",
      contractVersion: 1,
      workflowVersion: 1,
      mode: "ENLEVEMENT",
      date: "2026-10-12",
      createdAt: "2026-10-12T08:00:00.000Z",
      createdBy: "t",
      lines: [],
      status,
      approval: { required: false, reasons: [], by: null, at: null, note: null },
      reliquats: [],
      filled: {},
      history: [],
      replaces: null,
      replacedBy: null,
      exported: false,
    });
    const seed = { ...emptyData(), orders: [o("a", "BROUILLON"), o("b", "BROUILLON")] };
    const overlay = addToOverlay({}, { orders: [o("b", "CONFIRMEE"), o("c", "BROUILLON")] });
    const merged = mergeOverlay(seed, overlay);
    expect(merged.orders.map((o) => `${o.id}:${o.status}`)).toEqual(["a:BROUILLON", "b:CONFIRMEE", "c:BROUILLON"]);
    expect(loadOverlay(storedOverlay(overlay)).overlay).toEqual(overlay);
  });
});

describe("sales demo data", () => {
  const today = new Date(2026, 9, 12);
  const invs = generateInventories(DEFAULT_CONFIG, today);
  const data = generateSales(DEFAULT_CONFIG, invs, today);
  const T = ymd(today);
  const own = ownBrand(DEFAULT_CONFIG.sales.brands);
  const ledger = [...openingMovements(DEFAULT_CONFIG, own, ledgerStart(T)), ...productionMovements(invs, own, ledgerStart(T)), ...data.movements];

  it("is deterministic for a given day and uses fictional names only", () => {
    expect(generateSales(DEFAULT_CONFIG, invs, today)).toEqual(data);
    expect(data.customers).toHaveLength(12);
    expect(data.customers.filter((c) => c.categoryId === "grossiste")).toHaveLength(4);
    const terms = new Set(data.contracts.map((k) => (k.terms.payment.kind === "COMPTANT" ? 0 : k.terms.payment.days)));
    for (const t of [0, 30, 60, 90]) expect(terms.has(t)).toBe(true);
  });

  it("dispatched fulls track production, and stock never goes negative", () => {
    const produced = productionMovements(invs, own, ledgerStart(T)).filter((m) => m.state === "PLEIN").reduce((a, m) => a + m.qty, 0);
    const out = data.movements.filter((m) => m.site.startsWith("centre:") && m.state === "PLEIN" && m.qty < 0).reduce((a, m) => a - m.qty, 0);
    expect(out / produced).toBeGreaterThan(0.9);
    expect(out / produced).toBeLessThan(1.1);
    for (const c of DEFAULT_CONFIG.centres)
      for (let k = 0; k <= 60; k += 3) {
        const until = new Date(2026, 9, 12 - k, 23).toISOString();
        const b = siteBalance(ledger, centreSite(c.id), { until });
        for (const n of Object.values(b.PLEIN[own] ?? {})) expect(n).toBeGreaterThanOrEqual(0);
        for (const n of Object.values(b.VIDE[own] ?? {})) expect(n).toBeGreaterThanOrEqual(0);
      }
  });

  it("contains the deliberate imperfect cases", () => {
    expect(data.orders.some((o) => o.status === "BROUILLON")).toBe(true); // blocked on credit
    expect(data.orders.some((o) => o.approval.required && !o.approval.by)).toBe(true);
    expect(data.orders.some((o) => o.reliquats.some((r) => r.reason === "CAMION"))).toBe(true);
    const partial = data.orders.find((o) => o.status === "EXPEDIEE");
    expect(partial).toBeDefined();
    const sent = dispatchedQty(data.dispatches, partial!.id);
    expect(partial!.lines.some((l) => (sent[l.formatId] ?? 0) < l.qty)).toBe(true);
    expect(data.counts.some((c) => c.status === "A_VALIDER")).toBe(true);
    expect(data.calls.length).toBeGreaterThan(0);
    // One centre left yesterday's working day open.
    expect(data.closes.filter((c) => c.centreId === "kao").length).toBeLessThan(data.closes.filter((c) => c.centreId === "ruf").length);
  });

  it("frozen day-close rows equal the report recomputed from the ledger", () => {
    const close = data.closes[data.closes.length - 1];
    expect(close.rows).toEqual(reportRows(ledger, close.centreId, close.date, DEFAULT_CONFIG.sales.brands, DEFAULT_CONFIG.bottleTypes.map((b) => b.id)));
    for (const r of close.rows) expect(r.closing).toBe(r.fulls + r.empties + r.damaged);
  });
});
