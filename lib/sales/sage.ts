import { dayOf } from "./dates";
import { BULK, type Customer, type Dispatch, type Money, type Order, type Settlement } from "./types";

/* ------------------------------------------------------------------
   Validated sales lines for Sage Gestion Commerciale. Invoicing stays
   in Sage: this is a CSV hand-over, with placeholder columns until the
   client's import format is known.
   ------------------------------------------------------------------ */

export interface SaleLine {
  date: string;
  piece: string; // order number, or settlement number for a wholesaler
  bl: string; // dispatch number, empty for a passage
  customer: Customer | undefined;
  formatId: string;
  qty: number;
  price: Money;
  amount: Money;
  centreId: string;
  orderId?: string;
}

/** One line per format of every expedited dispatch and confirmed passage between two days. */
export function saleLines(o: { orders: Order[]; dispatches: Dispatch[]; settlements: Settlement[]; customers: Customer[]; from: string; to: string; centreId: string; consignment: (customerId: string) => boolean; priceOf: (s: Settlement, formatId: string) => Money }): SaleLine[] {
  const byId = new Map(o.orders.map((x) => [x.id, x]));
  const cust = new Map(o.customers.map((c) => [c.id, c]));
  const inScope = (centre: string, d: string) => (o.centreId === "all" || centre === o.centreId) && d >= o.from && d <= o.to;
  const out: SaleLine[] = [];
  for (const d of o.dispatches) {
    if (d.status !== "EXPEDIE" && d.status !== "LIVRE") continue;
    const order = byId.get(d.orderId);
    const day = dayOf(d.slot);
    if (!order || !inScope(d.centreId, day)) continue;
    // Consignment placements are not sales: they are billed when the wholesaler sells.
    if (o.consignment(d.customerId)) continue;
    for (const [f, n] of Object.entries(d.loaded)) {
      if (!n) continue;
      const price = order.lines.find((l) => l.formatId === f)?.price ?? 0;
      out.push({ date: day, piece: order.number, bl: d.number, customer: cust.get(d.customerId), formatId: f, qty: n, price, amount: n * price, centreId: d.centreId, orderId: order.id });
    }
  }
  for (const s of o.settlements) {
    const day = dayOf(s.ts);
    if (s.status !== "CONFIRME" || !inScope(s.centreId, day)) continue;
    for (const [f, n] of Object.entries(s.sold)) {
      if (!n) continue;
      const price = o.priceOf(s, f);
      out.push({ date: day, piece: s.number, bl: "", customer: cust.get(s.customerId), formatId: f, qty: n, price, amount: n * price, centreId: s.centreId });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.piece.localeCompare(b.piece));
}

type Ctx = { format: (id: string) => string; centre: (id: string) => string };

export const SAGE_COLUMNS: Record<string, { label: string; value: (r: SaleLine, c: Ctx) => string | number }> = {
  date: { label: "Date", value: (r) => r.date },
  piece: { label: "Pièce", value: (r) => r.piece },
  bl: { label: "BL", value: (r) => r.bl },
  client_code: { label: "Code client", value: (r) => r.customer?.code ?? "" },
  client: { label: "Client", value: (r) => r.customer?.name ?? "" },
  article: { label: "Article", value: (r, c) => (r.formatId === BULK ? "Vrac (kg)" : c.format(r.formatId)) },
  quantite: { label: "Quantité", value: (r) => r.qty },
  prix_unitaire: { label: "Prix unitaire", value: (r) => r.price },
  montant: { label: "Montant", value: (r) => r.amount },
  centre: { label: "Centre", value: (r, c) => c.centre(r.centreId) },
};
