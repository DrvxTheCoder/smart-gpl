import { DEFAULT_CONFIG, generateInventories } from "../lib/seed";
import { ownBrand } from "../lib/sales/bottle-ledger";
import { applyPatch, type Patch } from "../lib/sales/data";
import { ymd } from "../lib/sales/dates";
import { generateSales } from "../lib/sales/seed";
import { ledgerStart, openingMovements, productionMovements } from "../lib/sales/stock";
import type { CommandResult, Env } from "../lib/sales/store";
import type { Action } from "../lib/sales/types";
import type { TenantConfig } from "../lib/types";

/** A command environment on the demo data for a fixed day, with every permission unless told otherwise. */
export function demoEnv(opts: { cfg?: TenantConfig; can?: (a: Action) => boolean } = {}): Env {
  const cfg = opts.cfg ?? DEFAULT_CONFIG;
  const today = new Date(2026, 9, 12);
  const inventories = generateInventories(cfg, today);
  const data = generateSales(cfg, inventories, today);
  const T = ymd(today);
  const own = ownBrand(cfg.sales.brands);
  const ledger = [...openingMovements(cfg, own, ledgerStart(T)), ...productionMovements(inventories, own, ledgerStart(T)), ...data.movements];
  return { cfg, data, ledger, inventories, own, today: T, now: "2026-10-12T10:00:00.000Z", by: "Test", can: opts.can ?? (() => true) };
}

/** The environment after a successful command, as the provider would commit it. */
export function after(env: Env, r: CommandResult): Env {
  if (!r.ok) throw new Error(r.error);
  return withPatch(env, r.patch);
}

export function withPatch(env: Env, patch: Patch): Env {
  const data = applyPatch(env.data, patch);
  const derived = env.ledger.filter((m) => m.kind === "PRODUCTION" || m.id.startsWith("open:") && m.by === "Configuration");
  return { ...env, data, ledger: [...derived, ...data.movements] };
}
