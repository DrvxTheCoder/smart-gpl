import { dayOf } from "./dates";
import { UNKNOWN_BRAND, type BottleMovement, type BottleState, type Brand, type BrandGrid, type MovementKind, type SiteId } from "./types";

/* ------------------------------------------------------------------
   Bottle ledger. Append-only signed movements by site × state × brand ×
   format; every balance is a sum, never a stored figure. A correction is
   a reversing movement carrying a reason, so history stays readable.
   ------------------------------------------------------------------ */

export const centreSite = (id: string): SiteId => `centre:${id}`;
export const clientSite = (id: string): SiteId => `client:${id}`;

export const ownBrand = (brands: Brand[]) => brands.find((b) => b.own)?.id ?? brands[0]?.id ?? "";

/** Only the tenant's own empties can be filled. Unknown brands never are. */
export const isFillable = (brand: string, brands: Brand[]) => brand !== UNKNOWN_BRAND && brand === ownBrand(brands);

export interface LedgerFilter {
  site?: SiteId;
  before?: string; // ISO, exclusive
  until?: string; // ISO, inclusive
}

const keep = (m: BottleMovement, f: LedgerFilter) => (!f.site || m.site === f.site) && (!f.before || m.ts < f.before) && (!f.until || m.ts <= f.until);

/** Balance of one site per state, brand and format. */
export type SiteBalance = Record<BottleState, BrandGrid>;

export function siteBalance(movements: BottleMovement[], site: SiteId, f: Omit<LedgerFilter, "site"> = {}): SiteBalance {
  const out: SiteBalance = { PLEIN: {}, VIDE: {}, CASSE: {} };
  for (const m of movements) {
    if (!keep(m, { ...f, site })) continue;
    const row = (out[m.state][m.brand] ??= {});
    row[m.formatId] = (row[m.formatId] ?? 0) + m.qty;
  }
  return out;
}

export const cell = (g: BrandGrid, brand: string, formatId: string) => g[brand]?.[formatId] ?? 0;

/** Total of a grid per format, whatever the brand. */
export function byFormat(g: BrandGrid): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of Object.values(g)) for (const [f, n] of Object.entries(row)) out[f] = (out[f] ?? 0) + n;
  return out;
}

export const gridTotal = (g: BrandGrid) => Object.values(byFormat(g)).reduce((a, b) => a + b, 0);

/** Splits empties into the four buckets the floor works with. */
export function emptiesBuckets(bal: SiteBalance, brands: Brand[]) {
  const own = ownBrand(brands);
  const ownEmpties: Record<string, number> = { ...(bal.VIDE[own] ?? {}) };
  const competitor: BrandGrid = {};
  for (const [b, row] of Object.entries(bal.VIDE)) if (b !== own) competitor[b] = { ...row };
  return { ownFulls: { ...(bal.PLEIN[own] ?? {}) }, ownEmpties, competitor, damaged: byFormat(bal.CASSE) };
}

/** A movement cancelled by its mirror image; the reason is mandatory. */
export function reverse(m: BottleMovement, opts: { ts: string; by: string; reason: string }): BottleMovement {
  return { ...m, id: `${m.id}:rev`, ts: opts.ts, qty: -m.qty, by: opts.by, reason: opts.reason, reverses: m.id, confirmedBy: undefined };
}

/** Movements not cancelled by a later reversal, reversals excluded. */
export function effective(movements: BottleMovement[]): BottleMovement[] {
  const reversed = new Set(movements.filter((m) => m.reverses).map((m) => m.reverses));
  return movements.filter((m) => !m.reverses && !reversed.has(m.id));
}

/**
 * What a customer holds of ours, from the centre side of the ledger: fulls it
 * received minus empties it brought back. By format (bottles are fungible) or
 * by brand × format. Negative means it returned more than it took.
 */
export function customerBottleBalance(movements: BottleMovement[], customerId: string, basis: "FORMAT" | "BRAND"): BrandGrid {
  const g: BrandGrid = {};
  for (const m of movements) {
    if (m.refs.customerId !== customerId || !m.site.startsWith("centre:") || !CUSTODY.has(m.kind)) continue;
    // What leaves the centre with the customer counts for it, what comes back against it.
    const row = (g[basis === "FORMAT" ? ANY_BRAND : m.brand] ??= {});
    row[m.formatId] = (row[m.formatId] ?? 0) - m.qty;
  }
  return g;
}

/** Row key of a by-format balance. */
export const ANY_BRAND = "*";
const CUSTODY = new Set<MovementKind>(["PLEINS_SORTIE", "PLACEMENT", "VIDES_ENTREE", "RETOUR_PLEINS"]);

/** Movements of a site on a day, for the gate log and the day close. */
export const movementsOn = (movements: BottleMovement[], site: SiteId, date: string) => movements.filter((m) => m.site === site && dayOf(m.ts) === date);

export const MOVEMENT_LABEL: Record<MovementKind, string> = {
  OUVERTURE: "Ouverture",
  PRODUCTION: "Production",
  VIDES_ENTREE: "Vides reçues",
  PLEINS_SORTIE: "Pleins sortis",
  PLACEMENT: "Mise en consignation",
  VENTE_CONSIGNATION: "Vente grossiste",
  RETOUR_PLEINS: "Retour de pleins",
  CASSE: "Casse",
  ECHANGE: "Échange inter-marques",
  AJUSTEMENT: "Ajustement",
};

/**
 * Turns a counted grid into the signed movements that bring the ledger to it,
 * one per brand × format that differs. Used once a count is validated.
 */
export function adjustmentsFor(opts: {
  site: SiteId;
  state: BottleState;
  counted: BrandGrid;
  expected: BrandGrid;
  ts: string;
  by: string;
  reason: string;
  countId: string;
}): BottleMovement[] {
  const out: BottleMovement[] = [];
  const brands = new Set([...Object.keys(opts.counted), ...Object.keys(opts.expected)]);
  for (const b of brands) {
    const formats = new Set([...Object.keys(opts.counted[b] ?? {}), ...Object.keys(opts.expected[b] ?? {})]);
    for (const f of formats) {
      const d = cell(opts.counted, b, f) - cell(opts.expected, b, f);
      if (!d) continue;
      out.push({
        id: `${opts.countId}:adj:${b}:${f}`,
        ts: opts.ts,
        site: opts.site,
        state: opts.state,
        brand: b,
        formatId: f,
        kind: "AJUSTEMENT",
        qty: d,
        refs: { countId: opts.countId, customerId: opts.site.startsWith("client:") ? opts.site.slice(7) : undefined },
        by: opts.by,
        reason: opts.reason,
      });
    }
  }
  return out;
}
