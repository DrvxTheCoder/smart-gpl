"use client";

import Link from "next/link";
import { Suspense, useMemo } from "react";
import { ArrowLeft, Printer } from "@/components/ui/icons";
import { Button } from "@/components/ui/primitives";
import { Logo, PRODUCT } from "@/components/shell/app-shell";
import { useQuery } from "@/components/sales/use-query";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { AUTHORITY_COLUMNS, isClosed, reportRows } from "@/lib/sales/day-close";
import { fmt, fmtDate } from "@/lib/format";
import { UNKNOWN_BRAND } from "@/lib/sales/types";

const PLACEHOLDER = "Modèle provisoire : à remplacer par le format exigé par l'autorité.";

/* Print-friendly authority report: the shell hides itself in print, this page is the sheet. */
function Inner() {
  const { config } = useStore();
  const { data, ledger, today } = useSales();
  const [q] = useQuery({ c: "", jour: "" });
  const centre = config.centres.find((c) => c.id === q.c) ?? config.centres[0];
  const day = q.jour || today;
  const t = config.sales.reports.authority;
  const closed = data.closes.find((c) => c.centreId === centre.id && c.date === day);
  const rows = useMemo(() => closed?.rows ?? reportRows(ledger, centre.id, day, config.sales.brands, config.bottleTypes.map((b) => b.id)), [closed, ledger, centre.id, day, config]);
  const ctx = {
    brand: (b: string) => (b === UNKNOWN_BRAND ? "Marque non identifiée" : config.sales.brands.find((x) => x.id === b)?.name ?? b),
    format: (f: string) => config.bottleTypes.find((b) => b.id === f)?.label ?? f,
  };
  const numeric = (k: string) => !["marque", "format"].includes(k);
  const cell = (v: string | number | undefined) => (typeof v === "number" ? fmt(v) : v ?? "");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/magasin?tab=cloture${q.c ? `&c=${q.c}` : ""}`} className="inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-ink">
          <ArrowLeft className="size-4" />
          Clôture
        </Link>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          Imprimer
        </Button>
      </div>

      <article className="mx-auto max-w-[900px] rounded-card bg-white p-6 text-ink print:max-w-none print:rounded-none print:p-0">
        <header className="flex items-center gap-3 border-b-4 border-brand-800 pb-4">
          <span className="grid size-12 place-items-center rounded-xl bg-brand-800 text-[16px] font-bold text-white print:[print-color-adjust:exact]">{config.branding.shortName}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-semibold">{config.branding.companyName}</p>
            <p className="text-[13px] text-muted">
              {t.title} · {centre.name}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[15px] font-semibold">{fmtDate(day)}</p>
            <p className="text-[12px] text-muted">{closed ? `Clôturé par ${closed.by}` : isClosed(data.closes, centre.id, day) ? "" : "Journée non clôturée : chiffres provisoires"}</p>
          </div>
        </header>
        {t.placeholder && <p className="mt-4 rounded-lg border border-warn/45 bg-warn/8 px-3 py-2 text-[13px] font-medium text-[#7a5306]">{PLACEHOLDER}</p>}
        {t.header && t.header !== PLACEHOLDER && <p className="mt-3 text-[13px] text-muted">{t.header}</p>}
        <table className="mt-5 w-full text-[13px]">
          <thead>
            <tr className="border-b-2 border-ink/80 text-left">
              {t.columns.map((k) => (
                <th key={k} className={`pb-2 font-semibold ${numeric(k) ? "pl-3 text-right" : "pr-3"}`}>
                  {AUTHORITY_COLUMNS[k]?.label ?? k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.brand}-${r.formatId}`} className="border-b border-line">
                {t.columns.map((k) => (
                  <td key={k} className={`tnum py-1.5 ${numeric(k) ? "pl-3 text-right" : "pr-3"}`}>
                    {cell(AUTHORITY_COLUMNS[k]?.value(r, ctx))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="py-8 text-center text-muted">Aucune bouteille en stock ni mouvement ce jour-là.</p>}
        <footer className="mt-8 flex items-center justify-between text-[11px] text-muted">
          <span>Établi d&apos;après le registre des mouvements de bouteilles.</span>
          <span className="flex items-center gap-1.5">
            <Logo className="size-3.5" /> {PRODUCT}
          </span>
        </footer>
      </article>
    </div>
  );
}

export default function RapportPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
