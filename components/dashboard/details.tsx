"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { aggregate, delta, inRange, type Aggregate } from "@/lib/aggregate";
import { ecartBand, summarize, tankOutcomes } from "@/lib/calc";
import { iso } from "@/lib/seed";
import { cap, cn, fmt, fmtDate, invCode } from "@/lib/format";
import type { Centre, Inventory, Reservoir, TenantConfig } from "@/lib/types";
import { ButtonLink, EcartPill, Segmented, StatusBadge } from "@/components/ui/primitives";
import { Breakdown, TimeRings, TrendChart, WeekBars, type BarDatum } from "@/components/charts/charts";
import { ChevronLeft, ChevronRight, Container } from "@/components/ui/icons";
import { TankLevel } from "@/components/production/production";
import { TankIllustration } from "@/components/tanks/TankIllustration";
import { TANK_GEOMETRY, TANK_REF_HEIGHT, tankKind } from "@/components/tanks/tankGeometry";
import type { TankStock } from "@/components/tanks/ReservoirsCard";

/*
 * What the dashboard cards open into. Everything is computed from the
 * inventories in scope, one point per production day.
 */

/* ---------------- daily history ---------------- */

export interface DayPoint {
  date: string;
  ids: string[];
  open: boolean; // an inventory of the day is still in progress
  a: Aggregate; // every inventory of the day, open ones included
  stockPhys: number;
  stockTheo: number;
  ecartPct: number;
  tanks: Record<string, { t: number; pct: number }>; // `${centreId}-${reservoirId}`
}

export function useHistory(invs: Inventory[], centres: Centre[], cfg: TenantConfig, centreOf: (id: string) => Centre): DayPoint[] {
  return useMemo(() => {
    const ids = new Set(centres.map((c) => c.id));
    const byDate = new Map<string, Inventory[]>();
    for (const i of invs) if (ids.has(i.centreId)) byDate.set(i.date, [...(byDate.get(i.date) ?? []), i]);
    return [...byDate.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, list]) => {
        let stockPhys = 0;
        let stockTheo = 0;
        let ecart = 0;
        const tanks: DayPoint["tanks"] = {};
        for (const inv of list) {
          const c = centreOf(inv.centreId);
          const s = summarize(inv, c, cfg);
          stockPhys += s.stockPhys;
          stockTheo += s.stockTheo;
          ecart += s.ecart;
          const out = tankOutcomes(inv, c, cfg);
          for (const r of c.reservoirs) {
            const o = out[r.id];
            if (o && !o.blocked) tanks[`${c.id}-${r.id}`] = { t: o.liquidT, pct: o.fillPct };
          }
        }
        return {
          date,
          ids: list.map((i) => i.id),
          open: list.some((i) => i.status === "EN_COURS"),
          a: aggregate(list, cfg, centreOf, false),
          stockPhys,
          stockTheo,
          ecartPct: stockTheo ? (ecart / stockTheo) * 100 : 0,
          tanks,
        };
      });
  }, [invs, centres, cfg, centreOf]);
}

const back = (end: string, days: number) => {
  const d = new Date(`${end}T12:00:00`);
  d.setDate(d.getDate() - days + 1);
  return iso(d);
};

/** A single day has no curve: the charts then show the week up to it. */
const chartRange = (cur: [string, string]): [string, string] => (cur[0] === cur[1] ? [back(cur[1], 7), cur[1]] : cur);

type Span = "semaine" | "mois" | "annee";
const SPANS: { value: Span; label: string }[] = [
  { value: "semaine", label: "Semaine" },
  { value: "mois", label: "Mois" },
  { value: "annee", label: "Année" },
];
const SPAN_DAYS: Record<Span, number> = { semaine: 7, mois: 30, annee: 365 };

const dayLabel = (d: string) => cap(fmtDate(d, { weekday: "short", day: "numeric", month: "short" }));

/* ---------------- building blocks ---------------- */

