import { contractAt, isWholesaler } from "../contracts";
import { saleLines, type SaleLine } from "../sage";
import type { CommandResult, Env } from "../store";
import type { Order } from "../types";
import { consignmentPrice } from "./consignment";

/** Validated sales lines between two days, as Sage will receive them. */
export function salesToExport(env: Env, o: { from: string; to: string; centreId: string }): SaleLine[] {
  return saleLines({
    orders: env.data.orders.filter((x) => x.status !== "ANNULEE"),
    dispatches: env.data.dispatches,
    settlements: env.data.settlements,
    customers: env.data.customers,
    from: o.from,
    to: o.to,
    centreId: o.centreId,
    consignment: (id) => {
      const c = env.data.customers.find((x) => x.id === id);
      return !!c && isWholesaler(env.cfg.sales, c);
    },
    priceOf: (s, f) => (contractAt(env.data.contracts, s.customerId, s.ts.slice(0, 10)) ? consignmentPrice(env, s.customerId, f, s.ts.slice(0, 10)) : 0),
  });
}

/** Marks the orders of exported lines, so they can be closed when the export step is on. */
export function markExported(env: Env, lines: SaleLine[]): CommandResult {
  const ids = new Set(lines.map((l) => l.orderId).filter((x): x is string => !!x));
  const orders: Order[] = env.data.orders
    .filter((o) => ids.has(o.id) && !o.exported)
    .map((o) => ({ ...o, exported: true, history: [...o.history, { at: env.now, by: env.by, label: "Exportée vers Sage" }] }));
  if (!lines.length) return { ok: false, error: "Rien à exporter : aucune vente expédiée sur la période." };
  return { ok: true, patch: { orders }, msg: "" };
}
