"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { Check, Exchange, FileSpreadsheet, Lock, Plus, Printer } from "@/components/ui/icons";
import { Button, ButtonLink, Card, Dialog, Field, IntegerInput, Segmented, inputCls } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/calendar";
import { CountGrid } from "@/components/sales/warehouse-ui";
import { TabPanel, TabStrip, TonePill } from "@/components/sales/ui";
import { useQuery } from "@/components/sales/use-query";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { adjust, closeDay, decideCount, exchange, recordCount } from "@/lib/sales/commands/warehouse";
import { centreSite, emptiesBuckets, gridTotal, MOVEMENT_LABEL, movementsOn, siteBalance } from "@/lib/sales/bottle-ledger";
import { variance } from "@/lib/sales/consignment";
import { dayOf, shiftDate } from "@/lib/sales/dates";
import { authorityCsv, isClosed, reportRows, unclosedDays } from "@/lib/sales/day-close";
import { atp, dailyProduction, ledgerStart, reservedQty } from "@/lib/sales/stock";
import { cap, cn, fmt, fmtDate } from "@/lib/format";
import { UNKNOWN_BRAND, type BottleState, type BrandGrid, type MovementKind } from "@/lib/sales/types";

type Tab = "stock" | "mouvements" | "comptage" | "cloture";
const STATE_LABEL: Record<BottleState, string> = { PLEIN: "Pleins", VIDE: "Vides", CASSE: "Réformées" };

