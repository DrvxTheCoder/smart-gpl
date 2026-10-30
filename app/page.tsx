"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, Plus } from "@/components/ui/icons";
import { useScopedInventories, useStore } from "@/lib/store";
import { aggregate, delta, inRange, periodRange, PERIODS, type PeriodKey } from "@/lib/aggregate";
import { ecartBand, summarize, tankOutcomes } from "@/lib/calc";
import { iso } from "@/lib/seed";
import { cap, fmt, fmtDate, invCode } from "@/lib/format";
import { Button, ButtonLink, Card, CardTitle, EcartPill, Segmented, StatusBadge } from "@/components/ui/primitives";
import { ExpandButton, Expandable } from "@/components/ui/expandable";
import { AnimatedNumber, SemiGauge, WeekBars, type BarDatum } from "@/components/charts/charts";
import { LiveTimerCard } from "@/components/production/production";
import { ReservoirsCard, type TankStock } from "@/components/tanks/ReservoirsCard";
import { BottlesDetail, EcartDetail, RendementDetail, ReservoirsDetail, StockDetail, TonnageDetail, useHistory, WeekDetail } from "@/components/dashboard/details";
import { DemandCard } from "@/components/sales/demand-card";

function Trend({ value, invert, dark }: { value: number | null; invert?: boolean; dark?: boolean }) {
  if (value == null) return <span className={dark ? "text-white/70" : "text-muted"}>Pas de période de comparaison</span>;
  const good = invert ? value <= 0 : value >= 0;
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={
          "tnum inline-flex h-5 items-center rounded-md border px-1.5 text-[11px] font-semibold " +
          (dark ? "border-white/35 text-white" : good ? "border-ok/40 text-ok" : "border-alert/40 text-alert")
        }
      >
        {value >= 0 ? "▲" : "▼"} {fmt(Math.abs(value), 1)} %
      </span>
      <span className={dark ? "text-white/80" : "text-muted"}>vs période précédente</span>
    </span>
  );
}

