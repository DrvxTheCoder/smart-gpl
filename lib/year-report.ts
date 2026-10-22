import { aggregate, type Aggregate } from "./aggregate";
import { ICON_PATHS, LOCKUP } from "./brand";
import { cap, fmt, fmtDuration } from "./format";
import { A4_LANDSCAPE, pdfDocument, type PdfPage, type Rgb } from "./pdf";
import type { Centre, Inventory, TenantConfig } from "./types";

/** Reports progress in [0, 1]; a background job turns it into the hub's ring. */
export type OnProgress = (p: number) => void;

export interface ReportFile {
  blob: Blob;
  filename: string;
}

// The aggregation itself takes milliseconds on demo data. Each step is paced
// so progress stays readable in the hub; drop this once a server builds it.
const STEP_MS = 550;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MONTH = (m: number) => cap(new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(new Date(2026, m, 1)));

interface Row {
  label: string;
  a: Aggregate;
}

/**
 * Yearly report, every centre: one row per month, a total for the year,
 * then one row per centre. Built month by month so progress is real.
 */
export async function buildYearReport(opts: {
  inventories: Inventory[];
  config: TenantConfig;
  year: number;
  today?: Date;
  onProgress: OnProgress;
}): Promise<ReportFile> {
  const { inventories, config, year, onProgress } = opts;
  const today = opts.today ?? new Date();
  const centreOf = (id: string): Centre => config.centres.find((c) => c.id === id) ?? config.centres[0];
  const inYear = inventories.filter((i) => i.date.startsWith(`${year}-`));
  const lastMonth = year === today.getFullYear() ? today.getMonth() : 11;
  const steps = lastMonth + 1 + config.centres.length + 1;
  let done = 0;
  const tick = async () => {
    onProgress(++done / steps);
    await wait(STEP_MS);
  };

  onProgress(0);
  const months: Row[] = [];
  for (let m = 0; m <= lastMonth; m++) {
    const prefix = `${year}-${String(m + 1).padStart(2, "0")}-`;
    months.push({ label: MONTH(m), a: aggregate(inYear.filter((i) => i.date.startsWith(prefix)), config, centreOf) });
    await tick();
  }
  const total = aggregate(inYear, config, centreOf);

  const centres: Row[] = [];
  for (const c of config.centres) {
    centres.push({ label: c.name, a: aggregate(inYear.filter((i) => i.centreId === c.id), config, centreOf) });
    await tick();
  }

  const blob = await pdfDocument(layout({ config, year, months, total, centres }));
  onProgress(1);
  return { blob, filename: `rapport-annuel-${year}.pdf` };
}

/* ---------- Layout ---------- */

const INK: Rgb = [20, 28, 23];
const MUTED: Rgb = [120, 126, 122];
const LINE: Rgb = [226, 230, 227];
const FOOT: Rgb = [243, 245, 243];
const WHITE: Rgb = [255, 255, 255];
const SIGN: Rgb = [178, 180, 180];

function hexRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0) as Rgb;
}

const darken = (c: Rgb, k: number): Rgb => c.map((v) => Math.round(v * k)) as Rgb;
const mix = (a: Rgb, b: Rgb, k: number): Rgb => a.map((v, i) => Math.round(v * (1 - k) + b[i] * k)) as Rgb;

interface Col {
  label: string;
  w: number;
  cell: (r: Row) => string;
  left?: boolean;
}

const dash = (a: Aggregate, s: string) => (a.days ? s : "–");

const MONTH_COLS: Col[] = [
  { label: "Mois", w: 104, left: true, cell: (r) => r.label },
  { label: "Journées", w: 50, cell: (r) => dash(r.a, String(r.a.days)) },
  { label: "Conditionné (T)", w: 80, cell: (r) => dash(r.a, fmt(r.a.conditionneT, 1)) },
  { label: "Vrac (T)", w: 56, cell: (r) => dash(r.a, fmt(r.a.vracT, 1)) },
  { label: "Appro (T)", w: 58, cell: (r) => dash(r.a, fmt(r.a.approT, 1)) },
  { label: "Bouteilles", w: 62, cell: (r) => dash(r.a, fmt(r.a.bottlesN)) },
  { label: "Temps utile", w: 64, cell: (r) => dash(r.a, fmtDuration(r.a.utileMin)) },
  { label: "Arrêts", w: 54, cell: (r) => dash(r.a, fmtDuration(r.a.stopMin)) },
  { label: "Rendement (T/h)", w: 82, cell: (r) => dash(r.a, fmt(r.a.rendementTph, 2)) },
  // Conditionné against the installed capacity of the lines over their temps utile.
  { label: "Rendement (%)", w: 78, cell: (r) => dash(r.a, fmt(r.a.capacityPct, 1)) },
  { label: "Écart moyen (%)", w: 82, cell: (r) => dash(r.a, fmt(r.a.meanAbsEcart, 2)) },
];

