"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Bell } from "@/components/ui/icons";
import { Popover, panelCls } from "@/components/ui/popover";
import { TonePill } from "@/components/sales/ui";
import { useStore } from "@/lib/store";
import { useSalesMaybe } from "@/lib/sales/store";
import { alerts, type Alert } from "@/lib/sales/alerts";
import { cn } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { canOpen } from "@/lib/modules";
import { fillState } from "@/lib/sales/stock";
import { shiftDate } from "@/lib/sales/dates";

const KIND_LABEL: Record<Alert["kind"], string> = { GROSSISTE: "Grossiste", VALIDATION: "Validation", ECART: "Écart", CLOTURE: "Clôture" };

/** Derived alerts, counted on the bell; the list opens in a popover. Nothing is stored. */
export function AlertBell() {
  const { config, centreId, inventories, centre } = useStore();
  const sales = useSalesMaybe();
  const { account } = useAuth();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);

  const list = useMemo(() => {
    const out: (Alert & { label: string })[] = [];
    const mods = account?.modules ?? [];
    for (const inv of inventories)
      if (inv.status === "EN_COURS" && (centreId === "all" || inv.centreId === centreId))
        out.push({ id: `inv-${inv.id}`, kind: "CLOTURE", tone: "warn", title: "Inventaire du jour en cours", detail: centre(inv.centreId).name, href: `/inventaires/${inv.id}`, label: "Production" });
    if (sales) {
      // Production's queue: confirmed orders whose bottles are not all filled, due by tomorrow.
      const due = shiftDate(sales.today, 1);
      const toFill = sales.data.orders.filter((o) => (centreId === "all" || o.centreId === centreId) && (o.status === "CONFIRMEE" || o.status === "EXPEDIEE") && o.date <= due && fillState(o) != null && fillState(o)?.status !== "REMPLIE");
      if (toFill.length) out.push({ id: "fill", kind: "VALIDATION", tone: "warn", title: `${toFill.length} bon${toFill.length > 1 ? "s" : ""} de commande à remplir`, detail: "Pour aujourd'hui et demain", href: "/remplissage", label: "Remplissage" });
      for (const a of alerts({ cfg: config, data: sales.data, ledger: sales.ledger, today: sales.today, own: sales.own, centreId })) out.push({ ...a, label: KIND_LABEL[a.kind] });
    }
    // Each account sees the alerts of the modules it can open.
    return out.filter((a) => canOpen(mods, a.href));
  }, [inventories, centreId, centre, sales, config, account]);
  const urgent = list.filter((a) => a.tone === "alert").length;

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="relative grid size-11 place-items-center rounded-full bg-card"
        aria-label={list.length ? `Notifications, ${list.length} alerte${list.length > 1 ? "s" : ""}` : "Notifications, aucune alerte"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell className="size-[19px]" />
        {list.length > 0 && (
          <span className={cn("tnum absolute -top-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-semibold text-white ring-2 ring-card", urgent ? "bg-alert" : "bg-brand-800")} aria-hidden>
            {list.length}
          </span>
        )}
      </button>
      <Popover open={open} anchor={anchor} onDismiss={() => setOpen(false)} align="end" role="dialog" aria-label="Alertes">
        <div className={cn(panelCls, "w-[min(380px,calc(100vw-16px))] p-1.5")}>
          <p className="px-3 pt-2 pb-1.5 text-[13px] font-medium">{list.length ? `${list.length} alerte${list.length > 1 ? "s" : ""}` : "Aucune alerte"}</p>
          {list.length === 0 ? (
            <p className="px-3 pb-4 text-[13px] text-muted">Rien en attente pour ce centre.</p>
          ) : (
            <ul className="scroll-area max-h-[min(420px,60vh)] overflow-y-auto">
              {list.map((a) => (
                <li key={a.id}>
                  <Link href={a.href} onClick={() => setOpen(false)} className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-board">
                    <TonePill tone={a.tone} className="mt-0.5">
                      {a.label}
                    </TonePill>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium">{a.title}</span>
                      <span className="block text-[12px] text-muted">{a.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Popover>
    </>
  );
}
