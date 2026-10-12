"use client";

import Link from "next/link";
import { Suspense, useMemo } from "react";
import { ChevronRight, Truck } from "@/components/ui/icons";
import { Card, CardTitle } from "@/components/ui/primitives";
import { DatePicker } from "@/components/ui/calendar";
import { DispatchBadge } from "@/components/sales/ui";
import { useQuery } from "@/components/sales/use-query";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { dayOf, shiftDate } from "@/lib/sales/dates";
import { MODE } from "@/lib/sales/labels";
import { cap, cn, fmt, fmtDate } from "@/lib/format";
import { BULK, type Dispatch } from "@/lib/sales/types";

const GROUPS: { id: string; title: string; sub: string; match: (d: Dispatch) => boolean }[] = [
  { id: "cours", title: "En cours", sub: "Au portail ou au chargement", match: (d) => d.status === "EN_CHARGEMENT" || d.status === "CHARGE" },
  { id: "venir", title: "À venir", sub: "Planifiés, pas encore au portail", match: (d) => d.status === "PLANIFIE" },
  { id: "partis", title: "Partis", sub: "BL émis", match: (d) => d.status === "EXPEDIE" || d.status === "LIVRE" },
];

function Inner() {
  const { config, centreId, centre } = useStore();
  const { data, today } = useSales();
  const [q, setQ] = useQuery({ jour: "" });
  const day = q.jour || today;
  const orders = useMemo(() => new Map(data.orders.map((o) => [o.id, o])), [data.orders]);
  const names = useMemo(() => new Map(data.customers.map((c) => [c.id, c.name])), [data.customers]);

  const list = useMemo(
    () =>
      data.dispatches
        .filter((d) => (centreId === "all" || d.centreId === centreId) && orders.get(d.orderId)?.status !== "ANNULEE")
        // Today also shows trucks planned earlier that never came.
        .filter((d) => dayOf(d.slot) === day || (day === today && dayOf(d.slot) < today && d.status !== "EXPEDIE" && d.status !== "LIVRE"))
        .sort((a, b) => a.slot.localeCompare(b.slot)),
    [data.dispatches, centreId, orders, day, today],
  );
  const label = (f: string) => (f === BULK ? "vrac" : config.bottleTypes.find((b) => b.id === f)?.label ?? f);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-semibold tracking-[-0.03em] sm:text-[40px]">Expéditions</h1>
          <p className="mt-1 text-[15px] text-muted">
            File des camions, {centreId === "all" ? "tous les centres" : centre(centreId).name}, {fmtDate(day, { weekday: "long", day: "numeric", month: "long" })}.
          </p>
        </div>
        <div className="w-full sm:w-64">
          <DatePicker ariaLabel="Jour" value={day} max={shiftDate(today, 14)} onChange={(v) => setQ({ jour: v && v !== today ? v : "" })} />
        </div>
      </div>

      {list.length === 0 ? (
        <Card>
          <p className="py-10 text-center text-muted">Aucun camion ce jour-là. Un camion se planifie depuis une commande confirmée.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {GROUPS.map((g) => {
            const items = list.filter(g.match);
            return (
              <Card key={g.id} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <CardTitle>{g.title}</CardTitle>
                  <span className="tnum text-[13px] text-muted">{items.length}</span>
                </div>
                <p className="mt-0.5 text-[13px] text-muted">{g.sub}</p>
                {items.length === 0 ? (
                  <p className="py-6 text-center text-[14px] text-muted">Aucun.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {items.map((d) => {
                      const o = orders.get(d.orderId);
                      const late = dayOf(d.slot) < day;
                      return (
                        <li key={d.id}>
                          <Link href={`/expeditions/${d.id}`} className="flex min-h-[72px] items-center gap-3 rounded-2xl bg-board p-3 transition-colors hover:bg-brand-50">
                            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-card text-brand-800">
                              <Truck className="size-5" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="tnum text-[13px] font-semibold">{new Date(d.slot).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                                <span className="truncate text-[15px] font-medium">{names.get(d.customerId)}</span>
                              </span>
                              <span className="block truncate text-[12px] text-muted">
                                {d.truck} · {d.number}
                                {o ? ` · ${MODE[o.mode].toLowerCase()}` : ""}
                              </span>
                              <span className="tnum block truncate text-[12px] text-muted">
                                {Object.entries(d.loaded)
                                  .filter(([, n]) => n)
                                  .map(([f, n]) => (f === BULK ? `vrac ${fmt(n / 1000, 1)} T` : `${label(f)} ${fmt(n)}`))
                                  .join(", ")}
                              </span>
                            </span>
                            <span className="flex flex-col items-end gap-1">
                              <DispatchBadge status={d.status} />
                              {late && <span className={cn("rounded-md px-1.5 text-[11px] font-medium text-alert")}>Prévu {cap(fmtDate(dayOf(d.slot), { weekday: "short", day: "numeric" }))}</span>}
                            </span>
                            <ChevronRight className="size-4 shrink-0 text-faint" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ExpeditionsPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
