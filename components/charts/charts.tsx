"use client";

import { useMemo, useState } from "react";
import { ParentSize } from "@visx/responsive";
import NumberFlow from "@number-flow/react";
import { cn, fmt } from "@/lib/format";
import { Area, AreaChart } from "./bklit/area-chart";
import { Bar } from "./bklit/bar";
import { BarChart } from "./bklit/bar-chart";
import { BarXAxis } from "./bklit/bar-x-axis";
import { Gauge } from "./bklit/gauge";
import { Grid } from "./bklit/grid";
import { PieCenter } from "./bklit/pie-center";
import { PieChart } from "./bklit/pie-chart";
import { PieSlice } from "./bklit/pie-slice";
import { Ring } from "./bklit/ring";
import { RingCenter } from "./bklit/ring-center";
import { RingChart } from "./bklit/ring-chart";
import { ChartTooltip, TooltipContent } from "./bklit/tooltip";
import { PatternLines } from "./bklit/visx-pattern";
import { XAxis } from "./bklit/x-axis";

/*
 * App charts, built on Bklit UI (vendored in ./bklit) and dressed in the
 * Jauge language: pill-shaped bars, hatching for "not closed yet", smooth
 * monotone curves, brand-derived colours, French formatting.
 */

/** Bklit's signature ease: slow in, fast middle, slow settle. */
const EASE = "cubic-bezier(0.85, 0, 0.15, 1)";
const SHADES = ["var(--b-950)", "var(--b-800)", "var(--b-600)", "var(--b-400)", "var(--b-200)", "#d9a441", "#9aa39e"];

function Hatch({ id }: { id: string }) {
  return <PatternLines id={id} width={7} height={7} orientation={["diagonal"]} stroke="var(--hatch)" strokeWidth={1.6} background="var(--card)" />;
}

/** A number that rolls to its new value, in French formatting. */
export function AnimatedNumber({ value, decimals = 0, suffix, className }: { value: number; decimals?: number; suffix?: string; className?: string }) {
  return (
    <NumberFlow
      className={cn("tnum", className)}
      locales="fr-FR"
      format={{ minimumFractionDigits: decimals, maximumFractionDigits: decimals }}
      suffix={suffix}
      value={Number.isFinite(value) ? value : 0}
    />
  );
}

/* ------------------------------------------------------------------
   Weekly bars: solid = closed day, hatched = not closed yet / no data.
   The best closed day is the darkest. Hovering a day dims the others.
   ------------------------------------------------------------------ */
export interface BarDatum {
  label: string;
  full: string;
  value: number; // tonnes
  state: "closed" | "open" | "empty";
}

