/**
 * Minimal PDF writer: text, filled rectangles and SVG paths on A4 pages, set in
 * Plus Jakarta Sans (embedded from /public/fonts). Enough for tabular reports.
 * Coordinates are in points from the top-left corner.
 */

export type Rgb = [number, number, number];

export type Weight = "regular" | "bold" | "extrabold";

export interface PdfText {
  x: number;
  y: number; // baseline
  text: string;
  size?: number;
  weight?: Weight;
  color?: Rgb;
  align?: "left" | "right" | "center";
}

export interface PdfRect {
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number; // corner radius
  color: Rgb;
}

/** An SVG path `d`, drawn with its origin at (x, y) and scaled by `scale`. */
export interface PdfPath {
  d: string;
  x: number;
  y: number;
  scale: number;
  color: Rgb;
}

export interface PdfPage {
  texts: PdfText[];
  rects?: PdfRect[];
  paths?: PdfPath[];
}

export const A4_LANDSCAPE = { width: 842, height: 595 };

/* ---------- Fonts ---------- */

const FACES: Record<Weight, string> = {
  regular: "PlusJakartaSans-Regular",
  bold: "PlusJakartaSans-Bold",
  extrabold: "PlusJakartaSans-ExtraBold",
};
const WEIGHTS = Object.keys(FACES) as Weight[];

interface Font {
  name: string;
  file: Uint8Array;
  widths: number[]; // per WinAnsi code 0..255, in 1/1000 em
  bbox: number[];
  ascent: number;
  descent: number;
  capHeight: number;
}

// WinAnsi codes 0x80-0x9F; the rest of the code page is Latin-1.
const WIN: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e,
  "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};
const UNI = Object.fromEntries(Object.entries(WIN).map(([c, code]) => [code, c.charCodeAt(0)]));

/** Map to WinAnsi bytes: French number spacing becomes a plain space. */
function winAnsi(s: string) {
  let out = "";
  for (const c of s.replace(/[   ]/g, " ").replace(/−/g, "-")) {
    const u = c.charCodeAt(0);
    out += String.fromCharCode(WIN[c] ?? (u < 0x80 || (u >= 0xa0 && u <= 0xff) ? u : 0x3f));
  }
  return out;
}

