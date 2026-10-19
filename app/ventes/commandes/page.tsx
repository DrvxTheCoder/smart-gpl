"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileSpreadsheet, Plus, Search } from "@/components/ui/icons";
import { DatePicker } from "@/components/ui/calendar";
import { markExported, salesToExport } from "@/lib/sales/commands/export";
import { sageCsv } from "@/lib/sales/sage";
import { shiftDate } from "@/lib/sales/dates";
import { Button, Card, CardTitle, inputCls } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { OrderEntry } from "@/components/sales/order-entry";
import { ApprovalBadge, Badge, BadgeRow, OrderBadge } from "@/components/sales/ui";
import { useQuery, useQueryText } from "@/components/sales/use-query";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { dispatchedQty, remainingQty } from "@/lib/sales/stock";
import { isPartial, ORDER_STATUS } from "@/lib/sales/lifecycle";
import { linesAmount } from "@/lib/sales/pricing";
import { MODE } from "@/lib/sales/labels";
import { cap, cn, fmtDate, fmtMoney } from "@/lib/format";
import { BULK, type OrderStatus } from "@/lib/sales/types";

const PAGE = 12;
const SPECIAL = { validation: "À valider", partielle: "Partielles", reliquat: "Avec reliquat" } as const;

function Inner() {
  const { config, centreId, centre, startJob } = useStore();
  const { data, env, exec, today } = useSales();
  const [range, setRange] = useState({ from: shiftDate(today, -7), to: shiftDate(today, -1) });
  const toExport = useMemo(() => salesToExport(env, { ...range, centreId }), [env, range, centreId]);
  const exportSage = () =>
    startJob({
      kind: "sage",
      busyMsg: "Un export Sage est déjà en cours",
      doneMsg: "Export Sage téléchargé",
      run: async (onProgress) => {
        onProgress(0.3);
        const ctx = { format: (f: string) => config.bottleTypes.find((b) => b.id === f)?.label ?? f, centre: (id: string) => config.centres.find((c) => c.id === id)?.code ?? id };
        const file = sageCsv(toExport, config.sales.reports.sage, ctx, { centre: centreId === "all" ? "TOUS" : centre(centreId).code, date: range.to });
        exec((e) => markExported(e, toExport));
        onProgress(1);
        return file;
      },
    });
  const [query, setQuery] = useQuery({ q: "", statut: "all", page: "1", nouveau: "", client: "" });
  const [q, setQ] = useQueryText(query.q, (v) => setQuery({ q: v, page: "1" }));
  const cur = config.sales.currency.label;
  const name = useMemo(() => new Map(data.customers.map((c) => [c.id, c])), [data.customers]);

  const rows = useMemo(
    () =>
      data.orders
        .filter((o) => centreId === "all" || o.centreId === centreId)
        .map((o) => {
          const sent = dispatchedQty(data.dispatches, o.id);
          return { o, amount: linesAmount(o.lines), partial: isPartial(o, sent, remainingQty(o, data.dispatches)) };
        })
        .sort((a, b) => b.o.createdAt.localeCompare(a.o.createdAt)),
    [data.orders, data.dispatches, centreId],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(({ o, partial }) => {
      const s = query.statut;
      if (s === "validation" && !(o.status === "CONFIRMEE" && o.approval.required && !o.approval.by)) return false;
      if (s === "partielle" && !partial) return false;
      if (s === "reliquat" && !o.reliquats.length) return false;
      if (s in ORDER_STATUS && o.status !== s) return false;
      if (!term) return true;
      const c = name.get(o.customerId);
      return [o.number, c?.name, c?.code, c?.zone, fmtDate(o.date)].join(" ").toLowerCase().includes(term);
    });
  }, [rows, q, query.statut, name]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const { o, partial } of rows) {
      m[o.status] = (m[o.status] ?? 0) + 1;
      if (o.status === "CONFIRMEE" && o.approval.required && !o.approval.by) m.validation = (m.validation ?? 0) + 1;
      if (partial) m.partielle = (m.partielle ?? 0) + 1;
      if (o.reliquats.length) m.reliquat = (m.reliquat ?? 0) + 1;
    }
    return m;
  }, [rows]);

  const pages = Math.max(Math.ceil(filtered.length / PAGE), 1);
  const page = Math.min(Math.max(Number(query.page) || 1, 1), pages) - 1;
  const slice = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const todo = rows.filter(({ o }) => o.status === "BROUILLON" || (o.status === "CONFIRMEE" && o.approval.required && !o.approval.by)).slice(0, 6);
  const filters: { value: string; label: string }[] = [
    { value: "all", label: "Tous les statuts" },
    ...(Object.keys(ORDER_STATUS) as OrderStatus[]).map((s) => ({ value: s, label: `${ORDER_STATUS[s].label} (${counts[s] ?? 0})` })),
    ...(Object.keys(SPECIAL) as (keyof typeof SPECIAL)[]).map((s) => ({ value: s, label: `${SPECIAL[s]} (${counts[s] ?? 0})` })),
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-semibold tracking-[-0.03em] sm:text-[40px]">Commandes</h1>
          <p className="mt-1 text-[15px] text-muted">Bons de commande, du brouillon à la clôture, {centreId === "all" ? "tous les centres" : centre(centreId).name}.</p>
        </div>
        <Button onClick={() => setQuery({ nouveau: "1" })}>
          <Plus className="size-4" />
          Nouvelle commande
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex w-full max-w-xl flex-wrap gap-2 sm:flex-nowrap">
              <div className="relative w-full">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Numéro, client, date" aria-label="Filtrer les commandes" className={cn(inputCls, "pl-9")} />
              </div>
              <Select className="sm:w-[240px] sm:shrink-0" ariaLabel="Statut" value={query.statut} onChange={(v) => setQuery({ statut: v, page: "1" })} options={filters} />
            </div>
            <p className="tnum text-[13px] text-muted">
              <b className="font-semibold text-ink">{filtered.length}</b> commande{filtered.length > 1 ? "s" : ""}
            </p>
          </div>

          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[14px]">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th className="py-2.5 pr-3 font-medium">Commande</th>
                  <th className="py-2.5 pr-3 font-medium">Client</th>
                  <th className="py-2.5 pr-3 text-right font-medium">Montant</th>
                  <th className="py-2.5 pr-3 font-medium">Statut</th>
                  <th className="py-2.5 font-medium">
                    <span className="sr-only">Ouvrir</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {slice.map(({ o, amount, partial }) => {
                  const c = name.get(o.customerId);
                  const waiting = o.status === "CONFIRMEE" && o.approval.required && !o.approval.by;
                  return (
                    <tr key={o.id} className="group border-b border-line last:border-0">
                      <td className="py-3 pr-3">
                        <p className="font-medium whitespace-nowrap">{o.number}</p>
                        <p className="text-[12px] text-muted">
                          {cap(fmtDate(o.date, { weekday: "short", day: "numeric", month: "short" }))}, {MODE[o.mode].toLowerCase()}
                          {o.lines.some((l) => l.formatId === BULK) ? ", vrac" : ""}
                        </p>
                      </td>
                      <td className="py-3 pr-3">
                        <p className="max-w-[240px] truncate">{c?.name ?? "Client supprimé"}</p>
                        <p className="text-[12px] text-muted">{c?.code}</p>
                      </td>
                      <td className="tnum py-3 pr-3 text-right whitespace-nowrap">{fmtMoney(amount, cur)}</td>
                      <td className="py-3 pr-3">
                        <BadgeRow>
                          <OrderBadge status={o.status} partial={partial} />
                          {waiting && <ApprovalBadge />}
                          {o.reliquats.length > 0 && <Badge tone="muted">Reliquat</Badge>}
                        </BadgeRow>
                      </td>
                      <td className="py-3 text-right">
                        <Link
                          href={`/ventes/commandes/${o.id}`}
                          aria-label={`Ouvrir la commande ${o.number}`}
                          className="inline-flex h-8 items-center rounded-full border border-line px-3 text-[13px] font-medium group-hover:border-brand-800 group-hover:bg-brand-50"
                        >
                          {o.status === "BROUILLON" ? "Reprendre" : "Voir"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {slice.length === 0 && (
              <p className="py-10 text-center text-muted">
                {rows.length ? "Aucune commande ne correspond. Essayez un numéro comme « BC-RUF » ou un nom de client." : "Aucune commande pour ce centre. Créez la première avec « Nouvelle commande »."}
              </p>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="tnum text-[13px] text-muted">
              Page {page + 1} sur {pages}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setQuery({ page: String(page) })} aria-label="Page précédente">
                <ChevronLeft className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setQuery({ page: String(page + 2) })} aria-label="Page suivante">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>À traiter</CardTitle>
            <p className="mt-1 text-[13px] text-muted">Brouillons à confirmer et commandes qui attendent un responsable.</p>
            {todo.length === 0 ? (
              <p className="py-6 text-center text-[14px] text-muted">Rien en attente.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {todo.map(({ o, amount }) => (
                  <li key={o.id}>
                    <Link href={`/ventes/commandes/${o.id}`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-board">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium">{name.get(o.customerId)?.name}</span>
                        <span className="tnum block text-[12px] text-muted">
                          {o.number}, {fmtMoney(amount, cur)}
                        </span>
                      </span>
                      {o.status === "BROUILLON" ? <OrderBadge status="BROUILLON" /> : <ApprovalBadge />}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardTitle>Export vers Sage</CardTitle>
            <p className="mt-1 text-[13px] text-muted">Les ventes expédiées et les passages des grossistes, une ligne par format. La facturation reste dans Sage.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <DatePicker ariaLabel="Du" value={range.from} max={range.to} onChange={(v) => v && setRange({ ...range, from: v })} />
              <DatePicker ariaLabel="Au" value={range.to} min={range.from} max={today} onChange={(v) => v && setRange({ ...range, to: v })} />
            </div>
            <p className="tnum mt-2 text-[13px] text-muted">
              {toExport.length} ligne{toExport.length > 1 ? "s" : ""}, {fmtMoney(toExport.reduce((a, l) => a + l.amount, 0), cur)}
            </p>
            {config.sales.reports.sage.placeholder && <p className="mt-2 text-[12px] text-[#7a5306]">Colonnes provisoires : à aligner sur l&apos;import Sage du client (Paramètres, Rapports).</p>}
            <Button variant="ghost" className="mt-3 w-full" disabled={!toExport.length} onClick={exportSage}>
              <FileSpreadsheet className="size-4" />
              Exporter en CSV
            </Button>
          </Card>
          <Card>
            <CardTitle>Par statut</CardTitle>
            <ul className="mt-3 flex flex-wrap gap-2">
              {(["BROUILLON", "CONFIRMEE", "EXPEDIEE", "LIVREE"] as const).map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    aria-pressed={query.statut === s}
                    onClick={() => setQuery({ statut: query.statut === s ? "all" : s, page: "1" })}
                    className={cn("tnum h-9 rounded-full border px-3.5 text-[13px] transition-colors", query.statut === s ? "border-brand-800 bg-brand-800 text-white" : "border-line bg-white hover:border-brand-600")}
                  >
                    {ORDER_STATUS[s].label} {counts[s] ?? 0}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <OrderEntry open={query.nouveau === "1"} onClose={() => setQuery({ nouveau: "", client: "" })} initialCustomer={query.client || null} />
    </div>
  );
}

export default function CommandesPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