export function WeekBars({ data, unit = "T" }: { data: BarDatum[]; unit?: string }) {
  const rows = useMemo(() => {
    const closed = data.filter((d) => d.state === "closed");
    const avg = closed.length ? closed.reduce((a, d) => a + d.value, 0) / closed.length : Math.max(...data.map((d) => d.value), 1);
    const rank = new Map([...closed].sort((a, b) => b.value - a.value).map((d, k) => [d.full, k]));
    return data.map((d) => {
      const r = rank.get(d.full);
      const tone = d.state !== "closed" ? "var(--b-400)" : r === 0 ? "var(--b-950)" : r != null && r <= 2 ? "var(--b-800)" : "var(--b-400)";
      return {
        ...d,
        tone,
        // Solid pill: what was produced. Missing on a day without production.
        solid: d.state === "empty" || d.value <= 0 ? undefined : d.value,
        // Hatched pill behind it: the typical day, for days not closed yet.
        target: d.state === "closed" ? undefined : Math.max(avg, d.value * 1.15),
      };
    });
  }, [data]);
  const today = data.find((d) => d.state === "open")?.label;

  return (
    <div className="relative h-full">
      <BarChart
        data={rows}
        xDataKey="label"
        aspectRatio="auto"
        className="h-full"
        margin={{ top: 8, right: 0, bottom: 34, left: 0 }}
        barGap={0.3}
        animationDuration={1100}
        animationEasing={EASE}
      >
        <Hatch id="week-hatch" />
        <Grid horizontal numTicksRows={4} hideHorizontalEdgeLines />
        <Bar dataKey="target" overlay lineCap="pill" fill="url(#week-hatch)" stroke="var(--hatch)" fadedOpacity={0.3} />
        <Bar dataKey="solid" overlay lineCap="pill" fill={(d) => String(d.tone)} stroke="var(--b-800)" fadedOpacity={0.3} />
        <BarXAxis labelClassName={(l) => (l === today ? "font-semibold text-ink" : undefined)} />
        <ChartTooltip
          showCrosshair={false}
          showDots={false}
          content={({ point }) => {
            const d = point as (typeof rows)[number];
            const value = d.state === "empty" ? "Pas de production" : `${fmt(d.value, 1)} ${unit}`;
            return (
              <TooltipContent
                title={d.full}
                rows={[{ color: d.state === "closed" ? "var(--b-400)" : "var(--hatch)", label: d.state === "open" ? "En cours" : d.state === "empty" ? "Journée" : "Conditionné", value }]}
              />
            );
          }}
        />
      </BarChart>
      <ul className="sr-only">
        {data.map((d) => (
          <li key={d.full}>
            {d.full} : {d.state === "empty" ? "pas de production" : `${fmt(d.value, 1)} ${unit}${d.state === "open" ? ", en cours" : ""}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------
   Forecast vs actual: the forecast is a hatched pill (planned), what
   happened a solid pill in front of it. Future periods show the hatch only.
   ------------------------------------------------------------------ */
export interface ForecastDatum {
  label: string;
  full: string;
  forecast: number;
  actual: number | null; // null: period not over yet
}

export function ForecastBars({ data, unit = "bt" }: { data: ForecastDatum[]; unit?: string }) {
  const rows = useMemo(
    () =>
      data.map((d) => ({
        ...d,
        plan: d.forecast > 0 ? d.forecast : undefined,
        done: d.actual != null && d.actual > 0 ? d.actual : undefined,
        tone: d.actual == null ? "var(--b-400)" : d.actual >= d.forecast * 0.95 ? "var(--b-800)" : "var(--b-600)",
      })),
    [data],
  );
  const current = data.find((d) => d.actual == null)?.label;
  const row = (v: number | null) => (v == null ? "À venir" : `${fmt(v)} ${unit}`);
  return (
    <div className="relative h-full overflow-x-clip">
      <BarChart data={rows} xDataKey="label" aspectRatio="auto" className="h-full" margin={{ top: 8, right: 0, bottom: 34, left: 0 }} barGap={0.3} animationDuration={1100} animationEasing={EASE}>
        <Hatch id="fc-hatch" />
        <Grid horizontal numTicksRows={4} hideHorizontalEdgeLines />
        <Bar dataKey="plan" overlay lineCap="pill" fill="url(#fc-hatch)" stroke="var(--hatch)" fadedOpacity={0.3} />
        <Bar dataKey="done" overlay lineCap="pill" fill={(d) => String(d.tone)} stroke="var(--b-800)" fadedOpacity={0.3} />
        <BarXAxis labelClassName={(l) => (l === current ? "font-semibold text-ink" : undefined)} />
        <ChartTooltip
          showCrosshair={false}
          showDots={false}
          content={({ point }) => {
            const d = point as (typeof rows)[number];
            return (
              <TooltipContent
                title={d.full}
                rows={[
                  { color: "var(--hatch)", label: "Prévision", value: `${fmt(d.forecast)} ${unit}` },
                  { color: "var(--b-400)", label: "Réalisé", value: row(d.actual) },
                ]}
              />
            );
          }}
        />
      </BarChart>
      <ul className="sr-only">
        {data.map((d) => (
          <li key={d.full}>
            {d.full} : prévision {fmt(d.forecast)} {unit}, réalisé {row(d.actual)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------
   Tank fill: notched half gauge, solid stock over hatch-tinted headspace.
   ------------------------------------------------------------------ */
export function SemiGauge({ pct, children }: { pct: number; children?: React.ReactNode }) {
  const p = Math.min(Math.max(pct, 0), 100);
  return (
    <div className="relative mx-auto w-full max-w-[280px]">
      {/* The arc sits in the top half of a square; show only that half. */}
      <div className="relative aspect-[2/1.08] overflow-hidden" aria-hidden>
        <div className="absolute inset-x-0 top-[-15%] aspect-square">
          <ParentSize debounceTime={10}>
            {({ width }) =>
              width > 0 ? (
                <Gauge
                  width={width}
                  height={width}
                  value={p}
                  startAngle={180}
                  endAngle={360}
                  totalNotches={28}
                  spacing={34}
                  notchCornerRadius={3}
                  uniformWidth
                  activeFill="var(--b-800)"
                  inactiveFill="var(--hatch)"
                  inactiveFillOpacity={0.55}
                />
              ) : null
            }
          </ParentSize>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-1 text-center">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Part-of-whole breakdown: a donut (or a full pie) beside its legend,
   hover synced both ways. Stacks vertically when its card is narrow.
   ------------------------------------------------------------------ */
export function Breakdown({
  items,
  variant = "donut",
  centerLabel,
  unit,
  decimals = 1,
}: {
  items: { label: string; value: number; sub?: string; color?: string }[];
  variant?: "donut" | "pie";
  centerLabel?: string;
  unit: string;
  decimals?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  const data = items.map((it, i) => ({ label: it.label, value: it.value, color: it.color ?? SHADES[i % SHADES.length] }));
  const pie = variant === "pie";
  const shown = active == null ? null : items[active];

  return (
    <div className="@container">
      <div className="flex flex-col items-center gap-6 @md:flex-row">
        <div className="relative shrink-0">
          <PieChart
            data={data}
            size={176}
            innerRadius={pie ? 0 : 56}
            padAngle={0}
            cornerRadius={0}
            hoverOffset={pie ? 8 : 6}
            hoveredIndex={active}
            onHoverChange={setActive}
          >
            {data.map((d, i) => (
              <PieSlice key={d.label} index={i} hoverEffect={pie ? "translate" : "grow"} showGlow={false} />
            ))}
            {!pie && (
              <PieCenter>
                {({ value, isHovered }) => (
                  <div className="text-center">
                    <p className="text-[20px] leading-none font-semibold tracking-[-0.02em]">
                      <AnimatedNumber value={value} decimals={isHovered ? decimals : 0} />
                      <span className="text-[13px] font-medium text-muted"> {unit}</span>
                    </p>
                    <p className="mt-1 text-[12px] text-muted">
                      {isHovered ? <AnimatedNumber value={(value / total) * 100} decimals={1} suffix=" %" /> : centerLabel}
                    </p>
                  </div>
                )}
              </PieCenter>
            )}
          </PieChart>
          {pie && (
            // A pie has no hole, so the hovered share reads out underneath.
            <p className="tnum pointer-events-none absolute inset-x-0 -bottom-5 text-center text-[12px] text-muted transition-opacity duration-200" style={{ opacity: shown ? 1 : 0 }}>
              {shown ? `${fmt((shown.value / total) * 100, 1)} %` : " "}
            </p>
          )}
        </div>
        <ul className="w-full space-y-1">
          {items.map((it, i) => (
            <li key={it.label}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[14px] transition-[background-color,opacity] duration-200",
                  active === i ? "bg-board" : active != null && "opacity-50",
                )}
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: data[i].color }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.sub && <span className="tnum text-[12px] text-faint">{it.sub}</span>}
                <b className="tnum shrink-0 text-right font-medium">
                  {fmt(it.value, decimals)} {unit}
                </b>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Donut({ items, centerLabel, unit = "T" }: { items: { label: string; value: number; sub?: string }[]; centerLabel: string; unit?: string }) {
  return <Breakdown items={items} centerLabel={centerLabel} unit={unit} />;
}

/* ------------------------------------------------------------------
   Production time: one ring filled with the useful share of the total.
   The centre reads the total hours, or the useful hours on hover.
   ------------------------------------------------------------------ */
export function TimeRings({ totalMin, utileMin }: { totalMin: number; utileMin: number }) {
  const total = Math.max(totalMin, 0);
  const utile = Math.min(Math.max(utileMin, 0), total);
  const h = (m: number) => m / 60;
  const rings = [{ label: "Temps utile", value: h(utile), maxValue: Math.max(h(total), 0.01), color: "var(--b-800)" }];
  const pct = total ? (utile / total) * 100 : 0;

  return (
    <div className="mx-auto aspect-square w-full max-w-[220px]">
      <RingChart data={rings} strokeWidth={24} ringGap={0} baseInnerRadius={104}>
        <Ring index={0} lineCap="round" showGlow={false} />
        <RingCenter>
          {({ data }) => (
            <div className="text-center">
              <p className="text-[26px] leading-none font-semibold tracking-[-0.03em]">
                <AnimatedNumber value={data ? data.value : h(total)} decimals={1} suffix=" h" />
              </p>
              <p className="tnum mt-1.5 text-[12px] text-muted">
                {data ? "de temps utile" : <>de production <br /> (<AnimatedNumber value={pct} decimals={0} suffix=" %" /> utile)</>}
              </p>
            </div>
          )}
        </RingCenter>
      </RingChart>
    </div>
  );
}

/* ------------------------------------------------------------------
   Production over the period vs the previous one. Smooth curves, a soft
   area under the current period, the previous one dashed.
   ------------------------------------------------------------------ */
export function LineChart({
  current,
  previous,
  dates,
  unit = "T",
}: {
  current: number[];
  previous: number[];
  dates: string[]; // yyyy-mm-dd, one per point
  unit?: string;
}) {
  const data = useMemo(
    () => dates.map((d, i) => ({ date: new Date(`${d}T12:00:00`), cur: current[i] ?? 0, prev: previous[i] ?? 0 })),
    [dates, current, previous],
  );
  const row = (v: unknown) => `${fmt(Number(v) || 0, 1)} ${unit}`;

  return (
    <div role="img" aria-label={`Production de la période, ${fmt(current.reduce((a, b) => a + b, 0), 1)} ${unit} au total`}>
      <AreaChart data={data} aspectRatio="3 / 1" className="min-h-[220px]" margin={{ top: 16, right: 8, bottom: 34, left: 8 }} animationDuration={1100} animationEasing={EASE}>
        <Grid horizontal numTicksRows={4} hideHorizontalEdgeLines />
        <Area dataKey="prev" stroke="var(--faint)" fill="var(--faint)" fillOpacity={0} strokeWidth={1.6} dashFromIndex={0} dashArray="5,5" showHighlight={false} />
        <Area dataKey="cur" stroke="var(--b-800)" fill="var(--b-600)" fillOpacity={0.24} strokeWidth={2.4} />
        <XAxis numTicks={6} />
        <ChartTooltip
          dotVariant="ring"
          dotRadiusFraction={0.5}
          dotColor={(_, line) => (line.dataKey === "cur" ? "var(--b-800)" : "var(--faint)")}
          rows={(p) => [
            { color: "var(--b-400)", label: "Période", value: row(p.cur) },
            { color: "var(--faint)", label: "Précédente", value: row(p.prev) },
          ]}
        />
      </AreaChart>
    </div>
  );
}

/* ------------------------------------------------------------------
   KPI sparkline: smooth area, no chrome.
   ------------------------------------------------------------------ */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const data = useMemo(() => values.map((v, i) => ({ date: new Date(2026, 0, i + 1), v })), [values]);
  return (
    <div className={cn("h-9 w-full", className)} aria-hidden>
      <AreaChart data={data} aspectRatio="auto" className="h-full" margin={{ top: 3, right: 0, bottom: 3, left: 0 }} animationDuration={900} animationEasing={EASE}>
        <Area dataKey="v" stroke="var(--b-800)" fill="var(--b-400)" fillOpacity={0.35} strokeWidth={1.6} showHighlight={false} />
      </AreaChart>
    </div>
  );
}
