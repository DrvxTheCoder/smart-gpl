const nf = (d: number) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmt = (n: number, d = 0) => nf(d).format(Number.isFinite(n) ? n : 0);
export const fmtT = (n: number, d = 1) => `${fmt(n, d)} T`;
export const fmtPct = (n: number, d = 1) => `${fmt(n, d)} %`;
/** Integer money: fr-FR groups thousands with a narrow no-break space; the label follows a no-break space. */
export const fmtMoney = (n: number, label = "F CFA") => `${fmt(Math.round(n))} ${label}`;
/** Money for cards and KPIs: millions (M) and billions (Md) with one or two decimals. */
export function fmtMoneyShort(n: number, label = "F CFA") {
  const a = Math.abs(n);
  const unit = label ? ` ${label}` : "";
  if (a >= 1e9) return `${fmt(n / 1e9, 2)} Md${unit}`;
  if (a >= 1e6) return `${fmt(n / 1e6, 1)} M${unit}`;
  return `${fmt(Math.round(n))}${unit}`;
}
export const fmtSigned = (n: number, d = 2) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt(Math.abs(n), d)}`;

export function fmtDuration(min: number) {
  const m = Math.max(Math.round(min), 0);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h} h ${String(r).padStart(2, "0")}` : `${r} min`;
}

export function parseISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const fmtDate = (s: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }) =>
  new Intl.DateTimeFormat("fr-FR", opts).format(parseISO(s));

export const invCode = (date: string) => {
  const [y, m, d] = date.split("-");
  return `INV/${d}/${m}/${y}`;
};

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