/** Reads what a simple TrueType font dictionary needs: metrics and the (3,1) cmap. */
function parseTtf(name: string, file: Uint8Array): Font {
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const tables: Record<string, number> = {};
  for (let i = 0, n = v.getUint16(4); i < n; i++) {
    const at = 12 + i * 16;
    tables[String.fromCharCode(...file.subarray(at, at + 4))] = v.getUint32(at + 8);
  }
  const head = tables["head"];
  const hhea = tables["hhea"];
  const os2 = tables["OS/2"];
  const upm = v.getUint16(head + 18);
  const em = (u: number) => Math.round((u * 1000) / upm);
  const nMetrics = v.getUint16(hhea + 34);
  const advance = (g: number) => v.getUint16(tables["hmtx"] + 4 * Math.min(g, nMetrics - 1));

  // Format 4 subtable for Windows Unicode BMP.
  const cmap = tables["cmap"];
  let sub = 0;
  for (let i = 0, n = v.getUint16(cmap + 2); i < n; i++) {
    const rec = cmap + 4 + i * 8;
    if (v.getUint16(rec) === 3 && v.getUint16(rec + 2) === 1) sub = cmap + v.getUint32(rec + 4);
  }
  const segX2 = v.getUint16(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  const glyph = (u: number) => {
    for (let s = 0; s < segX2; s += 2) {
      if (u > v.getUint16(ends + s)) continue;
      const start = v.getUint16(starts + s);
      if (u < start) return 0;
      const ro = v.getUint16(ranges + s);
      if (!ro) return (u + v.getInt16(deltas + s)) & 0xffff;
      const g = v.getUint16(ranges + s + ro + 2 * (u - start));
      return g ? (g + v.getInt16(deltas + s)) & 0xffff : 0;
    }
    return 0;
  };

  const widths = Array.from({ length: 256 }, (_, c) => {
    const u = c < 0x80 || c >= 0xa0 ? c : UNI[c];
    return u === undefined ? 0 : em(advance(glyph(u)));
  });
  return {
    name,
    file,
    widths,
    bbox: [36, 38, 40, 42].map((o) => em(v.getInt16(head + o))),
    ascent: em(v.getInt16(hhea + 4)),
    descent: em(v.getInt16(hhea + 6)),
    capHeight: os2 && v.getUint16(os2) >= 2 ? em(v.getInt16(os2 + 88)) : 700,
  };
}

let fontsLoading: Promise<Record<Weight, Font>> | undefined;

function loadFonts() {
  fontsLoading ??= Promise.all(
    WEIGHTS.map(async (w) => {
      const res = await fetch(`/fonts/${FACES[w]}.ttf`);
      if (!res.ok) throw new Error(`Police ${FACES[w]} introuvable`);
      return parseTtf(FACES[w], new Uint8Array(await res.arrayBuffer()));
    }),
  ).then(
    (list) => Object.fromEntries(WEIGHTS.map((w, i) => [w, list[i]])) as Record<Weight, Font>,
    (e) => {
      fontsLoading = undefined;
      throw e;
    },
  );
  return fontsLoading;
}

const measure = (font: Font, s: string, size: number) => ([...winAnsi(s)].reduce((w, c) => w + font.widths[c.charCodeAt(0)], 0) * size) / 1000;

/* ---------- Drawing ---------- */

const esc = (s: string) => winAnsi(s).replace(/[\\()]/g, (c) => `\\${c}`);
const n = (v: number) => (Math.round(v * 100) / 100).toString();
const rgb = ([r, g, b]: Rgb) => `${n(r / 255)} ${n(g / 255)} ${n(b / 255)}`;

function rect({ x, y, w, h, r = 0 }: PdfRect, height: number) {
  const b = height - y - h;
  if (!r) return `${n(x)} ${n(b)} ${n(w)} ${n(h)} re`;
  const k = r * 0.5523; // circle arc as a cubic
  const [l, t, rt] = [x, b + h, x + w];
  return [
    `${n(l + r)} ${n(b)} m`,
    `${n(rt - r)} ${n(b)} l ${n(rt - r + k)} ${n(b)} ${n(rt)} ${n(b + r - k)} ${n(rt)} ${n(b + r)} c`,
    `${n(rt)} ${n(t - r)} l ${n(rt)} ${n(t - r + k)} ${n(rt - r + k)} ${n(t)} ${n(rt - r)} ${n(t)} c`,
    `${n(l + r)} ${n(t)} l ${n(l + r - k)} ${n(t)} ${n(l)} ${n(t - r + k)} ${n(l)} ${n(t - r)} c`,
    `${n(l)} ${n(b + r)} l ${n(l)} ${n(b + r - k)} ${n(l + r - k)} ${n(b)} ${n(l + r)} ${n(b)} c h`,
  ].join(" ");
}

/** SVG path data (M L H V C S Z, absolute or relative) to PDF path operators. */
function svgPath({ d, x: ox, y: oy, scale }: PdfPath, height: number) {
  const tok = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const P = (px: number, py: number) => `${n(ox + px * scale)} ${n(height - oy - py * scale)}`;
  const ops: string[] = [];
  let i = 0;
  let cmd = "";
  let [x, y, sx, sy, cx, cy] = [0, 0, 0, 0, 0, 0]; // pen, subpath start, last control point
  const num = () => parseFloat(tok[i++]);
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase();
    const bx = rel ? x : 0;
    const by = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M":
        [x, y] = [bx + num(), by + num()];
        [sx, sy] = [x, y];
        ops.push(`${P(x, y)} m`);
        cmd = rel ? "l" : "L"; // further pairs are line-tos
        break;
      case "L":
        [x, y] = [bx + num(), by + num()];
        ops.push(`${P(x, y)} l`);
        break;
      case "H":
        x = bx + num();
        ops.push(`${P(x, y)} l`);
        break;
      case "V":
        y = by + num();
        ops.push(`${P(x, y)} l`);
        break;
      case "C":
      case "S": {
        const smooth = cmd.toUpperCase() === "S";
        const [x1, y1] = smooth ? [2 * x - cx, 2 * y - cy] : [bx + num(), by + num()];
        [cx, cy] = [bx + num(), by + num()];
        [x, y] = [bx + num(), by + num()];
        ops.push(`${P(x1, y1)} ${P(cx, cy)} ${P(x, y)} c`);
        continue; // keep the control point for a following S
      }
      case "Z":
        [x, y] = [sx, sy];
        ops.push("h");
        cmd = "";
        break;
      default:
        i++; // unsupported or stray token
    }
    [cx, cy] = [x, y];
  }
  return ops.join(" ");
}

