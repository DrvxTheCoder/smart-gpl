"use client";

import { AccessLink } from "@/components/shell/access-link";
import { useMemo, useState } from "react";
import { Truck } from "@/components/ui/icons";
import { Button, Dialog } from "@/components/ui/primitives";
import { useSalesMaybe } from "@/lib/sales/store";
import { dayOf } from "@/lib/sales/dates";
import { fmt } from "@/lib/format";
import { BULK } from "@/lib/sales/types";
import type { FlowField } from "@/lib/types";

/**
 * Bulk trucks expedited that day, beside the bulk outflows typed in the
 * inventory. Never written silently: « Reprendre » asks first.
 */
export function BulkShipments({ centreId, date, field, entered, editable, onTake }: { centreId: string; date: string; field: FlowField | undefined; entered: number; editable: boolean; onTake: (t: number) => void }) {
  const sales = useSalesMaybe();
  const [asking, setAsking] = useState(false);
  const trucks = useMemo(
    () => (sales?.data.dispatches ?? []).filter((d) => d.centreId === centreId && dayOf(d.slot) === date && (d.status === "EXPEDIE" || d.status === "LIVRE") && (d.loaded[BULK] ?? 0) > 0),
    [sales, centreId, date],
  );
  if (!field) return null;
  const t = Math.round(trucks.reduce((a, d) => a + (d.loaded[BULK] ?? 0), 0) / 100) / 10;
  const differs = Math.abs(t - entered) >= 0.05;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl bg-board px-4 py-3">
      <Truck className="size-[18px] shrink-0 text-brand-800" />
      <div className="min-w-0 flex-1">
        <p className="tnum text-[14px]">
          Expéditions vrac enregistrées : <b className="font-semibold">{fmt(t, 1)} T</b>
        </p>
        <p className="text-[12px] text-muted">
          {trucks.length ? `${trucks.length} camion${trucks.length > 1 ? "s" : ""} pesé${trucks.length > 1 ? "s" : ""}, BL émis. ` : "Aucun BL vrac émis ce jour-là. "}
          {differs ? `Écart avec « ${field.label} » : ${fmt(entered - t, 1)} T.` : `Concorde avec « ${field.label} ».`}{" "}
          <AccessLink href="/expeditions" className="text-brand-800 hover:underline">
            Voir les expéditions
          </AccessLink>
        </p>
      </div>
      {editable && differs && trucks.length > 0 && (
        <Button size="sm" variant="soft" onClick={() => setAsking(true)}>
          Reprendre
        </Button>
      )}
      <Dialog open={asking} onClose={() => setAsking(false)} title="Reprendre les expéditions vrac ?">
        <p className="text-[14px] text-muted">
          « {field.label} » passe de {fmt(entered, 1)} T à {fmt(t, 1)} T, total des pesées nettes des BL de la journée. Les autres sorties ne changent pas.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAsking(false)}>
            Garder la saisie
          </Button>
          <Button
            onClick={() => {
              onTake(t);
              setAsking(false);
            }}
          >
            Reprendre {fmt(t, 1)} T
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
