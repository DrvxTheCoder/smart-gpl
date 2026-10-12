"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Phone } from "@/components/ui/icons";
import { Button, Card, CardTitle } from "@/components/ui/primitives";
import { PassageDialog } from "@/components/sales/passage-dialog";
import { Meter, TonePill } from "@/components/sales/ui";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { wholesalerStatuses } from "@/lib/sales/alerts";
import { contractAt } from "@/lib/sales/contracts";
import { passagesOf, sellOut } from "@/lib/sales/consignment";
import { customerPosition } from "@/lib/sales/selectors";
import { dayOf, shiftDate } from "@/lib/sales/dates";
import { CALL_OUTCOME, LADDER } from "@/lib/sales/labels";
import { cap, cn, fmt, fmtDate, fmtMoneyShort } from "@/lib/format";

const DAYS = 42;

export default function GrossistesPage() {
  const { config, centreId, centre } = useStore();
  const { data, ledger, today, own, env } = useSales();
  const [passing, setPassing] = useState<string | null>(null);
  const cur = config.sales.currency.label;

  const rows = useMemo(() => wholesalerStatuses({ cfg: config, data, ledger, today, own, centreId }), [config, data, ledger, today, own, centreId]);
  const from = shiftDate(today, -28);
  const totals = useMemo(() => {
    let value = 0;
    let sold = 0;
    for (const w of rows) {
      value += customerPosition(env, w.customer).floatValue;
      sold += Object.values(sellOut(data.settlements, w.customer.id, from, today)).reduce((a, b) => a + b, 0);
    }
    return { value, sold, late: rows.filter((w) => w.step).length, stock: rows.reduce((a, w) => a + w.stock, 0) };
  }, [rows, env, data.settlements, from, today]);

  // One row per wholesaler, one cell per day: how much it sold at each passage.
  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => shiftDate(today, i - DAYS + 1)), [today]);
  const heat = useMemo(() => {
    const max = Math.max(1, ...rows.flatMap((w) => passagesOf(data.settlements, w.customer.id).map((s) => Object.values(s.sold).reduce((a, b) => a + b, 0))));
    return rows.map((w) => {
      const byDay = new Map<string, number>();
      for (const s of passagesOf(data.settlements, w.customer.id)) byDay.set(dayOf(s.ts), (byDay.get(dayOf(s.ts)) ?? 0) + Object.values(s.sold).reduce((a, b) => a + b, 0));
      return { w, cells: days.map((d) => ({ d, n: byDay.get(d) ?? 0 })), max };
    });
  }, [rows, data.settlements, days]);
  const tasks = rows.filter((w) => w.step);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-semibold tracking-[-0.03em] sm:text-[40px]">Grossistes</h1>
          <p className="mt-1 text-[15px] text-muted">Dépôts en consignation et passages, {centreId === "all" ? "tous les centres" : centre(centreId).name}.</p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card as="article" className="surface-deep contours flex flex-col gap-2">
          <h2 className="text-[14px] text-white/80">Pleins en dépôt</h2>
          <p className="tnum text-[30px] leading-none font-semibold tracking-[-0.03em]">{fmt(totals.stock)}</p>
          <p className="text-[12px] text-white/70">{fmtMoneyShort(totals.value, cur)} de stock à vous</p>
        </Card>
        <Card as="article" className="flex flex-col gap-2">
          <h2 className="text-[14px] text-muted">Vendus sur 28 jours</h2>
          <p className="tnum text-[30px] leading-none font-semibold tracking-[-0.03em]">{fmt(totals.sold)}</p>
          <p className="text-[12px] text-faint">réglés aux passages</p>
        </Card>
        <Card as="article" className="flex flex-col gap-2">
          <h2 className="text-[14px] text-muted">En retard</h2>
          <p className={cn("tnum text-[30px] leading-none font-semibold tracking-[-0.03em]", totals.late > 0 && "text-warn")}>{totals.late}</p>
          <p className="text-[12px] text-faint">sur {rows.length} grossistes</p>
        </Card>
        <Card as="article" className="flex flex-col gap-2">
          <h2 className="text-[14px] text-muted">Seuil de relance</h2>
          <p className="tnum text-[30px] leading-none font-semibold tracking-[-0.03em]">
            {config.sales.consignment.inactivityDays}
            <span className="ml-1 text-[14px] font-medium text-muted">jours</span>
          </p>
          <p className="text-[12px] text-faint">par défaut, ajustable par contrat</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="min-w-0">
            <CardTitle>Suivi des passages</CardTitle>
            <p className="mt-0.5 text-[13px] text-muted">Chacun comparé à son seuil et à son propre rythme : un grossiste qui passe tous les 3 jours est en retard bien avant le seuil.</p>
            <div className="relative mt-4 overflow-x-auto">
              <table className="w-full min-w-[600px] text-[14px]">
                <thead>
                  <tr className="text-left text-[12px] text-muted">
                    <th className="pb-2 font-medium">Grossiste</th>
                    <th className="pb-2 pl-3 font-medium">Dernier passage</th>
                    <th className="pb-2 pl-3 font-medium">Stock / plafond</th>
                    <th className="pb-2 pl-3 font-medium">Statut et actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((w) => {
                    const capTotal = Object.values(contractAt(data.contracts, w.customer.id, today)?.terms.floatCap ?? {}).reduce((a, b) => a + b, 0);
                    return (
                      <tr key={w.customer.id} className="border-t border-line">
                        <td className="py-3 pr-3">
                          <Link href={`/ventes/clients/${w.customer.id}`} className="font-medium hover:underline">
                            {w.customer.name}
                          </Link>
                          <p className="text-[12px] text-muted">
                            {w.customer.code}, {w.customer.zone}
                          </p>
                        </td>
                        <td className="py-3 pl-3">
                          <p className="tnum">{w.daysSince == null ? "Jamais" : `il y a ${w.daysSince} j`}</p>
                          <p className="tnum text-[12px] text-muted">
                            seuil {w.threshold} j{w.typical ? `, habituel ${fmt(w.typical)} j` : ""}
                          </p>
                        </td>
                        <td className="w-48 py-3 pl-3">
                          <p className="tnum text-[13px]">
                            {fmt(w.stock)}
                            {capTotal ? <span className="text-muted"> / {fmt(capTotal)}</span> : null}
                            {w.daysOfStock != null && <span className="text-muted">, {fmt(w.daysOfStock, 1)} j</span>}
                          </p>
                          {capTotal > 0 && (
                            <div className="mt-1">
                              <Meter pct={(w.stock / capTotal) * 100} tone={w.stock > capTotal ? "alert" : undefined} label={`Dépôt à ${fmt((w.stock / capTotal) * 100)} % du plafond`} />
                            </div>
                          )}
                        </td>
                        <td className="py-3 pl-3">
                          {w.step ? <TonePill tone={w.step.action === "BLOQUER" ? "alert" : "warn"} title={LADDER[w.step.action]}>{w.step.action === "BLOQUER" ? "Bloqué" : w.step.action === "NOTIFIER" ? "Responsable prévenu" : "À appeler"}</TonePill> : w.lateForThem ? <TonePill tone="warn">Inhabituel</TonePill> : <TonePill tone="ok">À jour</TonePill>}
                          {w.lastCall && (
                            <p className="mt-1 text-[12px] text-muted">
                              {w.lastCall.promised ? `Passage promis le ${fmtDate(w.lastCall.promised, { day: "numeric", month: "short" })}` : `Appel : ${CALL_OUTCOME[w.lastCall.outcome].toLowerCase()}`}
                            </p>
                          )}
                          <div className="mt-2 flex gap-2">
                            {w.customer.contact.phone && (
                              <a href={`tel:${w.customer.contact.phone.replace(/\s/g, "")}`} aria-label={`Appeler ${w.customer.name}`} className="grid size-11 place-items-center rounded-full bg-brand-100 text-brand-800 hover:bg-brand-200">
                                <Phone className="size-4" />
                              </a>
                            )}
                            <Button size="sm" variant="ghost" className="h-11" onClick={() => setPassing(w.customer.id)}>
                              Passage
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length === 0 && <p className="py-8 text-center text-muted">Aucun grossiste pour ce centre. Un client de catégorie « Grossiste » apparaît ici.</p>}
            </div>
          </Card>

          <Card className="min-w-0">
            <CardTitle>Passages sur {DAYS} jours</CardTitle>
            <p className="mt-0.5 text-[13px] text-muted">Une case par jour ; plus elle est foncée, plus le grossiste a vendu à ce passage. Hachuré : dimanche.</p>
            <div className="relative mt-4 overflow-x-auto">
              <div className="min-w-[640px] space-y-1.5">
                {heat.map(({ w, cells, max }) => (
                  <div key={w.customer.id} className="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3">
                    <span className="truncate text-[13px]">{w.customer.name}</span>
                    <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${DAYS}, minmax(0, 1fr))` }} role="img" aria-label={`${w.customer.name} : ${cells.filter((c) => c.n).length} passages sur ${DAYS} jours`}>
                      {cells.map((c) => {
                        const sunday = new Date(`${c.d}T12:00:00`).getDay() === 0;
                        const k = c.n / max;
                        return (
                          <span
                            key={c.d}
                            title={`${cap(fmtDate(c.d, { weekday: "short", day: "numeric", month: "short" }))} : ${c.n ? `${fmt(c.n)} vendues` : "pas de passage"}`}
                            className={cn("aspect-square rounded-[3px]", sunday ? "hatch" : c.n ? "" : "bg-board")}
                            style={c.n ? { background: `color-mix(in oklab, var(--b-800) ${Math.round(35 + k * 65)}%, var(--card))` } : undefined}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 flex justify-between pl-[162px] text-[11px] text-faint">
              <span>{fmtDate(days[0], { day: "numeric", month: "short" })}</span>
              <span>aujourd&apos;hui</span>
            </div>
          </Card>
        </div>

        <Card className="h-fit xl:sticky xl:top-[100px]">
          <CardTitle>Appels à passer</CardTitle>
          <p className="mt-0.5 text-[13px] text-muted">Échelle de relance : {config.sales.consignment.ladder.map((s) => `${s.day} j, ${LADDER[s.action].toLowerCase()}`).join(" ; ")}.</p>
          {tasks.length === 0 ? (
            <p className="py-6 text-center text-[14px] text-muted">Aucun appel en attente.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {tasks.map((w) => (
                <li key={w.customer.id} className="rounded-2xl bg-board p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/ventes/clients/${w.customer.id}`} className="block truncate text-[14px] font-medium hover:underline">
                        {w.customer.name}
                      </Link>
                      <p className="tnum text-[12px] text-muted">
                        {w.daysSince} j sans passage, {fmt(w.stock)} pleins en dépôt
                        {w.daysOfStock != null ? ` (${fmt(w.daysOfStock, 1)} j de vente)` : ""}
                      </p>
                    </div>
                    <TonePill tone={w.step?.action === "BLOQUER" ? "alert" : "warn"}>J+{w.daysSince}</TonePill>
                  </div>
                  {w.customer.contact.phone && (
                    <a href={`tel:${w.customer.contact.phone.replace(/\s/g, "")}`} className="mt-2 flex h-11 items-center justify-center gap-2 rounded-full bg-brand-800 text-[14px] font-medium text-white hover:bg-brand-950">
                      <Phone className="size-4" />
                      {w.customer.contact.name}, {w.customer.contact.phone}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[12px] text-faint">Notez le résultat de chaque appel sur la fiche du grossiste, onglet Appels.</p>
        </Card>
      </div>

      <PassageDialog open={passing !== null} onClose={() => setPassing(null)} customerId={passing} />
    </div>
  );
}
