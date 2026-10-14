"use client";

import { useMemo } from "react";
import { Card, CardTitle, CornerLink } from "@/components/ui/primitives";
import { ForecastBars } from "@/components/charts/charts";
import { useCanOpen } from "@/components/shell/access-link";
import { useScopedInventories, useStore } from "@/lib/store";
import { useSalesMaybe } from "@/lib/sales/store";
import { dayOf, shiftDate } from "@/lib/sales/dates";
import { producedBottles } from "@/lib/sales/stock";
import { cap, fmt } from "@/lib/format";
import { BULK } from "@/lib/sales/types";

/** Optional card on the production dashboard: what customers asked for vs what the lines filled, last 7 days. */
export function DemandCard() {
  const { centreId } = useStore();
  const sales = useSalesMaybe();
  const canOpenPath = useCanOpen();
  const invs = useScopedInventories();
  const data = useMemo(() => {
    if (!sales) return [];
    const days = Array.from({ length: 7 }, (_, i) => shiftDate(sales.today, i - 6));
    const scope = (id: string) => centreId === "all" || id === centreId;
    return days.map((d) => {
      let demand = 0;
      for (const o of sales.data.orders) if (scope(o.centreId) && o.date === d && o.status !== "BROUILLON" && o.status !== "ANNULEE") for (const l of o.lines) if (l.formatId !== BULK) demand += l.qty;
      for (const s of sales.data.settlements) if (scope(s.centreId) && s.status === "CONFIRME" && dayOf(s.ts) === d) for (const n of Object.values(s.sold)) demand += n;
      let produced = 0;
      for (const inv of invs) if (inv.date === d && inv.status === "TERMINE") for (const n of Object.values(producedBottles(inv))) produced += n;
      const dt = new Date(`${d}T12:00:00`);
      return {
        label: cap(new Intl.DateTimeFormat("fr-FR", { weekday: "short" }).format(dt)).replace(".", ""),
        full: cap(new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(dt)),
        forecast: demand,
        actual: d < sales.today ? produced : null,
      };
    });
  }, [sales, invs, centreId]);
  if (!sales) return null;
  const demand = data.reduce((a, d) => a + d.forecast, 0);
  const produced = data.reduce((a, d) => a + (d.actual ?? 0), 0);
  return (
    <Card className="mt-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <CardTitle>Demande vs production (7 j)</CardTitle>
          <p className="mt-0.5 text-[13px] text-muted">
            Bouteilles. Hachuré : demandé par les clients ({fmt(demand)}). Plein : rempli par les lignes ({fmt(produced)}).
          </p>
        </div>
        {canOpenPath("/ventes") && <CornerLink href="/ventes" label="Voir les ventes" />}
      </div>
      <div className="h-[200px]">
        <ForecastBars data={data} labels={{ plan: "Demande", done: "Production" }} barGap={0.7} />
      </div>
    </Card>
  );
}