function Inner() {
  const { config, centreId, inventories, startJob } = useStore();
  const { data, ledger, today, own, exec, can, role } = useSales();
  const [q, setQ] = useQuery({ tab: "stock", c: "", jour: "" });
  const tab = (["stock", "mouvements", "comptage", "cloture"].includes(q.tab) ? q.tab : "stock") as Tab;
  const cid = centreId === "all" ? (config.centres.some((c) => c.id === q.c) ? q.c : config.centres[0].id) : centreId;
  const centre = config.centres.find((c) => c.id === cid) ?? config.centres[0];
  const site = centreSite(cid);
  const day = q.jour || today;
  const formats = config.bottleTypes;
  const brandName = (b: string) => (b === UNKNOWN_BRAND ? "Marque non identifiée" : config.sales.brands.find((x) => x.id === b)?.name ?? b);
  const label = (f: string) => formats.find((b) => b.id === f)?.label ?? f;

  const bal = useMemo(() => siteBalance(ledger, site), [ledger, site]);
  const buckets = emptiesBuckets(bal, config.sales.brands);
  const reserved = useMemo(() => reservedQty(data.orders, data.dispatches, cid), [data.orders, data.dispatches, cid]);
  const avail = useMemo(
    () => atp({ fulls: buckets.ownFulls, reserved, daily: dailyProduction(inventories, cid, today), horizonDays: config.sales.stock.atpHorizonDays, reserveOnConfirm: config.sales.workflow.steps.reserveOnConfirm }),
    [buckets.ownFulls, reserved, inventories, cid, today, config.sales],
  );
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

  const [modal, setModal] = useState<null | "exchange" | "adjust">(null);
  const [ex, setEx] = useState({ brand: config.sales.brands.find((b) => !b.own)?.id ?? "", given: {} as Record<string, number>, received: {} as Record<string, number> });
  const [adj, setAdj] = useState({ state: "VIDE" as BottleState, brand: own, formatId: formats[0].id, qty: 0, sign: 1, reason: config.sales.reasons.adjustment[0]?.code ?? "" });
  const [count, setCount] = useState<{ state: BottleState; grid: BrandGrid; reason: string; note: string }>({ state: "PLEIN", grid: {}, reason: "", note: "" });
  const [kind, setKind] = useState<"all" | MovementKind>("all");
  const [closing, setClosing] = useState<string | null>(null);

  const moves = useMemo(() => movementsOn(ledger, site, day).filter((m) => kind === "all" || m.kind === kind).sort((a, b) => b.ts.localeCompare(a.ts)), [ledger, site, day, kind]);
  const dayClosed = isClosed(data.closes, cid, day);
  const expected = bal[count.state];
  const live = variance(count.grid, expected, config.sales.consignment.varianceTolerancePct);
  const counted = gridTotal(count.grid) > 0;
  const pendingCounts = data.counts.filter((k) => k.status === "A_VALIDER" && (k.site === site || (k.site.startsWith("client:") && data.customers.find((c) => `client:${c.id}` === k.site)?.centreIds.includes(cid))));
  const recentCounts = data.counts.filter((k) => k.site === site && k.status !== "A_VALIDER").sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 5);
  const open = unclosedDays(data.closes, cid, ledgerStart(today), shiftDate(today, 1));
  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = today; out.length < 14; d = shiftDate(d, -1)) if (new Date(`${d}T12:00:00`).getDay() !== 0) out.push(d);
    return out;
  }, [today]);
  const reportDay = closing ?? day;
  const rows = useMemo(() => data.closes.find((c) => c.centreId === cid && c.date === reportDay)?.rows ?? reportRows(ledger, cid, reportDay, config.sales.brands, formats.map((b) => b.id)), [data.closes, cid, reportDay, ledger, config.sales.brands, formats]);
  const csv = (date: string) =>
    startJob({
      kind: "csv",
      busyMsg: "Un export est déjà en cours",
      doneMsg: "État journalier téléchargé",
      run: async (onProgress) => {
        onProgress(0.5);
        const r = data.closes.find((c) => c.centreId === cid && c.date === date)?.rows ?? reportRows(ledger, cid, date, config.sales.brands, formats.map((b) => b.id));
        return authorityCsv({ rows: r, template: config.sales.reports.authority, centre: centre.code, date, brand: brandName, format: label });
      },
    });

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "stock", label: "Stock" },
    { id: "mouvements", label: "Mouvements" },
    { id: "comptage", label: "Comptage", count: pendingCounts.length },
    { id: "cloture", label: "Clôture", count: open.filter((d) => d < today).length },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-semibold tracking-[-0.03em] sm:text-[40px]">Stock et bouteilles</h1>
          <p className="mt-1 text-[15px] text-muted">Pleins, vides et réformées par marque et format, {centre.name}.</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {centreId === "all" && <Select className="w-56" ariaLabel="Centre" value={cid} onChange={(v) => setQ({ c: v })} options={config.centres.map((c) => ({ value: c.id, label: c.name }))} />}
          <Button variant="ghost" onClick={() => setModal("exchange")}>
            <Exchange className="size-4" />
            Échange inter-marques
          </Button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ["Pleins de votre marque", sum(buckets.ownFulls), "prêts à vendre"],
          ["Vides de votre marque", sum(buckets.ownEmpties), "à remplir"],
          ["Vides d'autres marques", gridTotal(buckets.competitor), "en attente d'échange"],
          ["Réformées", sum(buckets.damaged), "hors d'usage"],
        ].map(([k, v, sub], i) => (
          <Card key={k as string} as="article" className={cn("flex flex-col gap-2", i === 0 && "surface-deep contours")}>
            <h2 className={cn("text-[14px]", i === 0 ? "text-white/80" : "text-muted")}>{k}</h2>
            <p className="tnum text-[30px] leading-none font-semibold tracking-[-0.03em]">{fmt(v as number)}</p>
            <p className={cn("text-[12px]", i === 0 ? "text-white/70" : "text-faint")}>{sub}</p>
          </Card>
        ))}
      </div>

      <Card className="p-0">
        <TabStrip tabs={tabs} value={tab} onChange={(t) => setQ({ tab: t })} label="Sections du magasin" />

        {tab === "stock" && (
          <TabPanel key="stock" id="stock">
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[640px] text-[14px]">
                <thead>
                  <tr className="text-left text-[12px] text-muted">
                    <th className="pb-2 font-medium">Format</th>
                    <th className="pb-2 pl-3 text-right font-medium">Pleins</th>
                    <th className="pb-2 pl-3 text-right font-medium">Réservés</th>
                    <th className="pb-2 pl-3 text-right font-medium">Disponible à la vente</th>
                    <th className="pb-2 pl-3 text-right font-medium">Vides propres</th>
                    <th className="pb-2 pl-3 text-right font-medium">Vides autres marques</th>
                    <th className="pb-2 pl-3 text-right font-medium">Réformées</th>
                  </tr>
                </thead>
                <tbody>
                  {formats.map((b) => {
                    const comp = Object.values(buckets.competitor).reduce((a, r) => a + (r[b.id] ?? 0), 0);
                    return (
                      <tr key={b.id} className="border-t border-line">
                        <td className="py-2.5 font-medium">{b.label}</td>
                        <td className="tnum py-2.5 pl-3 text-right">{fmt(buckets.ownFulls[b.id] ?? 0)}</td>
                        <td className="tnum py-2.5 pl-3 text-right text-muted">{fmt(reserved[b.id] ?? 0)}</td>
                        <td className={cn("tnum py-2.5 pl-3 text-right font-semibold", (avail[b.id] ?? 0) < 0 && "text-alert")}>{fmt(avail[b.id] ?? 0)}</td>
                        <td className="tnum py-2.5 pl-3 text-right">{fmt(buckets.ownEmpties[b.id] ?? 0)}</td>
                        <td className="tnum py-2.5 pl-3 text-right">{fmt(comp)}</td>
                        <td className="tnum py-2.5 pl-3 text-right text-muted">{fmt(buckets.damaged[b.id] ?? 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[12px] text-faint">
              Disponible à la vente : pleins − commandes confirmées non parties{config.sales.stock.atpHorizonDays ? ` + production moyenne sur ${config.sales.stock.atpHorizonDays} jour${config.sales.stock.atpHorizonDays > 1 ? "s" : ""}` : ""}. La production vient des inventaires clôturés.
            </p>
            <h3 className="mt-8 text-[15px] font-medium">Vides par marque</h3>
            <p className="text-[13px] text-muted">Position nette par concurrent : ce qu&apos;il faudra lui rendre à l&apos;échange.</p>
            <div className="relative mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-[14px]">
                <thead>
                  <tr className="text-left text-[12px] text-muted">
                    <th className="pb-2 font-medium">Marque</th>
                    {formats.map((b) => (
                      <th key={b.id} className="pb-2 pl-3 text-right font-medium">
                        {b.label}
                      </th>
                    ))}
                    <th className="pb-2 pl-3 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(bal.VIDE).map(([b, row]) => (
                    <tr key={b} className={cn("border-t border-line", b === own && "font-medium")}>
                      <td className="py-2.5">{brandName(b)}</td>
                      {formats.map((f) => (
                        <td key={f.id} className="tnum py-2.5 pl-3 text-right">
                          {fmt(row[f.id] ?? 0)}
                        </td>
                      ))}
                      <td className="tnum py-2.5 pl-3 text-right font-semibold">{fmt(sum(row))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabPanel>
        )}

        {tab === "mouvements" && (
          <TabPanel key="mouvements" id="mouvements">
            <div className="mb-4 flex flex-wrap items-end gap-2">
              <div className="w-full sm:w-60">
                <DatePicker ariaLabel="Jour" value={day} max={today} min={ledgerStart(today)} onChange={(v) => setQ({ jour: v && v !== today ? v : "" })} />
              </div>
              <Select
                className="w-full sm:w-60"
                ariaLabel="Type de mouvement"
                value={kind}
                onChange={setKind}
                options={[{ value: "all", label: "Tous les mouvements" }, ...(Object.keys(MOVEMENT_LABEL) as MovementKind[]).map((k) => ({ value: k, label: MOVEMENT_LABEL[k] }))]}
              />
              {dayClosed ? (
                <span className="flex h-10 items-center gap-1.5 text-[13px] text-muted">
                  <Lock className="size-4" /> Journée clôturée : corrections par ajustement daté
                </span>
              ) : null}
              <Button variant="soft" className="sm:ml-auto" onClick={() => setModal("adjust")}>
                <Plus className="size-4" />
                Ajustement
              </Button>
            </div>
            {moves.length === 0 ? (
              <p className="py-8 text-center text-muted">Aucun mouvement ce jour-là.</p>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[640px] text-[14px]">
                  <thead>
                    <tr className="text-left text-[12px] text-muted">
                      <th className="pb-2 font-medium">Heure</th>
                      <th className="pb-2 font-medium">Mouvement</th>
                      <th className="pb-2 font-medium">Marque</th>
                      <th className="pb-2 font-medium">Format</th>
                      <th className="pb-2 pl-3 text-right font-medium">Quantité</th>
                      <th className="pb-2 pl-3 font-medium">Référence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {moves.slice(0, 200).map((m) => {
                      const disp = m.refs.dispatchId ? data.dispatches.find((x) => x.id === m.refs.dispatchId) : undefined;
                      return (
                        <tr key={m.id} className={cn("border-t border-line", m.reverses && "text-muted")}>
                          <td className="tnum py-2 pr-3">{new Date(m.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</td>
                          <td className="py-2 pr-3">
                            {m.reverses ? "Contre-passation" : MOVEMENT_LABEL[m.kind]}
                            <span className="block text-[12px] text-muted">{STATE_LABEL[m.state]}</span>
                          </td>
                          <td className="py-2 pr-3">{brandName(m.brand)}</td>
                          <td className="py-2 pr-3">{label(m.formatId)}</td>
                          <td className={cn("tnum py-2 pl-3 text-right font-medium", m.qty < 0 ? "text-ink" : "text-ok")}>
                            {m.qty > 0 ? "+" : "−"}
                            {fmt(Math.abs(m.qty))}
                          </td>
                          <td className="py-2 pl-3 text-[12px] text-muted">
                            {disp ? (
                              <Link href={`/expeditions/${disp.id}`} className="text-brand-ink hover:underline">
                                {disp.number}
                              </Link>
                            ) : (
                              m.reason ?? m.by
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabPanel>
        )}

        {tab === "comptage" && (
          <TabPanel key="comptage" id="comptage">
            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-w-0">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <Segmented label="Ce qui est compté" value={count.state} onChange={(v) => setCount({ ...count, state: v, grid: {} })} options={(["PLEIN", "VIDE", "CASSE"] as const).map((s) => ({ value: s, label: STATE_LABEL[s] }))} />
                  <span className="text-[13px] text-muted">Stock attendu : {fmt(gridTotal(expected))} bouteilles</span>
                </div>
                <CountGrid brands={config.sales.brands} formats={formats} value={count.grid} onChange={(g) => setCount({ ...count, grid: g })} />
              </div>
              <div className="space-y-3 2xl:sticky 2xl:top-[100px] 2xl:self-start">
                <div className={cn("rounded-2xl p-4", !counted ? "bg-board" : live.withinTolerance ? "bg-ok/8" : "bg-alert/8")}>
                  <p className="text-[13px] text-muted">Écart compté − attendu</p>
                  <p className={cn("tnum mt-1 text-[30px] leading-none font-semibold tracking-[-0.03em]", counted && (live.withinTolerance ? "text-ok" : "text-alert"))}>
                    {counted ? `${sum(live.diff) >= 0 ? "+" : "−"}${fmt(Math.abs(sum(live.diff)))}` : "—"}
                  </p>
                  {counted && (
                    <>
                      <div className="mt-2">
                        <TonePill tone={live.withinTolerance ? "ok" : "alert"}>
                          {live.withinTolerance ? "Dans la tolérance" : "À justifier"} · {fmt(live.pct, 1)} %
                        </TonePill>
                      </div>
                      <ul className="tnum mt-3 space-y-0.5 text-[13px] text-muted">
                        {Object.entries(live.diff)
                          .filter(([, n]) => n)
                          .map(([f, n]) => (
                            <li key={f}>
                              {label(f)} : {n > 0 ? "+" : "−"}
                              {fmt(Math.abs(n))}
                            </li>
                          ))}
                      </ul>
                    </>
                  )}
                </div>
                {counted && !live.withinTolerance && (
                  <Field label="Motif de l'écart">
                    <Select ariaLabel="Motif de l'écart" value={count.reason} placeholder="Choisir un motif" onChange={(v) => setCount({ ...count, reason: v })} options={config.sales.reasons.variance.map((r) => ({ value: r.code, label: r.label }))} />
                  </Field>
                )}
                <Field label="Remarque">
                  <input className={inputCls} value={count.note} placeholder="Facultatif" onChange={(e) => setCount({ ...count, note: e.target.value })} />
                </Field>
                <Button
                  className="w-full"
                  disabled={!counted}
                  onClick={() => {
                    const r = exec((e) => recordCount(e, { site, state: count.state, counted: count.grid, reason: count.reason || null, note: count.note }));
                    if (r.ok) setCount({ state: count.state, grid: {}, reason: "", note: "" });
                  }}
                >
                  Enregistrer le comptage
                </Button>
                <p className="text-[12px] text-faint">Tolérance : {config.sales.consignment.varianceTolerancePct} %. Au-delà, un responsable valide l&apos;écart avant l&apos;ajustement du stock.</p>
              </div>
            </div>

            <h3 className="mt-8 text-[15px] font-medium">Écarts à valider</h3>
            {pendingCounts.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">Aucun écart en attente.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {pendingCounts.map((k) => {
                  const v = variance(k.counted, k.expected, config.sales.consignment.varianceTolerancePct);
                  const who = k.site.startsWith("client:") ? data.customers.find((c) => `client:${c.id}` === k.site)?.name : centre.name;
                  return (
                    <li key={k.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-board p-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium">
                          {who} · {STATE_LABEL[k.state].toLowerCase()}
                        </p>
                        <p className="tnum text-[12px] text-muted">
                          {fmtDate(dayOf(k.ts), { day: "numeric", month: "short" })}, {k.by} : {fmt(gridTotal(k.counted))} comptés pour {fmt(gridTotal(k.expected))} attendus ({v.shrinkage ? `${fmt(v.shrinkage)} manquants` : "excédent"}, {fmt(v.pct, 1)} %),{" "}
                          {config.sales.reasons.variance.find((r) => r.code === k.reason)?.label.toLowerCase() ?? "sans motif"}
                          {k.note ? `. ${k.note}` : ""}
                        </p>
                      </div>
                      {can("variance.approve") ? (
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => exec((e) => decideCount(e, k.id, false, ""))}>
                            Refuser
                          </Button>
                          <Button size="sm" onClick={() => exec((e) => decideCount(e, k.id, true, ""))}>
                            Valider l&apos;écart
                          </Button>
                        </div>
                      ) : (
                        <span className="text-[12px] text-muted">Validation par un responsable</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {recentCounts.length > 0 && (
              <>
                <h3 className="mt-8 text-[15px] font-medium">Derniers comptages du magasin</h3>
                <ul className="mt-2 divide-y divide-line text-[14px]">
                  {recentCounts.map((k) => (
                    <li key={k.id} className="flex items-center justify-between gap-3 py-2.5">
                      <span>
                        {cap(fmtDate(dayOf(k.ts), { weekday: "short", day: "numeric", month: "short" }))}, {STATE_LABEL[k.state].toLowerCase()}, {k.by}
                      </span>
                      <TonePill tone={k.status === "VALIDE" ? "ok" : "alert"}>{k.status === "VALIDE" ? "Validé" : "Refusé"}</TonePill>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </TabPanel>
        )}

        {tab === "cloture" && (
          <TabPanel key="cloture" id="cloture">
            <p className="text-[14px] text-muted">
              La clôture fige les mouvements du jour et l&apos;état des bouteilles par marque. Une correction après clôture est un ajustement daté du jour où il est fait.
            </p>
            <ul className="mt-4 divide-y divide-line">
              {days.map((d) => {
                const c = data.closes.find((x) => x.centreId === cid && x.date === d);
                return (
                  <li key={d} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium">{cap(fmtDate(d, { weekday: "long", day: "numeric", month: "long" }))}</span>
                      <span className="block text-[12px] text-muted">
                        {c ? `Clôturée par ${c.by} à ${new Date(c.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : d === today ? "Journée en cours" : "Non clôturée"}
                      </span>
                    </span>
                    {c ? (
                      <TonePill tone="ok">Clôturée</TonePill>
                    ) : d < today ? (
                      <TonePill tone="alert">À clôturer</TonePill>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => csv(d)} aria-label={`État journalier du ${fmtDate(d)} en CSV`}>
                      <FileSpreadsheet className="size-4" />
                      CSV
                    </Button>
                    <ButtonLink size="sm" variant="ghost" href={`/magasin/rapport?c=${cid}&jour=${d}`}>
                      <Printer className="size-4" />
                      Imprimer
                    </ButtonLink>
                    {!c && (
                      <Button size="sm" disabled={!can("day.close")} title={can("day.close") ? undefined : `Réservé au magasinier, au chef de production et à la direction (rôle actuel : ${role.label.toLowerCase()})`} onClick={() => setClosing(d)}>
                        Clôturer
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </TabPanel>
        )}
      </Card>

      <Dialog open={closing !== null} onClose={() => setClosing(null)} title="Clôturer la journée ?" width="max-w-2xl">
        <p className="text-[14px] text-muted">
          {centre.name}, {closing ? fmtDate(closing, { weekday: "long", day: "numeric", month: "long" }) : ""}. L&apos;état ci-dessous sera figé ; plus aucun mouvement ne pourra être daté de ce jour.
        </p>
        <div className="relative mt-4 max-h-72 overflow-auto rounded-2xl bg-board p-3">
          <table className="w-full min-w-[480px] text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th className="pb-1.5 font-medium">Marque, format</th>
                <th className="pb-1.5 pl-3 text-right font-medium">Ouverture</th>
                <th className="pb-1.5 pl-3 text-right font-medium">Entrées</th>
                <th className="pb-1.5 pl-3 text-right font-medium">Sorties</th>
                <th className="pb-1.5 pl-3 text-right font-medium">Clôture</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.brand}-${r.formatId}`} className="border-t border-line">
                  <td className="py-1.5">
                    {brandName(r.brand)}, {label(r.formatId)}
                  </td>
                  <td className="tnum py-1.5 pl-3 text-right">{fmt(r.opening)}</td>
                  <td className="tnum py-1.5 pl-3 text-right">{fmt(r.in)}</td>
                  <td className="tnum py-1.5 pl-3 text-right">{fmt(r.out)}</td>
                  <td className="tnum py-1.5 pl-3 text-right font-semibold">{fmt(r.closing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {closing && closing !== today && open.some((d) => d < closing) && <p className="mt-3 rounded-2xl bg-warn/12 p-3 text-[13px] text-warn-ink">Des journées précédentes ne sont pas clôturées : pensez à les clôturer aussi.</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setClosing(null)}>
            Annuler
          </Button>
          <Button
            onClick={() => {
              const r = exec((e) => closeDay(e, cid, closing ?? today));
              if (r.ok) setClosing(null);
            }}
          >
            <Check className="size-4" />
            Clôturer la journée
          </Button>
        </div>
      </Dialog>

      <Dialog open={modal === "exchange"} onClose={() => setModal(null)} title="Échange inter-marques" width="max-w-xl">
        <p className="text-[14px] text-muted">Vous rendez des vides d&apos;une autre marque et recevez des vides de la vôtre. La position nette de chaque concurrent reste connue.</p>
        <Field label="Société" className="mt-4">
          <Select ariaLabel="Marque échangée" value={ex.brand} onChange={(v) => setEx({ ...ex, brand: v })} options={config.sales.brands.filter((b) => !b.own).map((b) => ({ value: b.id, label: b.name }))} />
        </Field>
        <div className="relative mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] text-[14px]">
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th className="pb-2 font-medium">Format</th>
                <th className="pb-2 pl-3 font-medium">Stock de cette marque</th>
                <th className="pb-2 pl-3 font-medium">Rendues</th>
                <th className="pb-2 pl-3 font-medium">Reçues (votre marque)</th>
              </tr>
            </thead>
            <tbody>
              {formats.map((b) => (
                <tr key={b.id} className="border-t border-line">
                  <td className="py-2 font-medium">{b.label}</td>
                  <td className="tnum py-2 pl-3 text-muted">{fmt(bal.VIDE[ex.brand]?.[b.id] ?? 0)}</td>
                  <td className="py-2 pl-3">
                    <IntegerInput ariaLabel={`Rendues ${b.label}`} value={ex.given[b.id] ?? 0} onChange={(v) => setEx({ ...ex, given: { ...ex.given, [b.id]: v }, received: { ...ex.received, [b.id]: ex.received[b.id] === ex.given[b.id] || ex.received[b.id] == null ? v : ex.received[b.id] } })} />
                  </td>
                  <td className="py-2 pl-3">
                    <IntegerInput ariaLabel={`Reçues ${b.label}`} value={ex.received[b.id] ?? 0} onChange={(v) => setEx({ ...ex, received: { ...ex.received, [b.id]: v } })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setModal(null)}>
            Annuler
          </Button>
          <Button
            onClick={() => {
              const r = exec((e) => exchange(e, { centreId: cid, brand: ex.brand, given: ex.given, received: ex.received }));
              if (r.ok) {
                setModal(null);
                setEx({ ...ex, given: {}, received: {} });
              }
            }}
          >
            Enregistrer l&apos;échange
          </Button>
        </div>
      </Dialog>

      <Dialog open={modal === "adjust"} onClose={() => setModal(null)} title="Ajustement de stock">
        <p className="text-[14px] text-muted">Correction datée de maintenant, avec son motif. Rien n&apos;est réécrit dans les journées clôturées.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="État">
            <Select ariaLabel="État" value={adj.state} onChange={(v) => setAdj({ ...adj, state: v })} options={(["PLEIN", "VIDE", "CASSE"] as const).map((s) => ({ value: s, label: STATE_LABEL[s] }))} />
          </Field>
          <Field label="Marque">
            <Select ariaLabel="Marque" value={adj.brand} onChange={(v) => setAdj({ ...adj, brand: v })} options={[...config.sales.brands.map((b) => ({ value: b.id, label: b.name })), { value: UNKNOWN_BRAND, label: "Marque non identifiée" }]} />
          </Field>
          <Field label="Format">
            <Select ariaLabel="Format" value={adj.formatId} onChange={(v) => setAdj({ ...adj, formatId: v })} options={formats.map((b) => ({ value: b.id, label: b.label }))} />
          </Field>
          <Field label="Sens">
            <Segmented
              label="Sens de l'ajustement"
              value={adj.sign === 1 ? "plus" : "moins"}
              onChange={(v) => setAdj({ ...adj, sign: v === "plus" ? 1 : -1 })}
              options={[
                { value: "plus", label: "Ajouter" },
                { value: "moins", label: "Retirer" },
              ]}
            />
          </Field>
          <Field label="Quantité">
            <IntegerInput ariaLabel="Quantité" value={adj.qty} onChange={(v) => setAdj({ ...adj, qty: v })} />
          </Field>
          <Field label="Motif">
            <Select ariaLabel="Motif" value={adj.reason} onChange={(v) => setAdj({ ...adj, reason: v })} options={config.sales.reasons.adjustment.map((r) => ({ value: r.code, label: r.label }))} />
          </Field>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setModal(null)}>
            Annuler
          </Button>
          <Button
            onClick={() => {
              const r = exec((e) => adjust(e, { centreId: cid, state: adj.state, brand: adj.brand, formatId: adj.formatId, qty: adj.qty * adj.sign, reason: adj.reason }));
              if (r.ok) {
                setModal(null);
                setAdj({ ...adj, qty: 0 });
              }
            }}
          >
            Enregistrer
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

export default function MagasinPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