const FONT_KEY: Record<Weight, string> = { regular: "F1", bold: "F2", extrabold: "F3" };

function contentStream(page: PdfPage, height: number, fonts: Record<Weight, Font>) {
  const ops: string[] = [];
  for (const r of page.rects ?? []) ops.push(`${rgb(r.color)} rg ${rect(r, height)} f`);
  for (const p of page.paths ?? []) ops.push(`${rgb(p.color)} rg ${svgPath(p, height)} f`);
  for (const t of page.texts) {
    const size = t.size ?? 10;
    const weight = t.weight ?? "regular";
    const w = t.align && t.align !== "left" ? measure(fonts[weight], t.text, size) : 0;
    const x = t.align === "right" ? t.x - w : t.align === "center" ? t.x - w / 2 : t.x;
    ops.push(`BT /${FONT_KEY[weight]} ${n(size)} Tf ${rgb(t.color ?? [0, 0, 0])} rg 1 0 0 1 ${n(x)} ${n(height - t.y)} Tm (${esc(t.text)}) Tj ET`);
  }
  return ops.join("\n");
}

/* ---------- File ---------- */

const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

async function deflate(data: Uint8Array) {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

type Obj = string | { dict: string; data: Uint8Array };

async function streamObj(data: Uint8Array, extra = ""): Promise<Obj> {
  const z = await deflate(data);
  return { dict: `<< /Length ${z.length} /Filter /FlateDecode${extra} >>`, data: z };
}

export async function pdfDocument(pages: PdfPage[], size = A4_LANDSCAPE): Promise<Blob> {
  const fonts = await loadFonts();
  const objs: Obj[] = [];
  const add = (o: Obj) => objs.push(o); // returns the new object's number (1-based)

  const fontRefs: string[] = [];
  for (const w of WEIGHTS) {
    const f = fonts[w];
    const file = add(await streamObj(f.file, ` /Length1 ${f.file.length}`));
    const desc = add(
      `<< /Type /FontDescriptor /FontName /${f.name} /Flags 32 /FontBBox [${f.bbox.join(" ")}] /ItalicAngle 0 ` +
        `/Ascent ${f.ascent} /Descent ${f.descent} /CapHeight ${f.capHeight} /StemV ${w === "regular" ? 80 : 140} /FontFile2 ${file} 0 R >>`,
    );
    const font = add(
      `<< /Type /Font /Subtype /TrueType /BaseFont /${f.name} /FirstChar 32 /LastChar 255 ` +
        `/Widths [${f.widths.slice(32).join(" ")}] /Encoding /WinAnsiEncoding /FontDescriptor ${desc} 0 R >>`,
    );
    fontRefs.push(`/${FONT_KEY[w]} ${font} 0 R`);
  }

  const catalog = add("<< /Type /Catalog /Pages 0 0 R >>");
  const pagesId = add("");
  const kids: number[] = [];
  for (const p of pages) {
    const contents = add(await streamObj(bytes(contentStream(p, size.height, fonts))));
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${size.width} ${size.height}] ` +
          `/Resources << /Font << ${fontRefs.join(" ")} >> >> /Contents ${contents} 0 R >>`,
      ),
    );
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  const chunks: Uint8Array[] = [];
  let length = 0;
  const write = (b: Uint8Array) => {
    chunks.push(b);
    length += b.length;
  };
  write(bytes("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"));
  const offsets = objs.map((o, i) => {
    const at = length;
    if (typeof o === "string") write(bytes(`${i + 1} 0 obj\n${o}\nendobj\n`));
    else {
      write(bytes(`${i + 1} 0 obj\n${o.dict}\nstream\n`));
      write(o.data);
      write(bytes("\nendstream\nendobj\n"));
    }
    return at;
  });
  const xref = length;
  write(bytes(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`));
  write(bytes(offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")));
  write(bytes(`trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`));
  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}
