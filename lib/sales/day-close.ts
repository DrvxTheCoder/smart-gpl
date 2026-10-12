import { centreSite } from "./bottle-ledger";
import { at, dayOf, shiftDate } from "./dates";
import { UNKNOWN_BRAND, type BottleMovement, type Brand, type DayClose, type ReportRow, type ReportTemplate } from "./types";

/* ------------------------------------------------------------------
   Day-end close and the authority report. The report is read from the
   ledger: per brand × format, physical bottles at the centre (fulls,
   empties and condemned together). Filling turns an empty into a full
   inside the site, so production is neither an entry nor an exit.
   ------------------------------------------------------------------ */

const key = (brand: string, f: string) => `${brand}|${f}`;

export function reportRows(movements: BottleMovement[], centreId: string, date: string, brands: Brand[], formatIds: string[]): ReportRow[] {
  const site = centreSite(centreId);
  const start = at(date, 0);
  const end = at(shiftDate(date, 1), 0);
  const rows = new Map<string, ReportRow>();
  const row = (brand: string, f: string) => {
    let r = rows.get(key(brand, f));
    if (!r) rows.set(key(brand, f), (r = { brand, formatId: f, opening: 0, in: 0, out: 0, closing: 0, fulls: 0, empties: 0, damaged: 0 }));
    return r;
  };
  for (const m of movements) {
    if (m.site !== site || m.ts >= end) continue;
    const r = row(m.brand, m.formatId);
    if (m.ts < start) r.opening += m.qty;
    else if (m.kind !== "PRODUCTION") {
      if (m.qty > 0) r.in += m.qty;
      else r.out -= m.qty;
    }
    if (m.state === "PLEIN") r.fulls += m.qty;
    else if (m.state === "VIDE") r.empties += m.qty;
    else r.damaged += m.qty;
  }
  const brandOrder = [...brands.map((b) => b.id), UNKNOWN_BRAND];
  return [...rows.values()]
    .map((r) => ({ ...r, closing: r.opening + r.in - r.out }))
    .filter((r) => r.opening || r.in || r.out || r.closing)
    .sort((a, b) => brandOrder.indexOf(a.brand) - brandOrder.indexOf(b.brand) || formatIds.indexOf(a.formatId) - formatIds.indexOf(b.formatId));
}

export const closeId = (centreId: string, date: string) => `${centreId}_${date}`;

export const isClosed = (closes: DayClose[], centreId: string, date: string) => closes.some((c) => c.centreId === centreId && c.date === date);

/** Movements dated on a closed day are frozen: later corrections are dated adjustments. */
export const isMovementLocked = (closes: DayClose[], m: BottleMovement) => m.site.startsWith("centre:") && isClosed(closes, m.site.slice(7), dayOf(m.ts));

/** Past working days (Monday to Saturday) since `from` that nobody closed. */
export function unclosedDays(closes: DayClose[], centreId: string, from: string, today: string): string[] {
  const out: string[] = [];
  for (let d = from; d < today; d = shiftDate(d, 1)) {
    const [y, m, dd] = d.split("-").map(Number);
    if (new Date(y, m - 1, dd).getDay() === 0) continue;
    if (!isClosed(closes, centreId, d)) out.push(d);
  }
  return out;
}

/* ---------------- template export ---------------- */

export const AUTHORITY_COLUMNS: Record<string, { label: string; value: (r: ReportRow, ctx: { brand: (id: string) => string; format: (id: string) => string }) => string | number }> = {
  marque: { label: "Marque", value: (r, c) => c.brand(r.brand) },
  format: { label: "Format", value: (r, c) => c.format(r.formatId) },
  ouverture: { label: "Stock d'ouverture", value: (r) => r.opening },
  entrees: { label: "Entrées", value: (r) => r.in },
  sorties: { label: "Sorties", value: (r) => r.out },
  cloture: { label: "Stock de clôture", value: (r) => r.closing },
  pleins: { label: "Dont pleins", value: (r) => r.fulls },
  vides: { label: "Dont vides", value: (r) => r.empties },
  casse: { label: "Dont réformées", value: (r) => r.damaged },
};

/** File name from a template pattern: {CENTRE}, {DATE}, {AAAA}, {MM}, {JJ}. */
export function fileName(pattern: string, centre: string, date: string) {
  const [y, m, d] = date.split("-");
  return pattern.replace(/\{CENTRE\}/g, centre).replace(/\{DATE\}/g, date).replace(/\{AAAA\}/g, y).replace(/\{MM\}/g, m).replace(/\{JJ\}/g, d);
}

const cellText = (v: string | number, sep: string) => {
  const s = String(v);
  return s.includes(sep) || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of any rows through a template: optional header line, column labels, then rows. Unknown columns stay empty. */
export function templateCsv<R, C>(rows: R[], t: ReportTemplate, columns: Record<string, { label: string; value: (r: R, ctx: C) => string | number }>, ctx: C): string {
  const sep = t.separator || ";";
  const lines: string[] = [];
  if (t.header) lines.push(cellText(t.header, sep));
  lines.push(t.columns.map((k) => cellText(columns[k]?.label ?? k, sep)).join(sep));
  for (const r of rows) lines.push(t.columns.map((k) => cellText(columns[k] ? columns[k].value(r, ctx) : "", sep)).join(sep));
  // BOM so spreadsheet software reads the accents right.
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** The authority daily report as a CSV file, through the tenant's template. */
export function authorityCsv(o: { rows: ReportRow[]; template: ReportTemplate; centre: string; date: string; brand: (id: string) => string; format: (id: string) => string }): { blob: Blob; filename: string } {
  // Until the official format is supplied, every file says it is provisional.
  const template = o.template.placeholder ? { ...o.template, header: `MODÈLE PROVISOIRE. ${o.template.header}`.trim() } : o.template;
  const text = templateCsv(o.rows, template, AUTHORITY_COLUMNS, { brand: o.brand, format: o.format });
  return { blob: new Blob([text], { type: "text/csv;charset=utf-8" }), filename: fileName(o.template.filename, o.centre, o.date) };
}