export default function Dashboard() {
  const { config, centre, centreId, toast } = useStore();
  const invs = useScopedInventories();
  const [period, setPeriod] = useState<PeriodKey>("mois");
  const today = iso(new Date());

  const { cur, prev, aCur, aPrev } = useMemo(() => {
    const r = periodRange(period);
    // "Jour" = the last closed day, so the figure is complete
    const lastClosed = invs.find((i) => i.status === "TERMINE")?.date ?? today;
    const curR: [string, string] = period === "jour" ? [lastClosed, lastClosed] : r.cur;
    const prevClosed = invs.find((i) => i.status === "TERMINE" && i.date < lastClosed)?.date ?? lastClosed;
    const prevR: [string, string] = period === "jour" ? [prevClosed, prevClosed] : r.prev;
    return {
      cur: curR,
      prev: prevR,
      aCur: aggregate(invs.filter((i) => inRange(i.date, curR)), config, centre),
      aPrev: aggregate(invs.filter((i) => inRange(i.date, prevR)), config, centre),
    };
  }, [invs, period, config, centre, today]);

  const scopeCentres = centreId === "all" ? config.centres : [centre(centreId)];
  const focusCentre = scopeCentres[0];
  const todayInv = invs.find((i) => i.date === today && i.status === "EN_COURS" && i.centreId === focusCentre.id) ?? invs.find((i) => i.status === "EN_COURS");

  // Last 7 days of conditioned tonnage
  const week: BarDatum[] = useMemo(() => {
    const out: BarDatum[] = [];
    const t = new Date();
    for (let k = 6; k >= 0; k--) {
      const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() - k);
      const day = iso(d);
      const list = invs.filter((i) => i.date === day);
      const value = list.reduce((a, i) => a + summarize(i, centre(i.centreId), config).conditionneT, 0);
      out.push({
        label: cap(new Intl.DateTimeFormat("fr-FR", { weekday: "short" }).format(d)).replace(".", ""),
        full: cap(new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(d)),
        value,
        state: list.length === 0 ? "empty" : list.some((i) => i.status === "EN_COURS") ? "open" : "closed",
      });
    }
    return out;
  }, [invs, centre, config]);

  // Latest physical stock per centre in scope
  const stock = useMemo(() => {
    let phys = 0;
    let capT = 0;
    const tanks: TankStock[] = [];
    const blocked: string[] = [];
    let warned = 0;
    for (const c of scopeCentres) {
      const last = invs.find((i) => i.centreId === c.id);
      if (!last) continue;
      const results = tankOutcomes(last, c, config);
      for (const res of c.reservoirs) {
        const tr = results[res.id];
        if (!tr) continue;
        if (tr.warnings.length) warned++;
        if (tr.blocked) {
          blocked.push(res.name);
          continue;
        }
        phys += tr.liquidT;
        capT += res.capacityT;
        tanks.push({ key: `${c.id}-${res.id}`, name: scopeCentres.length > 1 ? `${res.name}, ${c.code}` : res.name, type: res.type, pct: tr.fillPct, t: tr.liquidT, capT: res.capacityT, capM3: res.capacityM3 });
      }
    }
    return { phys, capT, pct: capT ? (phys / capT) * 100 : 0, tanks, blocked, warned };
  }, [invs, scopeCentres, config]);

  const history = useHistory(invs, scopeCentres, config, centre);

  const recent = invs.slice(0, 5);
  const curLabel = period === "jour" ? fmtDate(cur[0], { weekday: "long", day: "numeric", month: "long" }) : `${fmtDate(cur[0], { day: "numeric", month: "short" })} au ${fmtDate(cur[1], { day: "numeric", month: "short" })}`;
  const scopeLabel = centreId === "all" ? `${config.branding.companyName}, tous les centres` : focusCentre.name;
  // The KPI dialogs follow the dashboard period and can change it.
  const kpi = {
    subtitle: `${scopeLabel}, ${curLabel}`,
    actions: <Segmented options={PERIODS} value={period} onChange={setPeriod} label="Période" className="hidden md:inline-flex" />,
    width: "max-w-5xl",
  };
  const kpiProps = { history, cur, aCur, aPrev, cfg: config };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-semibold tracking-[-0.03em] sm:text-[40px]">Tableau de bord</h1>
          <p className="mt-1 text-[15px] text-muted">
            {scopeLabel}, {curLabel}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {todayInv ? (
            <ButtonLink href={`/inventaires/${todayInv.id}`}>
              <Plus className="size-4" />
              Saisir l&apos;inventaire du jour
            </ButtonLink>
          ) : (
            <Button onClick={() => toast("Aucun centre sélectionné", "warning")}>Démarrer un inventaire</Button>
          )}
          <Button variant="ghost" onClick={() => toast("Export à venir")}>
            <Download className="size-4" />
            Exporter
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <Segmented options={PERIODS} value={period} onChange={setPeriod} label="Période" />
      </div>

      <div className="dash-grid">
        {/* KPIs */}
        <Expandable as="article" title="Bouteilles produites" {...kpi} detail={() => <BottlesDetail {...kpiProps} />} className="surface-deep contours flex flex-col justify-between gap-5 [grid-area:s1]">
          <div className="flex items-start justify-between">
            <h2 className="text-[17px] font-medium">Bouteilles produites</h2>
            <ExpandButton label="Détail des bouteilles produites" dark />
          </div>
          <p className="tnum text-[46px] leading-none font-semibold tracking-[-0.04em]">{fmt(aCur.bottlesN)}</p>
          <p className="text-[13px]">
            <Trend value={delta(aCur.bottlesN, aPrev.bottlesN)} dark />
          </p>
        </Expandable>

        <Expandable as="article" title="Tonnage conditionné" {...kpi} detail={() => <TonnageDetail {...kpiProps} />} className="flex flex-col justify-between gap-5 [grid-area:s2]">
          <div className="flex items-start justify-between">
            <h2 className="text-[17px] font-medium">Tonnage conditionné</h2>
            <ExpandButton label="Détail du tonnage conditionné" />
          </div>
          <p className="tnum text-[46px] leading-none font-semibold tracking-[-0.04em]">
            {fmt(aCur.conditionneT, 0)}
            <span className="ml-1 text-[20px] font-medium text-muted">T</span>
          </p>
          <p className="text-[13px]">
            <Trend value={delta(aCur.conditionneT, aPrev.conditionneT)} />
          </p>
        </Expandable>

        <Expandable as="article" title="Rendement horaire" {...kpi} detail={() => <RendementDetail {...kpiProps} />} className="flex flex-col justify-between gap-5 [grid-area:s3]">
          <div className="flex items-start justify-between">
            <h2 className="text-[17px] font-medium">Rendement horaire</h2>
            <ExpandButton label="Détail du rendement horaire" />
          </div>
          <p className="tnum text-[46px] leading-none font-semibold tracking-[-0.04em]">
            {fmt(aCur.rendementTph, 1)}
            <span className="ml-1 text-[20px] font-medium text-muted">T/h</span>
          </p>
          <div>
            <div className="hatch h-2 overflow-hidden rounded-full">
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(aCur.capacityPct, 100)}%` }} />
            </div>
            <p className="tnum mt-2 text-[13px] text-muted">{fmt(aCur.capacityPct, 0)} % de la capacité installée</p>
          </div>
        </Expandable>

        <Expandable as="article" title="Écart moyen" {...kpi} detail={() => <EcartDetail {...kpiProps} invs={invs} centreOf={centre} />} className="flex flex-col justify-between gap-5 [grid-area:s4]">
          <div className="flex items-start justify-between">
            <h2 className="text-[17px] font-medium">Écart moyen</h2>
            <ExpandButton label="Détail de l'écart moyen" />
          </div>
          <p className="tnum text-[46px] leading-none font-semibold tracking-[-0.04em]">
            {fmt(aCur.meanAbsEcart, 2)}
            <span className="ml-1 text-[20px] font-medium text-muted">%</span>
          </p>
          <p className="text-[13px] text-muted">
            Écart cumulé{" "}
            <b className="tnum font-semibold text-ink">
              {aCur.ecartT >= 0 ? "+" : "−"}
              {fmt(Math.abs(aCur.ecartT), 1)} T
            </b>{" "}
            sur {aCur.days} jour{aCur.days > 1 ? "s" : ""}
          </p>
        </Expandable>

        {/* Week bars */}
        <Expandable
          title="Production des 7 derniers jours"
          subtitle={scopeLabel}
          detail={() => <WeekDetail history={history} week={week} today={today} cfg={config} />}
          className="flex flex-col [grid-area:an]"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <CardTitle>Production des 7 derniers jours</CardTitle>
              <p className="mt-0.5 text-[13px] text-muted">Tonnage conditionné. Hachuré : journée en cours ou sans production.</p>
            </div>
            <ExpandButton label="Détail de la semaine" />
          </div>
          <div className="min-h-[220px] flex-1">
            <WeekBars data={week} />
          </div>
        </Expandable>

        {/* Today */}
        <Card className="flex flex-col [grid-area:re]">
          <CardTitle>Inventaire du jour</CardTitle>
          {todayInv ? (
            <>
              <p className="mt-4 text-[24px] leading-tight font-semibold tracking-[-0.02em] text-brand-ink">
                {cap(fmtDate(todayInv.date, { weekday: "long", day: "numeric", month: "long" }))}
              </p>
              <p className="mt-2 text-[14px] text-muted">
                {centre(todayInv.centreId).name}
                <br />
                Démarré à {todayInv.heureDebut} par {todayInv.startedBy}
              </p>
              <div className="mt-3">
                <StatusBadge status="EN_COURS" />
              </div>
              <ButtonLink href={`/inventaires/${todayInv.id}`} className="mt-auto w-full">
                Reprendre la saisie
              </ButtonLink>
            </>
          ) : (
            <p className="mt-4 text-[14px] text-muted">Aucun inventaire en cours. Démarrez la journée pour suivre la production en direct.</p>
          )}
        </Card>

        {/* Recent */}
        <Card className="[grid-area:pr] h-fit">
          <div className="mb-3 flex items-center justify-between">
            <CardTitle>Inventaires récents</CardTitle>
            <Link href="/inventaires" className="rounded-full border border-line px-3 py-1 text-[13px] font-medium whitespace-nowrap hover:bg-brand-50">
              Tout voir
            </Link>
          </div>
          <ul className="">
            {recent.map((i) => {
              const s = summarize(i, centre(i.centreId), config);
              const band = ecartBand(s.ecartPct, config.rules);
              return (
                <li key={i.id}>
                  <Link href={`/inventaires/${i.id}`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-board">
                    <span className={"grid size-9 shrink-0 place-items-center rounded-xl text-[11px] font-semibold " + (i.status === "EN_COURS" ? "bg-warn/12 text-warn" : "bg-brand-100 text-brand-ink")}>
                      {centre(i.centreId).code}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{cap(fmtDate(i.date, { weekday: "short", day: "numeric", month: "short" }))}</span>
                      <span className="block truncate text-[12px] text-muted">{invCode(i.date)}</span>
                    </span>
                    {i.status === "EN_COURS" ? <StatusBadge status="EN_COURS" /> : <EcartPill pct={s.ecartPct} band={band} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* Timer */}
        <div className="[grid-area:tr]">{todayInv && <LiveTimerCard inv={todayInv} />}</div>

        {/* Tanks */}
        <ReservoirsCard
          className="[grid-area:tm]"
          tanks={stock.tanks}
          blocked={stock.blocked}
          warned={stock.warned}
          subtitle={`${scopeLabel}, dernière mesure saisie`}
          detail={(key) => <ReservoirsDetail tanks={stock.tanks} history={history} invs={invs} centres={scopeCentres} cfg={config} initial={key} />}
        />

        {/* Gauge */}
        <Expandable
          title="Stock physique"
          subtitle={scopeLabel}
          detail={() => <StockDetail history={history} tanks={stock.tanks} phys={stock.phys} capT={stock.capT} pct={stock.pct} />}
          className="flex flex-col [grid-area:pg]"
        >
          <div className="flex items-start justify-between gap-3">
            <CardTitle>Stock physique</CardTitle>
            <ExpandButton label="Détail du stock physique" />
          </div>
          <div className="flex flex-1 items-center py-4">
            <SemiGauge pct={stock.pct}>
              <p className="text-[40px] leading-none font-semibold tracking-[-0.04em]">
                <AnimatedNumber value={stock.pct} suffix=" %" />
              </p>
              <p className="mt-1 text-[13px] text-muted">
                {fmt(stock.phys, 0)} T sur {fmt(stock.capT, 0)} T
              </p>
            </SemiGauge>
          </div>
          <ul className="flex justify-center gap-5 text-[13px] text-muted">
            <li className="flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-brand-800" aria-hidden />
              Stock
            </li>
            <li className="flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-[var(--hatch)] opacity-55" aria-hidden />
              Creux disponible
            </li>
          </ul>
        </Expandable>
      </div>

      {/* <DemandCard /> */}
    </div>
  );
}
