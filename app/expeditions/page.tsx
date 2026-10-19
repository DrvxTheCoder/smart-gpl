"use client";

import { Suspense, useMemo } from "react";
import { Card } from "@/components/ui/primitives";
import { DatePicker } from "@/components/ui/calendar";
import { DispatchBoard } from "@/components/sales/dispatch-board";
import { useQuery } from "@/components/sales/use-query";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { dayOf, shiftDate } from "@/lib/sales/dates";
import { fmtDate } from "@/lib/format";

function Inner() {
  const { centreId, centre } = useStore();
  const { data, today } = useSales();
  const [q, setQ] = useQuery({ jour: "" });
  const day = q.jour || today;
  const orders = useMemo(() => new Map(data.orders.map((o) => [o.id, o])), [data.orders]);

  const list = useMemo(
    () =>
      data.dispatches
        .filter((d) => (centreId === "all" || d.centreId === centreId) && orders.get(d.orderId)?.status !== "ANNULEE")
        // Today also shows trucks planned earlier that never came.
        .filter((d) => dayOf(d.slot) === day || (day === today && dayOf(d.slot) < today && d.status !== "EXPEDIE" && d.status !== "LIVRE"))
        .sort((a, b) => a.slot.localeCompare(b.slot)),
    [data.dispatches, centreId, orders, day, today],
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-semibold tracking-[-0.03em] sm:text-[40px]">Expéditions</h1>
          <p className="mt-1 text-[15px] text-muted">
            File des camions, {centreId === "all" ? "tous les centres" : centre(centreId).name}, {fmtDate(day, { weekday: "long", day: "numeric", month: "long" })}. Glissez un camion vers l&apos;étape suivante.
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
        <DispatchBoard list={list} day={day} />
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
