import type { Money, OrderLine, PriceList } from "./types";

/**
 * Unit price of a format on a date: the latest line of the list effective on
 * or before that date. Null when the list has no price for the format yet.
 */
export function priceFor(lists: PriceList[], listId: string, formatId: string, date: string): Money | null {
  const list = lists.find((l) => l.id === listId);
  if (!list) return null;
  let best: { from: string; price: Money } | null = null;
  for (const l of list.lines) if (l.formatId === formatId && l.from <= date && (!best || l.from > best.from)) best = l;
  return best ? best.price : null;
}

/** Formats a list can price on a date, in the order given. */
export function pricedFormats(lists: PriceList[], listId: string, formatIds: string[], date: string): string[] {
  return formatIds.filter((f) => priceFor(lists, listId, f, date) != null);
}

/** Integer amount of a line: whole quantities times whole prices. */
export const lineAmount = (l: Pick<OrderLine, "qty" | "price">): Money => Math.round(l.qty) * Math.round(l.price);

export const linesAmount = (lines: Pick<OrderLine, "qty" | "price">[]): Money => lines.reduce((a, l) => a + lineAmount(l), 0);

/** Amount of quantities per format at given unit prices (formats without a price count zero). */
export function valueOf(qty: Record<string, number>, price: (formatId: string) => Money | null): Money {
  let total = 0;
  for (const [f, q] of Object.entries(qty)) total += Math.round(q) * (price(f) ?? 0);
  return total;
}
