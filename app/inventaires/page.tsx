"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, Search } from "@/components/ui/icons";
import { useScopedInventories, useStore } from "@/lib/store";
import { ecartBand, summarize } from "@/lib/calc";
import { iso } from "@/lib/seed";
import { cap, cn, fmt, fmtDate, invCode } from "@/lib/format";
import { Button, Card, CardTitle, EcartPill, Segmented, StatusBadge, inputCls } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/calendar";

type View = "liste" | "calendrier";
const PAGE = 12;

function Inner() {
  const { config, centre, centreId, toast } = useStore();
  const invs = useScopedInventories();
  const params = useSearchParams();
  const [view, setView] = useState<View>("liste");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [day, setDay] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const now = new Date();
  const [month, setMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1));

  useEffect(() => setQ(params.get("q") ?? ""), [params]);
  useEffect(() => setPage(0), [q, day, centreId]);

  const rows = useMemo(
    () =>
      invs.map((i) => {
        const s = summarize(i, centre(i.centreId), config);
        return { inv: i, s, band: ecartBand(s.ecartPct, config.rules) };
      }),
    [invs, centre, config],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const onDay = day ? rows.filter(({ inv }) => inv.date === day) : rows;
    if (!term) return onDay;
    return onDay.filter(({ inv }) => {
      const hay = [invCode(inv.date), fmtDate(inv.date), fmtDate(inv.date, { weekday: "long" }), inv.startedBy, centre(inv.centreId).name].join(" ").toLowerCase();
      return hay.includes(term);
    });
  }, [rows, q, day, centre]);

  const pages = Math.max(Math.ceil(filtered.length / PAGE), 1);
  const slice = filtered.slice(page * PAGE, page * PAGE + PAGE);

  // Calendar cells for the visible month
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // week starts Monday
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: ({ date: string; day: number } | null)[] = Array(offset).fill(null);
    for (let d = 1; d <= days; d++) out.push({ date: iso(new Date(month.getFullYear(), month.getMonth(), d)), day: d });
    while (out.length % 7) out.push(null);
    return out;
  }, [month]);

  const byDate = useMemo(() => {
    const m: Record<string, typeof rows> = {};
    for (const r of rows) (m[r.inv.date] ??= []).push(r);
    return m;
  }, [rows]);

  const monthStats = useMemo(() => {
    const key = iso(month).slice(0, 7);
    const list = rows.filter((r) => r.inv.date.startsWith(key) && r.inv.status === "TERMINE");
    return {
      n: list.length,
      t: list.reduce((a, r) => a + r.s.conditionneT, 0),
      ok: list.filter((r) => r.band === "ok").length,
      warn: list.filter((r) => r.band === "warn").length,
      alert: list.filter((r) => r.band === "alert").length,
    };
  }, [rows, month]);

  const today = iso(now);
  const oldest = rows.length ? rows[rows.length - 1].inv.date : undefined;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-semibold tracking-[-0.03em] sm:text-[40px]">Inventaires</h1>
          <p className="mt-1 text-[15px] text-muted">Une fiche par journée de production et par centre.</p>
        </div>
        <Segmented
          options={[
            { value: "liste", label: "Liste" },
            { value: "calendrier", label: "Calendrier" },
          ]}
          value={view}
          onChange={setView}
          label="Affichage"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {view === "liste" ? (
          <Card className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex w-full max-w-xl flex-wrap gap-2 sm:flex-nowrap">
                <div className="relative w-full">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Date, code, responsable"
                    aria-label="Filtrer les inventaires"
                    className={cn(inputCls, "pl-9")}
                  />
                </div>
                <DatePicker
                  className="sm:w-[230px] sm:shrink-0"
                  ariaLabel="Filtrer par date"
                  placeholder="Toutes les dates"
                  clearable
                  value={day}
                  onChange={setDay}
                  min={oldest}
                  max={today}
                  isMarked={(d) => !!byDate[d]}
                />
              </div>
              <p className="tnum text-[13px] text-muted">
                <b className="font-semibold text-ink">{filtered.length}</b> inventaires
              </p>
            </div>

            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[14px]">
                <thead>
                  <tr className="border-b border-line text-[12px] text-muted">
                    <th className="py-2.5 pr-3 font-medium">Inventaire</th>
                    <th className="py-2.5 pr-3 font-medium">Centre et responsable</th>
                    <th className="py-2.5 pr-3 text-right font-medium">Conditionné</th>
                    <th className="py-2.5 pr-3 text-right font-medium">Stock physique</th>
                    <th className="py-2.5 pr-3 text-right font-medium">Écart</th>
                    <th className="py-2.5 font-medium">
                      <span className="sr-only">Ouvrir</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map(({ inv, s, band }) => (
                    <tr key={inv.id} className="group border-b border-line last:border-0">
                      <td className="py-3 pr-3">
                        <p className="font-medium">{invCode(inv.date)}</p>
                        <p className="text-[12px] text-muted">{cap(fmtDate(inv.date, { weekday: "long", day: "numeric", month: "short" }))}</p>
                      </td>
                      <td className="py-3 pr-3">
                        <p>{centre(inv.centreId).name}</p>
                        <p className="text-[12px] text-muted">{inv.startedBy}</p>
                      </td>
                      <td className="tnum py-3 pr-3 text-right">{fmt(s.conditionneT, 1)} T</td>
                      <td className="tnum py-3 pr-3 text-right">{fmt(s.stockPhys, 1)} T</td>
                      <td className="py-3 pr-3 text-right">{inv.status === "EN_COURS" ? <StatusBadge status="EN_COURS" /> : <EcartPill pct={s.ecartPct} band={band} />}</td>
                      <td className="py-3 text-right">
                        <Link
                          href={`/inventaires/${inv.id}`}
                          className="inline-flex h-8 items-center rounded-full border border-line px-3 text-[13px] font-medium group-hover:border-brand-800 group-hover:bg-brand-50"
                        >
                          {inv.status === "EN_COURS" ? "Saisir" : "Voir"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {slice.length === 0 && <p className="py-10 text-center text-muted">Aucun inventaire ne correspond. Essayez une date comme « 12 septembre » ou un code INV.</p>}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <p className="tnum text-[13px] text-muted">
                Page {page + 1} sur {pages}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Page précédente">
                  <ChevronLeft className="size-4" />
                </Button>
                <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Page suivante">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="min-w-0">
            <div className="mb-4 flex items-center justify-between">
              <CardTitle className="text-[22px] font-semibold tracking-[-0.02em]">
                {cap(new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(month))}
              </CardTitle>
              <div className="flex gap-2">
                <button className="grid size-9 place-items-center rounded-full bg-board hover:bg-brand-100" aria-label="Mois précédent" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  className="grid size-9 place-items-center rounded-full bg-board hover:bg-brand-100 disabled:opacity-40"
                  aria-label="Mois suivant"
                  disabled={month.getMonth() === now.getMonth() && month.getFullYear() === now.getFullYear()}
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1.5 text-center text-[12px] text-muted" aria-hidden>
              {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => (
                <span key={d} className="pb-1">
                  {d}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {cells.map((c, k) => {
                if (!c) return <span key={k} />;
                const list = byDate[c.date] ?? [];
                const future = c.date > today;
                const r = list[0];
                const worst = list.reduce<"ok" | "warn" | "alert" | null>((w, x) => {
                  if (x.inv.status !== "TERMINE") return w;
                  const order = { ok: 0, warn: 1, alert: 2 };
                  return w == null || order[x.band] > order[w] ? x.band : w;
                }, null);
                const t = list.reduce((a, x) => a + x.s.conditionneT, 0);
                const body = (
                  <>
                    <span className={cn("text-[13px] font-medium", c.date === today && "grid size-6 place-items-center rounded-full bg-brand-800 text-white")}>{c.day}</span>
                    {list.length > 0 && (
                      <span className="mt-auto w-full text-left">
                        <span className="tnum block text-[12px] font-medium text-ink">{fmt(t, 0)} T</span>
                        <span className="mt-1 flex items-center gap-1">
                          <span
                            className={cn(
                              "h-1.5 flex-1 rounded-full",
                              r.inv.status === "EN_COURS" ? "hatch" : worst === "ok" ? "bg-ok" : worst === "warn" ? "bg-warn" : "bg-alert",
                            )}
                          />
                        </span>
                      </span>
                    )}
                    {list.length === 0 && !future && <span className="mt-auto text-[11px] text-faint">Sans prod.</span>}
                  </>
                );
                const label = `${fmtDate(c.date, { weekday: "long", day: "numeric", month: "long" })}, ${list.length ? `${fmt(t, 1)} tonnes` : "pas d'inventaire"}`;
                return list.length ? (
                  <Link
                    key={c.date}
                    href={`/inventaires/${r.inv.id}`}
                    aria-label={label}
                    className="flex min-h-[78px] flex-col items-start rounded-xl border border-line bg-field p-2 transition-colors hover:border-brand-600 sm:min-h-[92px]"
                  >
                    {body}
                  </Link>
                ) : (
                  <div key={c.date} aria-label={label} className={cn("flex min-h-[78px] flex-col items-start rounded-xl p-2 sm:min-h-[92px]", future ? "opacity-40" : "hatch opacity-70")}>
                    {body}
                  </div>
                );
              })}
            </div>
            <ul className="mt-4 flex flex-wrap gap-4 text-[12px] text-muted">
              <li className="flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-ok" />Écart ≤ {config.rules.ecartOk} %</li>
              <li className="flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-warn" />Jusqu&apos;à {config.rules.ecartWarn} %</li>
              <li className="flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-alert" />Au-delà</li>
              <li className="flex items-center gap-1.5"><span className="hatch h-1.5 w-4 rounded-full" />En cours</li>
            </ul>
          </Card>
        )}

        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Rapport mensuel</CardTitle>
            <p className="mt-1 text-[13px] text-muted">Une ligne par journée, totaux et moyennes en pied de tableau. Format A4 paysage.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Select
                ariaLabel="Mois"
                value={String(month.getMonth())}
                onChange={(v) => setMonth(new Date(month.getFullYear(), Number(v), 1))}
                options={Array.from({ length: 12 }, (_, m) => ({
                  value: String(m),
                  label: cap(new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(new Date(2026, m, 1))),
                }))}
              />
              <Select
                ariaLabel="Année"
                value={String(month.getFullYear())}
                onChange={(v) => setMonth(new Date(Number(v), month.getMonth(), 1))}
                options={Array.from({ length: 4 }, (_, k) => String(now.getFullYear() - k)).map((y) => ({ value: y, label: y }))}
              />
            </div>
            <p className="mt-2 text-[13px] text-muted">{centreId === "all" ? "Tous les centres" : centre(centreId).name}</p>
            <div className="mt-4 flex flex-col gap-2">
              <Button onClick={() => toast("Export PDF à venir")}>
                <FileDown className="size-4" />
                Télécharger le PDF
              </Button>
              <Button variant="ghost" onClick={() => toast("Export Excel à venir")}>
                <FileSpreadsheet className="size-4" />
                Exporter en Excel
              </Button>
            </div>
          </Card>

          <Card>
            <CardTitle>{cap(new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(month))} en bref</CardTitle>
            <dl className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <dt className="text-[12px] text-muted">Journées clôturées</dt>
                <dd className="tnum text-[26px] font-semibold tracking-[-0.02em]">{monthStats.n}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Conditionné</dt>
                <dd className="tnum text-[26px] font-semibold tracking-[-0.02em]">
                  {fmt(monthStats.t, 0)}
                  <span className="text-[14px] text-muted"> T</span>
                </dd>
              </div>
            </dl>
            <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-line" aria-hidden>
              <span className="bg-ok" style={{ flex: monthStats.ok }} />
              <span className="bg-warn" style={{ flex: monthStats.warn }} />
              <span className="bg-alert" style={{ flex: monthStats.alert }} />
            </div>
            <p className="tnum mt-2 text-[12px] text-muted">
              {monthStats.ok} maîtrisés, {monthStats.warn} à surveiller, {monthStats.alert} à justifier
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function InventairesPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