function Stat({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: ReactNode }) {
  return (
    <div className="rounded-2xl bg-board p-4">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="tnum mt-2 text-[26px] leading-none font-semibold tracking-[-0.03em]">
        {value}
        {unit && <span className="ml-1 text-[14px] font-medium text-muted">{unit}</span>}
      </p>
      {sub && <p className="mt-2 text-[12px] text-muted">{sub}</p>}
    </div>
  );
}

function Stats({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

function Panel({ title, sub, action, className, children }: { title: string; sub?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col rounded-2xl bg-board p-4", className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-medium">{title}</h3>
          {sub && <p className="mt-0.5 text-[12px] text-muted">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Delta({ value, invert }: { value: number | null; invert?: boolean }) {
  if (value == null) return <>Pas de période de comparaison</>;
  const good = invert ? value <= 0 : value >= 0;
  return (
    <>
      <span className={cn("tnum font-semibold", good ? "text-ok" : "text-alert")}>
        {value >= 0 ? "▲" : "▼"} {fmt(Math.abs(value), 1)} %
      </span>{" "}
      vs période précédente
    </>
  );
}

function Footer({ href, label }: { href: string; label: string }) {
  return (
    <div className="mt-5 flex justify-end">
      <ButtonLink href={href} variant="ghost" size="sm">
        {label}
      </ButtonLink>
    </div>
  );
}

const best = (rows: DayPoint[], v: (d: DayPoint) => number) => rows.reduce<DayPoint | undefined>((b, d) => (!b || v(d) > v(b) ? d : b), undefined);

interface KpiProps {
  history: DayPoint[];
  cur: [string, string];
  aCur: Aggregate;
  aPrev: Aggregate;
  cfg: TenantConfig;
}

const closedIn = (history: DayPoint[], r: [string, string]) => history.filter((d) => !d.open && inRange(d.date, r));

/* ---------------- Bouteilles produites ---------------- */

export function BottlesDetail({ history, cur, aCur, aPrev, cfg }: KpiProps) {
  const rows = closedIn(history, chartRange(cur));
  const top = best(closedIn(history, cur), (d) => d.a.bottlesN);
  const formats = cfg.bottleTypes.map((b) => ({ label: b.label, value: aCur.byBottle[b.id]?.n ?? 0, sub: `${fmt(aCur.byBottle[b.id]?.t ?? 0, 1)} T` })).filter((f) => f.value > 0);
  return (
    <>
      <Stats>
        <Stat label="Total" value={fmt(aCur.bottlesN)} unit="bt" sub={<Delta value={delta(aCur.bottlesN, aPrev.bottlesN)} />} />
        <Stat label="Moyenne par jour" value={fmt(aCur.days ? aCur.bottlesN / aCur.days : 0)} unit="bt" sub={`${aCur.days} jour${aCur.days > 1 ? "s" : ""} clôturé${aCur.days > 1 ? "s" : ""}`} />
        <Stat label="Meilleur jour" value={fmt(top?.a.bottlesN ?? 0)} unit="bt" sub={top ? dayLabel(top.date) : "—"} />
        <Stat label="Cadence" value={fmt(aCur.utileMin ? aCur.bottlesN / (aCur.utileMin / 60) : 0)} unit="bt/h" sub="Par heure de temps utile" />
      </Stats>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Bouteilles par jour" sub="Journées clôturées">
          <TrendChart className="h-[260px]" data={rows.map((d) => ({ date: d.date, v: d.a.bottlesN }))} series={[{ key: "v", label: "Bouteilles" }]} unit="bt" decimals={0} label="Bouteilles produites par jour" />
        </Panel>
        <Panel title="Par format">
          {formats.length ? <Breakdown items={formats} unit="bt" decimals={0} centerLabel="bouteilles" /> : <p className="text-[14px] text-muted">Aucune bouteille sur la période.</p>}
        </Panel>
      </div>
      <Footer href="/analyses" label="Voir les analyses" />
    </>
  );
}

/* ---------------- Tonnage conditionné ---------------- */

export function TonnageDetail({ history, cur, aCur, aPrev, cfg }: KpiProps) {
  const rows = closedIn(history, chartRange(cur));
  const top = best(closedIn(history, cur), (d) => d.a.conditionneT);
  const formats = cfg.bottleTypes.map((b) => ({ label: b.label, value: aCur.byBottle[b.id]?.t ?? 0, sub: `${fmt(aCur.byBottle[b.id]?.n ?? 0)} u.` })).filter((f) => f.value > 0);
  const share = aCur.cumulSortieT ? (aCur.conditionneT / aCur.cumulSortieT) * 100 : 0;
  return (
    <>
      <Stats>
        <Stat label="Total" value={fmt(aCur.conditionneT, 1)} unit="T" sub={<Delta value={delta(aCur.conditionneT, aPrev.conditionneT)} />} />
        <Stat label="Moyenne par jour" value={fmt(aCur.days ? aCur.conditionneT / aCur.days : 0, 1)} unit="T" sub={`${aCur.days} jour${aCur.days > 1 ? "s" : ""} clôturé${aCur.days > 1 ? "s" : ""}`} />
        <Stat label="Meilleur jour" value={fmt(top?.a.conditionneT ?? 0, 1)} unit="T" sub={top ? dayLabel(top.date) : "—"} />
        <Stat label="Sorti en vrac" value={fmt(aCur.vracT, 1)} unit="T" sub={`Conditionné : ${fmt(share, 0)} % des sorties`} />
      </Stats>
      <div className="mt-4 gap-4">
        <Panel title="Tonnage conditionné par jour" sub="Journées clôturées">
          <TrendChart className="h-65" data={rows.map((d) => ({ date: d.date, v: d.a.conditionneT }))} series={[{ key: "v", label: "Conditionné" }]} unit="T" label="Tonnage conditionné par jour" />
        </Panel>
        {/* <Panel title="Par format">
          {formats.length ? <Breakdown items={formats} unit="T" centerLabel="conditionnées" /> : <p className="text-[14px] text-muted">Aucun conditionnement sur la période.</p>}
        </Panel> */}
      </div>
      <Footer href="/analyses" label="Voir les analyses" />
    </>
  );
}

/* ---------------- Rendement horaire ---------------- */

export function RendementDetail({ history, cur, aCur, aPrev }: KpiProps) {
  const rows = closedIn(history, chartRange(cur));
  // Installed capacity of the day, read back from the share of it the day reached.
  let lastCap = 0;
  const data = rows.map((d) => {
    if (d.a.capacityPct > 0) lastCap = (d.a.rendementTph * 100) / d.a.capacityPct;
    return { date: d.date, v: d.a.rendementTph, cap: lastCap };
  });
  const stops = Object.entries(aCur.stopsByType).sort((a, b) => b[1] - a[1]);
  const main = stops.slice(0, 5);
  const rest = stops.slice(5).reduce((a, [, m]) => a + m, 0);
  const items = [...main.map(([label, value]) => ({ label, value })), ...(rest ? [{ label: "Autres", value: rest, color: "var(--faint)" }] : [])];
  return (
    <>
      <Stats>
        <Stat label="Rendement moyen" value={fmt(aCur.rendementTph, 1)} unit="T/h" sub={<Delta value={delta(aCur.rendementTph, aPrev.rendementTph)} />} />
        <Stat label="Capacité utilisée" value={fmt(aCur.capacityPct, 0)} unit="%" sub="De la capacité installée des lignes" />
        <Stat label="Temps utile" value={fmt((aCur.totalMin - aCur.stopMin) / 60, 1)} unit="h" sub={`Sur ${fmt(aCur.totalMin / 60, 1)} h de production de jour`} />
        <Stat label="Arrêts" value={fmt(aCur.stopMin / 60, 1)} unit="h" sub={stops[0] ? `Surtout : ${stops[0][0]}` : "Aucun arrêt"} />
      </Stats>
      <Panel className="mt-4" title="Rendement par jour" sub="Pointillés : capacité installée des lignes en service">
        <TrendChart
          className="h-[240px]"
          data={data}
          series={[
            { key: "v", label: "Rendement" },
            { key: "cap", label: "Capacité", dashed: true },
          ]}
          unit="T/h"
          label="Rendement horaire par jour"
        />
      </Panel>
      {/* <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Panel title="Temps de production">
          <TimeRings totalMin={aCur.totalMin} utileMin={aCur.totalMin - aCur.stopMin} />
        </Panel>
        <Panel title="Arrêts par cause" sub="Minutes cumulées sur la période">
          {items.length ? <Breakdown variant="pie" unit="min" decimals={0} items={items} /> : <p className="text-[14px] text-muted">Aucun arrêt sur la période.</p>}
        </Panel>
      </div> */}
      <Footer href="/analyses" label="Voir les analyses" />
    </>
  );
}

/* ---------------- Écart moyen ---------------- */

export function EcartDetail({ history, cur, aCur, aPrev, cfg, invs, centreOf }: KpiProps & { invs: Inventory[]; centreOf: (id: string) => Centre }) {
  const rows = closedIn(history, chartRange(cur));
  const warn = cfg.rules.ecartWarn;
  const days = useMemo(
    () =>
      invs
        .filter((i) => i.status === "TERMINE" && inRange(i.date, cur))
        .map((i) => {
          const s = summarize(i, centreOf(i.centreId), cfg);
          return { inv: i, pct: s.ecartPct, t: s.ecart, band: ecartBand(s.ecartPct, cfg.rules) };
        }),
    [invs, cur, cfg, centreOf],
  );
  const count = (b: string) => days.filter((d) => d.band === b).length;
  const worst = [...days].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 5);
  return (
    <>
      <Stats>
        <Stat label="Écart moyen" value={fmt(aCur.meanAbsEcart, 2)} unit="%" sub={<Delta value={delta(aCur.meanAbsEcart, aPrev.meanAbsEcart)} invert />} />
        <Stat label="Écart cumulé" value={`${aCur.ecartT >= 0 ? "+" : "−"}${fmt(Math.abs(aCur.ecartT), 1)}`} unit="T" sub={`Sur ${aCur.days} jour${aCur.days > 1 ? "s" : ""}`} />
        <Stat label="Écarts maîtrisés" value={fmt(count("ok"))} unit={`/ ${days.length}`} sub={`À ${fmt(cfg.rules.ecartOk, 2)} % ou moins`} />
        <Stat label="À surveiller ou justifier" value={fmt(count("warn") + count("alert"))} sub={`Dont ${count("alert")} au-delà de ${fmt(warn, 2)} %`} />
      </Stats>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Écart par jour" sub={`Pointillés : seuil à justifier, ± ${fmt(warn, 2)} %`}>
          <TrendChart
            className="h-[260px]"
            data={rows.map((d) => ({ date: d.date, v: d.ecartPct, hi: warn, lo: -warn }))}
            series={[
              { key: "v", label: "Écart" },
              { key: "hi", label: "Seuil haut", dashed: true },
              { key: "lo", label: "Seuil bas", dashed: true },
            ]}
            unit="%"
            decimals={2}
            label="Écart entre stock physique et théorique par jour"
          />
        </Panel>
        <Panel title="Écarts les plus forts">
          {worst.length ? (
            <ul>
              {worst.map(({ inv, pct, t, band }) => (
                <li key={inv.id}>
                  <Link href={`/inventaires/${inv.id}`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-card">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{dayLabel(inv.date)}</span>
                      <span className="tnum block truncate text-[12px] text-muted">
                        {invCode(inv.date)}, {t >= 0 ? "+" : "−"}
                        {fmt(Math.abs(t), 1)} T
                      </span>
                    </span>
                    <EcartPill pct={pct} band={band} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-muted">Aucun inventaire clôturé sur la période.</p>
          )}
        </Panel>
      </div>
      <Footer href="/inventaires" label="Voir les inventaires" />
    </>
  );
}

/* ---------------- Production des 7 derniers jours ---------------- */

export function WeekDetail({ history, week, today, cfg }: { history: DayPoint[]; week: BarDatum[]; today: string; cfg: TenantConfig }) {
  const byDate = new Map(history.map((d) => [d.date, d]));
  const dates = Array.from({ length: 7 }, (_, k) => back(today, 7 - k));
  const sum = (r: [string, string]) => closedIn(history, r).reduce((a, d) => a + d.a.conditionneT, 0);
  const cur = sum([dates[0], today]);
  const prev = sum([back(dates[0], 8), back(dates[0], 2)]);
  const produced = dates.filter((d) => byDate.get(d)?.a.conditionneT).length;
  const closedDays = closedIn(history, [dates[0], today]);
  return (
    <>
      <Stats>
        <Stat label="Conditionné sur 7 jours" value={fmt(cur, 1)} unit="T" sub={<Delta value={delta(cur, prev)} />} />
        <Stat label="Moyenne par jour clôturé" value={fmt(closedDays.length ? cur / closedDays.length : 0, 1)} unit="T" />
        <Stat label="Bouteilles" value={fmt(closedDays.reduce((a, d) => a + d.a.bottlesN, 0))} unit="bt" sub="Journées clôturées" />
        <Stat label="Jours produits" value={fmt(produced)} unit="/ 7" />
      </Stats>
      <Panel className="mt-4" title="Tonnage conditionné" sub="Hachuré : journée en cours ou sans production.">
        <div className="h-[260px]">
          <WeekBars data={week} />
        </div>
      </Panel>
      {/* <div className="mt-4 overflow-x-auto rounded-2xl bg-board p-2">
        <table className="w-full min-w-[560px] text-[14px]">
          <thead>
            <tr className="text-left text-[12px] text-muted">
              <th className="px-3 py-2 font-medium">Jour</th>
              <th className="px-3 py-2 text-right font-medium">Bouteilles</th>
              <th className="px-3 py-2 text-right font-medium">Conditionné</th>
              <th className="px-3 py-2 text-right font-medium">Rendement</th>
              <th className="px-3 py-2 text-right font-medium">Écart</th>
            </tr>
          </thead>
          <tbody>
            {[...dates].reverse().map((date) => {
              const d = byDate.get(date);
              const href = d?.ids.length === 1 ? `/inventaires/${d.ids[0]}` : undefined;
              const name = dayLabel(date);
              return (
                <tr key={date} className="border-t border-line">
                  <td className="px-3 py-2.5 font-medium">
                    {href ? (
                      <Link href={href} className="hover:text-brand-ink hover:underline">
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                  </td>
                  {d ? (
                    <>
                      <td className="tnum px-3 py-2.5 text-right">{fmt(d.a.bottlesN)}</td>
                      <td className="tnum px-3 py-2.5 text-right">{fmt(d.a.conditionneT, 1)} T</td>
                      <td className="tnum px-3 py-2.5 text-right">{fmt(d.a.rendementTph, 1)} T/h</td>
                      <td className="px-3 py-2.5 text-right">{d.open ? <StatusBadge status="EN_COURS" /> : <EcartPill pct={d.ecartPct} band={ecartBand(d.ecartPct, cfg.rules)} />}</td>
                    </>
                  ) : (
                    <td colSpan={4} className="px-3 py-2.5 text-right text-muted">
                      Pas de production
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div> */}
    </>
  );
}

/* ---------------- Réservoirs ---------------- */

function SpanSwitch({ value, onChange }: { value: Span; onChange: (s: Span) => void }) {
  return <Segmented options={SPANS} value={value} onChange={onChange} label="Période du graphique" />;
}

const spanRows = (history: DayPoint[], span: Span) => {
  const end = history[history.length - 1]?.date;
  return end ? history.filter((d) => d.date >= back(end, SPAN_DAYS[span])) : [];
};

function TankDrawing({ type, pct }: { type: Reservoir["type"]; pct: number }) {
  const kind = tankKind(type);
  return (
    <div className="flex h-[190px] items-end justify-center py-2">
      {kind ? (
        <TankIllustration type={kind} fill={pct / 100} className="max-w-full" style={{ height: `${(TANK_GEOMETRY[kind].viewBox.h / TANK_REF_HEIGHT) * 100}%` }} />
      ) : (
        <Container className="size-14 self-center text-faint" aria-hidden />
      )}
    </div>
  );
}

export function ReservoirsDetail({
  tanks,
  history,
  invs,
  centres,
  cfg,
  initial,
}: {
  tanks: TankStock[];
  history: DayPoint[];
  invs: Inventory[];
  centres: Centre[];
  cfg: TenantConfig;
  initial?: string;
}) {
  const [[index, dir], setIndex] = useState<[number, number]>(() => [Math.max(tanks.findIndex((t) => t.key === initial), 0), 0]);
  const [span, setSpan] = useState<Span>("mois");
  const go = (i: number) => i >= 0 && i < tanks.length && setIndex([i, i > index ? 1 : -1]);

  const tank = tanks[index];
  const where = useMemo(() => {
    const m = new Map<string, { c: Centre; r: Reservoir }>();
    for (const c of centres) for (const r of c.reservoirs) m.set(`${c.id}-${r.id}`, { c, r });
    return m;
  }, [centres]);

  if (!tank) return <p className="text-[14px] text-muted">Aucune mesure de réservoir pour le moment.</p>;
  const { c, r } = where.get(tank.key)!;
  // The latest inventory with a reading for this tank, and what it gave.
  const last = [...invs].sort((a, b) => (a.date < b.date ? 1 : -1)).find((i) => i.centreId === c.id && i.tanks[r.id]);
  const reading = last?.tanks[r.id];
  const outcome = last ? tankOutcomes(last, c, cfg)[r.id] : undefined;
  const result = outcome && !outcome.blocked ? outcome : undefined;

  const rows = spanRows(history, span).filter((d) => d.tanks[tank.key]);
  const values = rows.map((d) => d.tanks[tank.key].t);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const change = values.length > 1 ? values[values.length - 1] - values[0] : 0;

  const facts: [string, string][] = [
    ["Hauteur", reading ? `${fmt(reading.heightMm)} mm` : "—"],
    ["Volume liquide", reading ? `${fmt(reading.volLiqM3, 1)} m³` : "—"],
    ["Température liquide", reading ? `${fmt(reading.tLiq, 1)} °C` : "—"],
    ["Température vapeur", reading ? `${fmt(reading.tVap, 1)} °C` : "—"],
    ["Pression", reading ? `${fmt(reading.pressureBar, 2)} bar` : "—"],
    ["Densité à 15 °C", reading ? fmt(reading.d15, 3) : "—"],
    ["Phase gazeuse", result ? `${fmt(result.gasT, 2)} T` : "—"],
    ["Poids total", result ? `${fmt(result.totalT, 1)} T` : "—"],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="no-scrollbar flex min-w-0 gap-1.5 overflow-x-auto" role="tablist" aria-label="Réservoirs">
          {tanks.map((t, i) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={i === index}
              onClick={() => go(i)}
              className={cn("h-8 shrink-0 rounded-full px-3.5 text-[13px] font-medium transition-colors", i === index ? "bg-brand-800 text-white" : "bg-board text-muted hover:text-ink")}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Réservoir précédent" className="grid size-8 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-brand-50 hover:text-ink disabled:pointer-events-none disabled:opacity-35">
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" onClick={() => go(index + 1)} disabled={index === tanks.length - 1} aria-label="Réservoir suivant" className="grid size-8 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-brand-50 hover:text-ink disabled:pointer-events-none disabled:opacity-35">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={tank.key}
            custom={dir}
            variants={{
              enter: (d: number) => ({ x: d * 48, opacity: 0 }),
              center: { x: 0, opacity: 1 },
              exit: (d: number) => ({ x: d * -48, opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.32, ease: [0.2, 0.9, 0.25, 1] }}
            role="tabpanel"
            aria-label={tank.name}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") go(index + 1);
              if (e.key === "ArrowLeft") go(index - 1);
            }}
            className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]"
          >
            <div className="flex flex-col gap-4 rounded-2xl bg-board p-4">
              <TankLevel name={tank.name} pct={tank.pct} tonnes={tank.t} capT={tank.capT} capM3={r.capacityM3}>
                <TankDrawing type={tank.type} pct={tank.pct} />
              </TankLevel>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px] rounded-xl bg-card p-2 px-4">
                {facts.map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="truncate text-muted">{k}</dt>
                    <dd className="tnum font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-[12px] text-muted">{last ? `Dernière mesure : ${dayLabel(last.date)}` : "N/A"}</p>
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <Panel title="Évolution du stock" sub="Poids liquide corrigé, une mesure par jour" action={<SpanSwitch value={span} onChange={setSpan} />} className="flex-1">
                <TrendChart
                  key={`${tank.key}-${span}`}
                  className="min-h-[260px] flex-1"
                  data={rows.map((d) => ({ date: d.date, v: d.tanks[tank.key].t, cap: tank.capT }))}
                  series={[
                    { key: "v", label: "Stock" },
                    { key: "cap", label: "Capacité", dashed: true },
                  ]}
                  unit="T"
                  label={`Évolution du stock de ${tank.name}`}
                />
              </Panel>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Minimum" value={fmt(min, 1)} unit="T" />
                <Stat label="Maximum" value={fmt(max, 1)} unit="T" />
                <Stat label="Moyenne" value={fmt(mean, 1)} unit="T" />
                <Stat label="Variation" value={`${change >= 0 ? "+" : "−"}${fmt(Math.abs(change), 1)}`} unit="T" />
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---------------- Stock physique ---------------- */

export function StockDetail({ history, tanks, phys, capT, pct }: { history: DayPoint[]; tanks: TankStock[]; phys: number; capT: number; pct: number }) {
  const [span, setSpan] = useState<Span>("mois");
  const rows = spanRows(history, span);
  const lastDay = history[history.length - 1];
  // Cover: the stock against the average daily outflow of the last 30 closed days.
  const recent = lastDay ? closedIn(history, [back(lastDay.date, 30), lastDay.date]) : [];
  const outflow = recent.length ? recent.reduce((a, d) => a + d.a.cumulSortieT, 0) / recent.length : 0;
  const gap = lastDay ? lastDay.stockPhys - lastDay.stockTheo : 0;
  return (
    <>
      <Stats>
        <Stat label="Stock physique" value={fmt(phys, 1)} unit="T" sub={`${fmt(pct, 0)} % de ${fmt(capT, 0)} T`} />
        <Stat label="Creux disponible" value={fmt(Math.max(capT - phys, 0), 1)} unit="T" sub="Place pour un approvisionnement" />
        <Stat label="Autonomie" value={outflow ? fmt(phys / outflow, 1) : "—"} unit="jours" sub={`Au rythme de ${fmt(outflow, 1)} T sorties par jour`} />
        <Stat label="Écart au théorique" value={`${gap >= 0 ? "+" : "−"}${fmt(Math.abs(gap), 1)}`} unit="T" sub="Dernière journée saisie" />
      </Stats>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Évolution du stock" sub="Pointillés : stock théorique" action={<SpanSwitch value={span} onChange={setSpan} />}>
          <TrendChart
            key={span}
            className="h-[280px]"
            data={rows.map((d) => ({ date: d.date, v: d.stockPhys, theo: d.stockTheo }))}
            series={[
              { key: "v", label: "Physique" },
              { key: "theo", label: "Théorique", dashed: true },
            ]}
            unit="T"
            label="Évolution du stock physique et théorique"
          />
        </Panel>
        <Panel title="Par réservoir">
          {tanks.length ? <Breakdown items={tanks.map((t) => ({ label: t.name, value: t.t, sub: `${fmt(t.pct, 0)} %` }))} unit="T" centerLabel="en stock" /> : <p className="text-[14px] text-muted">Aucune mesure de réservoir.</p>}
        </Panel>
      </div>
    </>
  );
}
