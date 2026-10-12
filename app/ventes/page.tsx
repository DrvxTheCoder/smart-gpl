"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { Phone, Plus, Target } from "@/components/ui/icons";
import { ButtonLink, Card, CardTitle, CornerLink } from "@/components/ui/primitives";
import { ForecastBars } from "@/components/charts/charts";
import { FillPlanCard } from "@/components/sales/fill-plan-card";
import { DispatchBadge, TonePill } from "@/components/sales/ui";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { wholesalerStatuses } from "@/lib/sales/alerts";
import { band, fillRate, otif, perPeriod, reliquats } from "@/lib/sales/forecast";
import { centreFillPlan, customerPosition, customersIn, forecastSeries } from "@/lib/sales/selectors";
import { dayOf, periodLabel, periodOf, periodRange, periodsAround, shiftDate } from "@/lib/sales/dates";
import { LADDER } from "@/lib/sales/labels";
import { cap, cn, fmt, fmtMoney, fmtMoneyShort } from "@/lib/format";
import { BULK } from "@/lib/sales/types";

export default function VentesDashboard() {
  const { config, centreId, centre, inventories } = useStore();
  const { data, ledger, today, own } = useSales();
  const cur = config.sales.currency.label;
  const scope = useCallback((id: string) => centreId === "all" || id === centreId, [centreId]);
  const t = config.sales.targets;

  const from30 = shiftDate(today, -30);
  const yesterday = shiftDate(today, -1);
  const fr = useMemo(() => fillRate(data.orders, data.dispatches, from30, yesterday, centreId), [data, from30, yesterday, centreId]);
  const ot = useMemo(() => otif(data.orders, data.dispatches, from30, yesterday, centreId), [data, from30, yesterday, centreId]);
  const rel = useMemo(() => reliquats(data.orders, from30, yesterday, centreId), [data.orders, from30, yesterday, centreId]);
  const relTotal = Object.values(rel).reduce((a, b) => a + b, 0);
  const relTop = Object.entries(rel).sort((a, b) => b[1] - a[1])[0];
  const reasonLabel = (code: string) => config.sales.reasons.reliquat.find((r) => r.code === code)?.label ?? code;

  // This week: bottles that left (sales and wholesaler sell-out) against the forecast.
  const series = useMemo(() => forecastSeries({ cfg: config, data, centreId, granularity: "SEMAINE" }), [config, data, centreId]);
  const week = periodOf(today, "SEMAINE");
  const weekStart = periodRange(week, "SEMAINE")[0];
  const sold = useMemo(() => {
    let n = 0;
    let kg = 0;
    let before = 0;
    const kgOf = (f: string) => config.bottleTypes.find((b) => b.id === f)?.kg ?? 0;
    for (const m of ledger) {
      if (!m.site.startsWith("centre:") || !scope(m.site.slice(7)) || dayOf(m.ts) < weekStart) continue;
      if (m.kind === "PLEINS_SORTIE") {
        n -= m.qty;
        kg -= m.qty * kgOf(m.formatId);
        if (dayOf(m.ts) < today) before -= m.qty;
      }
    }
    for (const s of data.settlements)
      if (scope(s.centreId) && s.status === "CONFIRME" && dayOf(s.ts) >= weekStart)
        for (const [f, q] of Object.entries(s.sold)) {
          n += q;
          kg += q * kgOf(f);
          if (dayOf(s.ts) < today) before += q;
        }
    return { n, t: kg / 1000, before };
  }, [ledger, data.settlements, weekStart, scope, config.bottleTypes, today]);
  const weekForecast = perPeriod(series.latest, [week])[0];
  // Pace on completed working days only (Monday = 0 done): today is still under way.
  const done = Math.min((new Date(`${today}T12:00:00`).getDay() || 7) - 1, 6);
  const pace = weekForecast && done > 0 ? (sold.before / ((weekForecast * done) / 6)) * 100 : null;

  const span = useMemo(() => periodsAround(today, "SEMAINE", 7, 2), [today]);
  const chart = useMemo(() => {
    const fc = perPeriod(series.latest, span);
    const act = perPeriod(series.actual, span);
    return span.map((p, i) => ({ label: periodLabel(p, "SEMAINE"), full: cap(periodLabel(p, "SEMAINE", true)), forecast: Math.round(fc[i]), actual: periodRange(p, "SEMAINE")[1] < today ? Math.round(act[i]) : null }));
  }, [series, span, today]);

  const ageing = useMemo(() => {
    const a = { notDue: 0, d1_30: 0, d31_60: 0, d61: 0, total: 0 };
    for (const c of customersIn(data.customers, centreId)) {
      const p = customerPosition({ cfg: config, data, ledger, today, own }, c);
      a.notDue += p.ageing.notDue;
      a.d1_30 += p.ageing.d1_30;
      a.d31_60 += p.ageing.d31_60;
      a.d61 += p.ageing.d61_90 + p.ageing.d90;
      a.total += p.ageing.total;
    }
    return a;
  }, [data, ledger, centreId, config, today, own]);

  const toCall = useMemo(() => wholesalerStatuses({ cfg: config, data, ledger, today, own, centreId }).filter((w) => w.step || w.lateForThem), [config, data, ledger, today, own, centreId]);
  const todays = useMemo(() => data.dispatches.filter((d) => scope(d.centreId) && dayOf(d.slot) === today).sort((a, b) => a.slot.localeCompare(b.slot)), [data.dispatches, today, scope]);
  const planCentre = centreId === "all" ? config.centres[0] : centre(centreId);
  const plan = useMemo(() => centreFillPlan({ cfg: config, data, ledger, inventories, today, own }, planCentre.id), [config, data, ledger, inventories, today, own, planCentre.id]);
  const customerName = (id: string) => data.customers.find((c) => c.id === id)?.name ?? "Client";
  const frTone = band(fr.rate, t.fillRate);
  const otTone = band(ot.rate, t.otif);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-semibold tracking-[-0.03em] sm:text-[40px]">Ventes</h1>
          <p className="mt-1 text-[15px] text-muted">
            {centreId === "all" ? `${config.branding.companyName}, tous les centres` : centre(centreId).name}, {periodLabel(week, "SEMAINE", true).toLowerCase()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <ButtonLink href="/ventes/commandes?nouveau=1">
            <Plus className="size-4" />
            Nouvelle commande
          </ButtonLink>
          <ButtonLink href="/ventes/previsions" variant="ghost">
            <Target className="size-4" />
            Saisir une prévision
          </ButtonLink>
        </div>
      </div>

      <div className="sales-grid">
        <Card as="article" className="surface-deep contours flex flex-col justify-between gap-5 [grid-area:s1]">
          <div className="flex items-start justify-between">
            <h2 className="text-[17px] font-medium">Bouteilles vendues cette semaine</h2>
            <CornerLink href="/ventes/previsions" label="Voir les prévisions" dark />
          </div>
          <p className="tnum text-[46px] leading-none font-semibold tracking-[-0.04em]">
            {fmt(sold.n)}
            <span className="ml-2 text-[18px] font-medium text-white/70">{fmt(sold.t, 0)} T</span>
          </p>
          <p className="text-[13px] text-white/80">
            {pace == null ? (
              weekForecast ? `Semaine commencée aujourd'hui, ${fmt(weekForecast)} bouteilles prévues` : "Aucune prévision pour cette semaine"
            ) : (
              <>
                <span className="tnum mr-2 inline-flex h-5 items-center rounded-md border border-white/35 px-1.5 text-[11px] font-semibold text-white">{fmt(pace)} %</span>
                du rythme prévu ({fmt(weekForecast)} sur la semaine)
              </>
            )}
          </p>
        </Card>

        <Card as="article" className="flex flex-col justify-between gap-5 [grid-area:s2]">
          <h2 className="text-[17px] font-medium">Taux de service</h2>
          <p className="tnum text-[46px] leading-none font-semibold tracking-[-0.04em]">
            {fr.rate == null ? "—" : fmt(fr.rate, 1)}
            <span className="ml-1 text-[20px] font-medium text-muted">%</span>
          </p>
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
            {frTone && <TonePill tone={frTone}>{frTone === "ok" ? "Dans l'objectif" : frTone === "warn" ? "À surveiller" : "Sous l'objectif"}</TonePill>}
            servi / commandé, 30 jours
          </p>
        </Card>

        <Card as="article" className="flex flex-col justify-between gap-5 [grid-area:s3]">
          <h2 className="text-[17px] font-medium">Livré complet et à l&apos;heure</h2>
          <p className="tnum text-[46px] leading-none font-semibold tracking-[-0.04em]">
            {ot.rate == null ? "—" : fmt(ot.rate, 1)}
            <span className="ml-1 text-[20px] font-medium text-muted">%</span>
          </p>
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
            {otTone && <TonePill tone={otTone}>OTIF</TonePill>}
            {ot.ok} commandes sur {ot.judged}
          </p>
        </Card>

        <Card as="article" className="flex flex-col justify-between gap-5 [grid-area:s4]">
          <div className="flex items-start justify-between">
            <h2 className="text-[17px] font-medium">Reliquats</h2>
            <CornerLink href="/ventes/commandes?statut=reliquat" label="Voir les commandes avec reliquat" />
          </div>
          <p className="tnum text-[46px] leading-none font-semibold tracking-[-0.04em]">
            {fmt(relTotal)}
            <span className="ml-1 text-[20px] font-medium text-muted">bt</span>
          </p>
          <p className="text-[13px] text-muted">{relTop ? `Surtout : ${reasonLabel(relTop[0]).toLowerCase()} (${fmt(relTop[1])}), 30 jours` : "Aucune quantité non servie sur 30 jours"}</p>
        </Card>

        <Card className="flex flex-col [grid-area:fc]">
          <div className="mb-4">
            <CardTitle>Prévision et demande, par semaine</CardTitle>
            <p className="mt-0.5 text-[13px] text-muted">Bouteilles. Hachuré : prévision. Plein : commandes et ventes des grossistes.</p>
          </div>
          <div className="min-h-[230px] flex-1">
            <ForecastBars data={chart} />
          </div>
        </Card>

        <Card className="[grid-area:ar]">
          <div className="flex items-start justify-between">
            <CardTitle>Créances</CardTitle>
            <CornerLink href="/ventes/clients" label="Voir les clients" />
          </div>
          <p className="tnum mt-4 text-[26px] font-semibold tracking-[-0.02em]" title={fmtMoney(ageing.total, cur)}>
            {fmtMoneyShort(ageing.total, "")}
            <span className="text-[14px] font-medium text-muted"> {cur}</span>
          </p>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-line" aria-hidden>
            <span className="bg-brand-600" style={{ flex: ageing.notDue }} />
            <span className="bg-warn/70" style={{ flex: ageing.d1_30 }} />
            <span className="bg-warn" style={{ flex: ageing.d31_60 }} />
            <span className="bg-alert" style={{ flex: ageing.d61 }} />
          </div>
          <dl className="tnum mt-4 space-y-2 text-[13px]">
            {(
              [
                ["Non échu", ageing.notDue, "bg-brand-600"],
                ["Échu, 1 à 30 j", ageing.d1_30, "bg-warn/70"],
                ["Échu, 31 à 60 j", ageing.d31_60, "bg-warn"],
                ["Échu, plus de 60 j", ageing.d61, "bg-alert"],
              ] as const
            ).map(([k, v, c]) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-muted">
                  <span className={cn("size-2.5 rounded-full", c)} aria-hidden />
                  {k}
                </dt>
                <dd className="font-medium whitespace-nowrap">{fmtMoneyShort(v, cur)}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="[grid-area:wh]">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <CardTitle>Grossistes à appeler</CardTitle>
              <p className="mt-0.5 text-[13px] text-muted">Sans passage depuis le seuil, ou en retard sur leur propre rythme.</p>
            </div>
            <CornerLink href="/ventes/grossistes" label="Voir le suivi des grossistes" />
          </div>
          {toCall.length === 0 ? (
            <p className="py-6 text-center text-[14px] text-muted">Tous les grossistes sont passés dans les temps.</p>
          ) : (
            <ul className="divide-y divide-line">
              {toCall.map((w) => (
                <li key={w.customer.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/ventes/clients/${w.customer.id}`} className="block truncate text-[14px] font-medium hover:underline">
                      {w.customer.name}
                    </Link>
                    <p className="tnum text-[12px] text-muted">
                      {w.daysSince} j sans passage, seuil {w.threshold} j{w.typical ? `, rythme habituel ${fmt(w.typical)} j` : ""}
                      {w.daysOfStock != null ? `, ${fmt(w.daysOfStock, 1)} j de stock` : ""}
                    </p>
                  </div>
                  <TonePill tone={w.step?.action === "BLOQUER" ? "alert" : "warn"} title={w.step ? LADDER[w.step.action] : "Plus tard que son rythme habituel"}>
                    {w.step ? (w.step.action === "BLOQUER" ? "Bloqué" : w.step.action === "NOTIFIER" ? "Responsable prévenu" : "À appeler") : "Inhabituel"}
                  </TonePill>
                  {w.customer.contact.phone && (
                    <a href={`tel:${w.customer.contact.phone.replace(/\s/g, "")}`} aria-label={`Appeler ${w.customer.name}`} className="grid size-11 place-items-center rounded-full bg-brand-100 text-brand-800 hover:bg-brand-200">
                      <Phone className="size-4" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="[grid-area:dp]">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <CardTitle>Expéditions du jour</CardTitle>
              <p className="mt-0.5 text-[13px] text-muted">{todays.length ? `${todays.filter((d) => d.status === "EXPEDIE" || d.status === "LIVRE").length} parties sur ${todays.length}` : "Aucun camion prévu aujourd'hui."}</p>
            </div>
            <CornerLink href="/expeditions" label="Voir la file des camions" />
          </div>
          <ul className="divide-y divide-line">
            {todays.map((d) => (
              <li key={d.id}>
                <Link href={`/expeditions/${d.id}`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-board">
                  <span className="tnum w-12 shrink-0 text-[13px] text-muted">{new Date(d.slot).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{customerName(d.customerId)}</span>
                    <span className="block truncate text-[12px] text-muted">
                      {d.number}, {d.truck}
                      {d.loaded[BULK] ? `, vrac ${fmt(d.loaded[BULK] / 1000, 1)} T` : ""}
                    </span>
                  </span>
                  <DispatchBadge status={d.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <div className="[grid-area:fp]">
          <FillPlanCard title={centreId === "all" ? `Plan de remplissage, ${planCentre.name}` : "Plan de remplissage"} plan={plan} />
        </div>
      </div>
    </div>
  );
}
