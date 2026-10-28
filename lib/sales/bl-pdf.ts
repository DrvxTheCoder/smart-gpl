import { fmt, fmtDate } from "../format";
import { pdfDocument, type PdfPage, type PdfText, type Rgb } from "../pdf";
import type { OnProgress, ReportFile } from "../year-report";
import type { TenantConfig } from "../types";
import { dayOf } from "./dates";
import { BULK, UNKNOWN_BRAND, type Customer, type Dispatch, type Order } from "./types";

/* The digital delivery note as a PDF, in the tenant's colours. It is an
   internal document: invoicing stays in Sage until compliance is validated. */

export const BL_MARK = "Document interne : facturation dans Sage";

const A4 = { width: 595, height: 842 };
const M = 40;
const INK: Rgb = [20, 28, 23];
const MUTED: Rgb = [104, 114, 108];
const LINE: Rgb = [226, 230, 227];
const ZEBRA: Rgb = [245, 247, 245];

function hexRgb(hex: string): Rgb {
  const h = hex.replace("#", "").padEnd(6, "0");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0) as Rgb;
}

export async function buildBl(o: { cfg: TenantConfig; dispatch: Dispatch; order: Order; customer: Customer | undefined; product: string; onProgress: OnProgress }): Promise<ReportFile> {
  const { cfg, dispatch: d, order, customer } = o;
  o.onProgress(0.2);
  const brand = hexRgb(cfg.branding.brand).map((v) => Math.round(v * 0.55)) as Rgb;
  const label = (f: string) => (f === BULK ? "Vrac (kg)" : cfg.bottleTypes.find((b) => b.id === f)?.label ?? f);
  const brandName = (b: string) => (b === UNKNOWN_BRAND ? "Marque non identifiée" : cfg.sales.brands.find((x) => x.id === b)?.name ?? b);
  const centre = cfg.centres.find((c) => c.id === d.centreId);
  const texts: PdfText[] = [];
  const rects: PdfPage["rects"] = [{ x: 0, y: 0, w: A4.width, h: 96, color: brand }];
  const t = (x: number, y: number, text: string, extra: Partial<PdfText> = {}) => texts.push({ x, y, text, size: 9.5, color: INK, ...extra });

  t(M, 40, cfg.branding.companyName, { size: 16, weight: "bold", color: [255, 255, 255] });
  t(M, 62, `Bon de livraison numérique · ${centre?.name ?? ""}`, { size: 10, color: [214, 226, 219] });
  t(A4.width - M, 40, d.number, { size: 14, weight: "bold", color: [255, 255, 255], align: "right" });
  t(A4.width - M, 62, fmtDate(dayOf(d.slot)), { size: 10, color: [214, 226, 219], align: "right" });

  rects.push({ x: M, y: 112, w: A4.width - 2 * M, h: 24, color: [253, 243, 222] });
  t(M + 10, 128, BL_MARK, { weight: "bold", color: [122, 83, 6] });

  const block = (x: number, title: string, lines: string[]) => {
    t(x, 162, title, { size: 8.5, weight: "bold", color: MUTED });
    lines.forEach((l, i) => t(x, 178 + i * 14, l));
  };
  block(M, "CLIENT", [customer?.name ?? "", `${customer?.code ?? ""} · ${customer?.zone ?? ""}`, customer?.contact.phone ?? ""]);
  block(225, "COMMANDE", [order.number, `${order.mode === "LIVRAISON" ? "Livraison" : "Enlèvement"} · ${fmtDate(order.date, { day: "numeric", month: "short" })}`]);
  block(400, "CAMION", [d.truck, d.driver || "—", new Date(d.slot).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })]);
  o.onProgress(0.5);

  let y = 240;
  const table = (title: string, head: string[], rows: string[][], widths: number[]) => {
    t(M, y, title, { size: 10.5, weight: "bold" });
    y += 10;
    rects.push({ x: M, y, w: A4.width - 2 * M, h: 20, color: ZEBRA });
    let x = M;
    head.forEach((h, i) => {
      t(i ? x + widths[i] - 8 : x + 8, y + 13.5, h, { size: 8.5, weight: "bold", color: MUTED, align: i ? "right" : "left" });
      x += widths[i];
    });
    y += 20;
    for (const r of rows) {
      x = M;
      r.forEach((c, i) => {
        t(i ? x + widths[i] - 8 : x + 8, y + 14, c, { align: i ? "right" : "left", weight: i === 0 ? "bold" : undefined });
        x += widths[i];
      });
      rects.push({ x: M, y: y + 20, w: A4.width - 2 * M, h: 0.6, color: LINE });
      y += 21;
    }
    y += 22;
  };

  const ordered = Object.fromEntries(order.lines.map((l) => [l.formatId, l.qty]));
  table(
    "Chargement",
    ["Format", "Commandé", "Chargé"],
    Object.entries(d.loaded)
      .filter(([, n]) => n > 0)
      .map(([f, n]) => [label(f), fmt(ordered[f] ?? 0), fmt(n)]),
    [235, 140, 140],
  );
  if (d.weighing) table("Pesées", ["Pesée", "Kg"], [["Tare", fmt(d.weighing.tareKg)], ["En charge", fmt(d.weighing.grossKg)], ["Net", fmt(d.weighing.grossKg - d.weighing.tareKg)]], [375, 140]);
  const empties = Object.entries(d.empties).filter(([, row]) => Object.values(row).some((n) => n > 0));
  if (empties.length) {
    const formats = cfg.bottleTypes.filter((b) => empties.some(([, row]) => (row[b.id] ?? 0) > 0));
    const w = Math.floor(335 / Math.max(formats.length, 1));
    table("Vides reçues", ["Marque", ...formats.map((b) => b.label)], empties.map(([b, row]) => [brandName(b), ...formats.map((f) => fmt(row[f.id] ?? 0))]), [180, ...formats.map(() => w)]);
  }
  o.onProgress(0.8);

  t(M, y, "Confirmations", { size: 10.5, weight: "bold" });
  y += 18;
  const confs = [...d.gateIn.map((c) => ["Entrée", c] as const), ...d.loading.map((c) => ["Chargement", c] as const), ...d.delivery.map((c) => ["Livraison", c] as const)];
  if (!confs.length) t(M, y, "Aucune confirmation enregistrée.", { color: MUTED });
  for (const [step, c] of confs) {
    t(M, y, `${step} · ${c.role} : ${c.name}`);
    t(A4.width - M, y, new Date(c.at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), { align: "right", color: MUTED });
    y += 15;
  }
  t(M, A4.height - 24, `${BL_MARK} · Propulsé par ${o.product}`, { size: 8, color: MUTED });
  const blob = await pdfDocument([{ texts, rects }], A4);
  o.onProgress(1);
  return { blob, filename: `${d.number}.pdf` };
}
