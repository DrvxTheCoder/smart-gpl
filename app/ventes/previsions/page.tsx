"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { Check, Lock, RotateCcw } from "@/components/ui/icons";
import { Button, Card, CardTitle, Segmented } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { ForecastBars } from "@/components/charts/charts";
import { ForecastGrid, type Grid } from "@/components/sales/forecast-grid";
import { FillPlanCard } from "@/components/sales/fill-plan-card";
import { TonePill } from "@/components/sales/ui";
import { useQuery } from "@/components/sales/use-query";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { saveForecast } from "@/lib/sales/commands/forecast";
import { accuracy, band, forecastCells, perPeriod, productionPerPeriod, versionsOf } from "@/lib/sales/forecast";
import { centreFillPlan, customersIn, forecastSeries } from "@/lib/sales/selectors";
import { dayOf, periodLabel, periodRange, periodsAround } from "@/lib/sales/dates";
import { cap, cn, fmt, fmtDate, fmtSigned } from "@/lib/format";
import type { Forecast, ForecastLine } from "@/lib/sales/types";

type G = Forecast["granularity"];

function Inner() {
  const { config, centreId, centre, inventories } = useStore();
  const { data, ledger, today, own, exec, can, role } = useSales();
  const [q, setQ] = useQuery({ g: "SEMAINE", p: "", scope: "CLIENT", c: "" });
  const g = (q.g === "MOIS" ? "MOIS" : "SEMAINE") as G;
  const upcoming = useMemo(() => periodsAround(today, g, 0, 8), [today, g]);
  const period = upcoming.includes(q.p) ? q.p : upcoming[g === "SEMAINE" ? 1 : 0];
  const scope = q.scope === "CATEGORIE" ? "CATEGORIE" : "CLIENT";
  const entryCentre = centreId === "all" ? (config.centres.some((c) => c.id === q.c) ? q.c : config.centres[0].id) : centreId;
  const formats = config.bottleTypes;
  const allowed = can("forecast.edit");

  const versions = useMemo(() => versionsOf(data.forecasts, entryCentre, g), [data.forecasts, entryCentre, g]);
  const latest = versions[0];
  const customers = useMemo(() => customersIn(data.customers, entryCentre).filter((c) => c.active), [data.customers, entryCentre]);
  const categories = useMemo(() => config.sales.categories.filter((k) => customers.some((c) => c.categoryId === k.id)), [config.sales.categories, customers]);
  const rows = scope === "CLIENT" ? customers.map((c) => ({ key: c.id, label: c.name, sub: c.code })) : categories.map((k) => ({ key: k.id, label: k.label, sub: `${customers.filter((c) => c.categoryId === k.id).length} clients` }));

  // The grid starts from the version in force for that period, summed to the scope shown.
  const baseline = useMemo(() => {
    const out: Grid = {};
    if (!latest) return out;
    const cells = forecastCells(latest, customers);
    for (const [k, v] of cells) {
      const [p, c, f] = k.split("|");
      if (p !== period) continue;
      const key = scope === "CLIENT" ? c : customers.find((x) => x.id === c)?.categoryId;
      if (!key) continue;
      out[key] = { ...out[key], [f]: Math.round((out[key]?.[f] ?? 0) + v) };
    }
    return out;
  }, [latest, customers, period, scope]);

  const [grid, setGrid] = useState<Grid>(baseline);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  useEffect(() => setGrid(baseline), [baseline]);
  const dirty = JSON.stringify(grid) !== JSON.stringify(baseline);

  const save = () => {
    const lines: ForecastLine[] = rows.flatMap((r) => formats.map((f) => ({ period, formatId: f.id, scope, key: r.key, qty: grid[r.key]?.[f.id] ?? 0 })));
    const r = exec((env) => saveForecast(env, { centreId: entryCentre, granularity: g, lines }));
    if (r.ok) setSavedAt(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  };

  /* ---------- measures over the centres in scope ---------- */
  const series = useMemo(() => forecastSeries({ cfg: config, data, centreId, granularity: g }), [config, data, centreId, g]);
  const span = useMemo(() => periodsAround(today, g, g === "SEMAINE" ? 8 : 3, g === "SEMAINE" ? 3 : 1), [today, g]);
  const past = span.filter((p) => periodRange(p, g)[1] < today);
  const chart = useMemo(() => {
    const fc = perPeriod(series.latest, span);
    const act = perPeriod(series.actual, span);
    return span.map((p, i) => ({ label: periodLabel(p, g), full: cap(periodLabel(p, g, true)), forecast: Math.round(fc[i]), actual: periodRange(p, g)[1] < today ? Math.round(act[i]) : null }));
  }, [series, span, g, today]);
  const production = useMemo(() => productionPerPeriod(inventories, centreId, past, g), [inventories, centreId, past, g]);
  const fcPast = perPeriod(series.latest, past);
  const actPast = perPeriod(series.actual, past);
  const acc = useMemo(
    () =>
      formats.map((f) => ({
        f,
        initial: accuracy(series.initial, series.actual, past, { formatId: f.id }),
        latest: accuracy(series.latest, series.actual, past, { formatId: f.id }),
      })),
    [formats, series, past],
  );
  const total = { initial: accuracy(series.initial, series.actual, past), latest: accuracy(series.latest, series.actual, past) };
  const worst = useMemo(
    () =>
      customersIn(data.customers, centreId)
        .map((c) => ({ c, a: accuracy(series.latest, series.actual, past, { customerId: c.id }) }))
        .filter((x) => x.a.mape != null)
        .sort((a, b) => (b.a.mape ?? 0) - (a.a.mape ?? 0))
        .slice(0, 3),
    [data.customers, centreId, series, past],
  );
  const plans = useMemo(
    () => (centreId === "all" ? config.centres : [centre(centreId)]).map((c) => ({ c, plan: centreFillPlan({ cfg: config, data, ledger, inventories, today, own }, c.id) })),
    [centreId, config, centre, data, ledger, inventories, today, own],
  );
  const mapeTone = (v: number | null) => band(v, config.sales.targets.mape, true);
  const scopeLabel = centreId === "all" ? "tous les centres" : centre(centreId).name;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-semibold tracking-[-0.03em] sm:text-[40px]">Prévisions</h1>
          <p className="mt-1 text-[15px] text-muted">Ce que l&apos;équipe commerciale attend, comparé à ce que les clients ont pris, {scopeLabel}.</p>
        </div>
        <Segmented
          label="Granularité"
          value={g}
          onChange={(v) => setQ({ g: v, p: "" })}
          options={[
            { value: "SEMAINE", label: "Semaine" },
            { value: "MOIS", label: "Mois" },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Saisie de la prévision</CardTitle>
                <p className="mt-1 text-[13px] text-muted">
                  {latest ? `Part de la v${latest.version} (${latest.basis === "INITIALE" ? "initiale" : "révision"}) du ${fmtDate(dayOf(latest.createdAt), { day: "numeric", month: "short" })}, ${latest.createdBy}.` : "Aucune version : la première sera la prévision initiale."} Collez un bloc depuis un tableur dans n&apos;importe quelle case.
                </p>
              </div>
              {savedAt && !dirty && (
                <span className="flex items-center gap-1.5 text-[13px] text-muted" aria-live="polite">
                  <Check className="size-4 text-ok" />
                  Enregistré à {savedAt}
                </span>
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {centreId === "all" && (
                <Select className="w-full sm:w-56" ariaLabel="Centre" value={entryCentre} onChange={(v) => setQ({ c: v })} options={config.centres.map((c) => ({ value: c.id, label: c.name }))} />
              )}
              <Select className="w-full sm:w-72" ariaLabel="Période" value={period} onChange={(v) => setQ({ p: v })} options={upcoming.map((p) => ({ value: p, label: cap(periodLabel(p, g, true)) }))} />
              <Segmented
                label="Lignes"
                value={scope}
                onChange={(v) => setQ({ scope: v })}
                options={[
                  { value: "CLIENT", label: "Par client" },
                  { value: "CATEGORIE", label: "Par catégorie" },
                ]}
              />
            </div>
            {!allowed && (
              <p className="mt-4 flex items-center gap-2 rounded-2xl bg-brand-100 px-4 py-3 text-[14px] text-brand-deep">
                <Lock className="size-4 shrink-0" />
                Lecture seule : la saisie est ouverte à l&apos;équipe commerciale. Rôle actuel : {role.label.toLowerCase()}.
              </p>
            )}
            <div className="mt-4">
              {rows.length ? <ForecastGrid rows={rows} formats={formats} values={grid} onChange={setGrid} disabled={!allowed} /> : <p className="py-8 text-center text-muted">Aucun client actif pour ce centre : créez des clients avant de saisir une prévision.</p>}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" disabled={!dirty} onClick={() => setGrid(baseline)}>
                <RotateCcw className="size-4" />
                Reprendre la version en cours
              </Button>
              <Button disabled={!allowed || !dirty || !rows.length} onClick={save}>
                Enregistrer la v{(latest?.version ?? 0) + 1}
              </Button>
            </div>
          </Card>

          <Card>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Prévision et réalisé</CardTitle>
                <p className="mt-0.5 text-[13px] text-muted">Bouteilles. Hachuré : dernière version de la prévision. Plein : commandes, et ventes des grossistes.</p>
              </div>
            </div>
            <div className="h-[240px]">
              <ForecastBars data={chart} />
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[520px] text-[14px]">
                <thead>
                  <tr className="text-left text-[12px] text-muted">
                    <th className="pb-2 font-medium">Période</th>
                    <th className="pb-2 pl-4 text-right font-medium whitespace-nowrap">Prévu</th>
                    <th className="pb-2 pl-4 text-right font-medium whitespace-nowrap">Demandé</th>
                    <th className="pb-2 pl-4 text-right font-medium whitespace-nowrap">Produit</th>
                    <th className="pb-2 pl-4 text-right font-medium whitespace-nowrap">Production / prévision</th>
                  </tr>
                </thead>
                <tbody>
                  {past.slice(-4).map((p) => {
                    const i = past.indexOf(p);
                    const ratio = fcPast[i] ? (production[i] / fcPast[i]) * 100 : null;
                    return (
                      <tr key={p} className="border-t border-line">
                        <td className="py-2.5 pr-3">{cap(periodLabel(p, g, true))}</td>
                        <td className="tnum py-2.5 pl-4 text-right whitespace-nowrap">{fmt(fcPast[i])}</td>
                        <td className="tnum py-2.5 pl-4 text-right whitespace-nowrap">{fmt(actPast[i])}</td>
                        <td className="tnum py-2.5 pl-4 text-right whitespace-nowrap">{fmt(production[i])}</td>
                        <td className="tnum py-2.5 pl-4 text-right whitespace-nowrap">{ratio == null ? "—" : `${fmt(ratio)} %`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardTitle>Précision des prévisions</CardTitle>
            <p className="mt-1 text-[13px] text-muted">
              Sur les {past.length} dernières périodes closes. Écart moyen (MAPE) : moyenne des |prévu − réel| / réel par client et format. Biais : (Σ prévu − Σ réel) / Σ réel, positif quand on prévoit trop.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[400px] text-[14px]">
                <thead>
                  <tr className="text-left text-[12px] text-muted">
                    <th className="pb-2 font-medium">Format</th>
                    <th className="pb-2 pl-4 text-right font-medium whitespace-nowrap">Écart, initiale</th>
                    <th className="pb-2 pl-4 text-right font-medium whitespace-nowrap">Écart, dernière</th>
                    <th className="pb-2 pl-4 text-right font-medium whitespace-nowrap">Biais</th>
                  </tr>
                </thead>
                <tbody>
                  {[...acc, { f: { id: "total", label: "Tous formats", kg: 0 }, ...total }].map(({ f, initial, latest: l }) => {
                    const t = mapeTone(l.mape);
                    return (
                      <tr key={f.id} className={cn("border-t border-line", f.id === "total" && "font-semibold")}>
                        <td className="py-2.5 pr-3">{f.label}</td>
                        <td className="tnum py-2.5 pl-4 text-right whitespace-nowrap text-muted">{initial.mape == null ? "—" : `${fmt(initial.mape, 1)} %`}</td>
                        <td className="py-2.5 pl-4 text-right whitespace-nowrap">{l.mape == null ? "—" : t ? <TonePill tone={t}>{fmt(l.mape, 1)} %</TonePill> : `${fmt(l.mape, 1)} %`}</td>
                        <td className="tnum py-2.5 pl-4 text-right whitespace-nowrap">{l.bias == null ? "—" : `${fmtSigned(l.bias, 1)} %`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {worst.length > 0 && (
              <div className="mt-5 rounded-2xl bg-board p-4">
                <p className="text-[13px] font-medium">Plus grands écarts par client</p>
                <ul className="mt-2 space-y-1.5 text-[14px]">
                  {worst.map(({ c, a }) => (
                    <li key={c.id} className="flex items-baseline justify-between gap-3">
                      <span className="truncate">{c.name}</span>
                      <span className="tnum shrink-0 text-muted">
                        {fmt(a.mape ?? 0, 1)} %, biais {fmtSigned(a.bias ?? 0, 1)} %
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-3 text-[12px] text-faint">
              Seuils : écart maîtrisé jusqu&apos;à {config.sales.targets.mape[0]} %, à surveiller jusqu&apos;à {config.sales.targets.mape[1]} % (Paramètres, Ventes et flux).
            </p>
          </Card>
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-[100px] xl:self-start">
          {plans.map(({ c, plan }) => (
            <FillPlanCard key={c.id} title={plans.length > 1 ? `Plan de remplissage, ${c.name}` : "Plan de remplissage"} plan={plan} />
          ))}
          <Card>
            <CardTitle>Versions</CardTitle>
            <p className="mt-1 text-[13px] text-muted">Une révision crée une nouvelle version : les précédentes restent consultables et mesurables.</p>
            <ol className="mt-4 space-y-2">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 rounded-2xl bg-board px-3.5 py-2.5 text-[14px]">
                  <span>
                    <b className="font-medium">v{v.version}</b> <span className="text-muted">{v.basis === "INITIALE" ? "initiale" : "révision"}</span>
                  </span>
                  <span className="tnum text-[12px] text-muted">
                    {fmtDate(dayOf(v.createdAt), { day: "numeric", month: "short" })}, {v.createdBy}
                  </span>
                </li>
              ))}
              {versions.length === 0 && <li className="text-[13px] text-muted">Aucune version pour ce centre.</li>}
            </ol>
          </Card>
        </aside>
      </div>
    </div>
  );
}

export default function PrevisionsPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