const CENTRE_COLS: Col[] = [{ ...MONTH_COLS[0], label: "Centre" }, ...MONTH_COLS.slice(1)];

const M = 34; // page margin, header text
const BAND_H = 88;
const BODY_X = 36; // rows sit 8pt inside the header bar
const PAD = 8;
const HEAD_H = 24.5;
const ROW_H = 22;

function table(t: PdfPage, top: number, cols: Col[], rows: Row[], foot: Row, headColor: Rgb) {
  let x = BODY_X;
  const xs = cols.map((c) => {
    const at = x;
    x += c.w;
    return at;
  });
  const width = x - BODY_X;
  const cellX = (i: number) => (cols[i].left ? xs[i] + PAD : xs[i] + cols[i].w - PAD);
  const align = (i: number) => (cols[i].left ? "left" : "right") as "left" | "right";

  t.rects!.push({ x: BODY_X - 8, y: top, w: width + 16, h: HEAD_H, r: 7, color: headColor });
  cols.forEach((c, i) => t.texts.push({ x: cellX(i), y: top + 15.3, text: c.label, size: 8.5, weight: "bold", color: WHITE, align: align(i) }));

  let y = top + HEAD_H + 8;
  rows.forEach((r, ri) => {
    if (ri < rows.length - 1) t.rects!.push({ x: BODY_X, y: y + ROW_H - 0.6, w: width, h: 0.6, color: LINE });
    cols.forEach((c, i) =>
      t.texts.push({ x: cellX(i), y: y + 14.5, text: c.cell(r), size: 9.5, weight: i === 0 ? "bold" : "regular", color: r.a.days ? INK : MUTED, align: align(i) }),
    );
    y += ROW_H;
  });
  t.rects!.push({ x: BODY_X, y, w: width, h: ROW_H, color: FOOT });
  cols.forEach((c, i) => t.texts.push({ x: cellX(i), y: y + 14.5, text: c.cell(foot), size: 9.5, weight: "bold", color: INK, align: align(i) }));
}

/** "propulsé par" over the Smart GPL lockup, centred at the foot of the page. */
function signature(t: PdfPage) {
  const { width, height } = A4_LANDSCAPE;
  const s = 16 / LOCKUP.height;
  const x = width / 2 - (LOCKUP.width * s) / 2;
  const top = height - 38;
  t.texts.push({ x: width / 2, y: top - 4.5, text: "propulsé par", size: 5.5, weight: "bold", color: SIGN, align: "center" });
  for (const d of ICON_PATHS) t.paths!.push({ d, x, y: top, scale: s, color: SIGN });
  for (const w of [LOCKUP.word, LOCKUP.tm]) t.texts.push({ x: x + w.x * s, y: top + w.y * s, text: w.text, size: w.size * s, weight: "extrabold", color: SIGN });
}

function layout(d: { config: TenantConfig; year: number; months: Row[]; total: Aggregate; centres: Row[] }): PdfPage[] {
  const { width } = A4_LANDSCAPE;
  const band = darken(hexRgb(d.config.branding.brand), 0.55);
  const headColor = mix(band, [165, 170, 168], 0.75);
  const company = d.config.branding.companyName;

  const page = (): PdfPage => {
    const p: PdfPage = {
      rects: [{ x: 0, y: 0, w: width, h: BAND_H, color: band }],
      paths: [],
      texts: [
        { x: M, y: 42.5, text: `Rapport Annuel ${d.year}`, size: 20, weight: "bold", color: WHITE },
        { x: M + 1, y: 58.5, text: `${company}  |  Tous les centres`, size: 9, color: [214, 226, 223] },
        { x: width - M, y: 50, text: company, size: 18, weight: "extrabold", color: WHITE, align: "right" },
      ],
    };
    signature(p);
    return p;
  };

  const p1 = page();
  table(p1, 119, MONTH_COLS, d.months, { label: "Année", a: d.total }, headColor);
  const p2 = page();
  table(p2, 119, CENTRE_COLS, d.centres, { label: "Tous centres", a: d.total }, headColor);
  return [p1, p2];
}
