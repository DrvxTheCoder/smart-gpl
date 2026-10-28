"use client";

import { Suspense, useMemo, useState } from "react";
import { Check, ChevronDown, Lock } from "@/components/ui/icons";
import { Button, Card, CardTitle, Dialog, Segmented, Stepper } from "@/components/ui/primitives";
import { ApprovalBadge, BadgeRow, FillBadge, Meter } from "@/components/sales/ui";
import { useQuery } from "@/components/sales/use-query";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { confirmFill } from "@/lib/sales/commands/orders";
import { dispatchedQty, fillState, ownFulls } from "@/lib/sales/stock";
import { shiftDate } from "@/lib/sales/dates";
import { MODE } from "@/lib/sales/labels";
import { cap, cn, fmt, fmtDate, fmtT } from "@/lib/format";
import type { Order } from "@/lib/sales/types";

type View = "todo" | "done" | "all";

/**
 * Production's view of the bons de commande: what the sales team confirmed,
 * what is left to fill per format, and the confirmation that it is filled.
 * The trucks load only what production confirmed (when the step is on).
 */
function Inner() {
  const { config, centreId, centre } = useStore();
  const { data, ledger, today, own, exec, can, role } = useSales();
  const [q, setQ] = useQuery({ vue: "todo" });
  const view = (["todo", "done", "all"].includes(q.vue) ? q.vue : "todo") as View;
  const [editing, setEditing] = useState<Order | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const tomorrow = shiftDate(today, 1);
  const names = useMemo(() => new Map(data.customers.map((c) => [c.id, c.name])), [data.customers]);
  const label = (f: string) => config.bottleTypes.find((b) => b.id === f)?.label ?? f;
  const kg = (f: string) => config.bottleTypes.find((b) => b.id === f)?.kg ?? 0;
  const allowed = can("order.fill");
  const stepOn = config.sales.workflow.steps.fillConfirmation;

  const rows = useMemo(
    () =>
      data.orders
        .filter((o) => (centreId === "all" || o.centreId === centreId) && (o.status === "CONFIRMEE" || o.status === "EXPEDIEE"))
        .map((o) => ({ o, st: fillState(o) }))
        .filter((r): r is { o: Order; st: NonNullable<ReturnType<typeof fillState>> } => r.st != null)
        .filter(({ st }) => (view === "todo" ? st.status !== "REMPLIE" : view === "done" ? st.status === "REMPLIE" : true))
        .sort((a, b) => a.o.date.localeCompare(b.o.date) || a.o.createdAt.localeCompare(b.o.createdAt)),
    [data.orders, centreId, view],
  );
  const groups = [
    { id: "late", title: "En retard", match: (d: string) => d < today },
    { id: "today", title: "Aujourd'hui", match: (d: string) => d === today },
    { id: "tomorrow", title: "Demain", match: (d: string) => d === tomorrow },
    { id: "later", title: "Plus tard", match: (d: string) => d > tomorrow },
  ];

  // What the lines must fill by tomorrow, against the fulls already in stock.
  const due = useMemo(() => {
    const out: Record<string, number> = {};
    for (const o of data.orders) {
      if ((centreId !== "all" && o.centreId !== centreId) || (o.status !== "CONFIRMEE" && o.status !== "EXPEDIEE") || o.date > tomorrow) continue;
      const st = fillState(o);
      if (st) for (const [f, n] of Object.entries(st.toFill)) out[f] = (out[f] ?? 0) + n;
    }
    return out;
  }, [data.orders, centreId, tomorrow]);
  const stock = useMemo(() => {
    const ids = centreId === "all" ? config.centres.map((c) => c.id) : [centreId];
    const out: Record<string, number> = {};
    for (const id of ids) for (const [f, n] of Object.entries(ownFulls(ledger, id, own))) out[f] = (out[f] ?? 0) + n;
    return out;
  }, [ledger, centreId, config.centres, own]);
  const dueTotal = Object.values(due).reduce((a, b) => a + b, 0);
  const dueT = Object.entries(due).reduce((a, [f, n]) => a + (n * kg(f)) / 1000, 0);

  const open = (o: Order) => {
    const st = fillState(o);
    if (!st) return;
    setQty({ ...st.filled });
    setEditing(o);
  };
  const editState = editing ? fillState(editing) : null;
  const sentOf = editing ? dispatchedQty(data.dispatches, editing.id) : {};

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-semibold tracking-[-0.03em] sm:text-[40px]">Remplissage</h1>
          <p className="mt-1 text-[15px] text-muted">Bons de commande confirmés par le service commercial, {centreId === "all" ? "tous les centres" : centre(centreId).name}.</p>
        </div>
        <Segmented
          label="Afficher"
          value={view}
          onChange={(v) => setQ({ vue: v })}
          options={[
            { value: "todo", label: "À remplir" },
            { value: "done", label: "Remplis" },
            { value: "all", label: "Tous" },
          ]}
        />
      </div>

      {!stepOn && (
        <p className="mb-4 rounded-2xl bg-board px-4 py-3 text-[14px] text-muted">
          La confirmation du remplissage est désactivée dans les paramètres : elle reste indicative et ne bloque pas le chargement.
        </p>
      )}
      {!allowed && (
        <p className="mb-4 flex items-center gap-2 rounded-2xl bg-brand-100 px-4 py-3 text-[14px] text-brand-deep">
          <Lock className="size-4 shrink-0" />
          Lecture seule : la confirmation du remplissage revient à la production. Rôle actuel : {role.label.toLowerCase()}.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {rows.length === 0 && (
            <Card>
              <p className="py-10 text-center text-muted">{view === "todo" ? "Rien à remplir : tous les bons de commande confirmés sont remplis." : "Aucun bon de commande dans cette vue."}</p>
            </Card>
          )}
          {groups.map((g) => {
            const items = rows.filter(({ o }) => g.match(o.date));
            if (!items.length) return null;
            return (
              <Card key={g.id} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <CardTitle className={g.id === "late" ? "text-alert" : undefined}>{g.title}</CardTitle>
                  <span className="tnum text-[13px] text-muted">{items.length}</span>
                </div>
                <ul className="mt-3 divide-y divide-line">
                  {items.map(({ o, st }) => {
                    const waiting = o.approval.required && !o.approval.by;
                    const formats = Object.keys(st.need);
                    const need = formats.reduce((a, f) => a + st.need[f], 0);
                    const filled = formats.reduce((a, f) => a + Math.min(st.filled[f] ?? 0, st.need[f]), 0);
                    const pct = need ? (filled / need) * 100 : 100;
                    const isOpen = expanded.has(o.id);
                    const panel = `detail-${o.id}`;
                    return (
                      <li key={o.id} className="py-3">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <div className="min-w-0 flex-1 basis-56">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-[15px] font-medium whitespace-nowrap">{o.number}</span>
                              <BadgeRow>
                                <FillBadge status={st.status} />
                                {waiting && <ApprovalBadge short />}
                              </BadgeRow>
                            </div>
                            <p className="text-[13px] text-muted">
                              {names.get(o.customerId)}, {MODE[o.mode].toLowerCase()} {cap(fmtDate(o.date, { weekday: "short", day: "numeric", month: "short" }))}
                            </p>
                          </div>
                          <div className="flex w-full items-center gap-2 sm:w-auto">
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              aria-controls={panel}
                              aria-label={`Détail par format, ${fmt(filled)} bouteilles remplies sur ${fmt(need)}`}
                              onClick={() => toggle(o.id)}
                              className="flex min-h-11 flex-1 items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-board focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:outline-none sm:w-48 sm:flex-none"
                            >
                              <span className="min-w-0 flex-1" aria-hidden>
                                <span className="tnum flex items-baseline justify-between gap-2 text-[13px] whitespace-nowrap">
                                  <span>
                                    <b className="font-semibold">{fmt(filled)}</b>
                                    <span className="text-muted"> / {fmt(need)}</span>
                                  </span>
                                  <span className="text-[12px] text-muted">
                                    {formats.length} format{formats.length > 1 ? "s" : ""}
                                  </span>
                                </span>
                                <span className="mt-1 block">
                                  <Meter pct={pct} label="" />
                                </span>
                              </span>
                              <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none", isOpen && "rotate-180")} />
                            </button>
                            {allowed && (
                              <Button size="sm" variant={st.status === "REMPLIE" ? "ghost" : "soft"} className="h-11 shrink-0" onClick={() => open(o)}>
                                {st.status === "REMPLIE" ? "Corriger" : "Confirmer"}
                                <span className="sr-only"> le remplissage de {o.number}</span>
                              </Button>
                            )}
                          </div>
                        </div>
                        <div
                          id={panel}
                          inert={!isOpen}
                          aria-hidden={!isOpen}
                          className={cn("grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
                        >
                          <div className="min-h-0 overflow-hidden">
                            <ul className="mt-2 grid grid-cols-2 gap-x-5 gap-y-3 rounded-2xl bg-board p-3 sm:grid-cols-3 lg:grid-cols-5">
                              {formats.map((f) => {
                                const p = st.need[f] ? (st.filled[f] / st.need[f]) * 100 : 100;
                                return (
                                  <li key={f} className="min-w-0">
                                    <p className="tnum text-[13px]">
                                      <b className="font-semibold">{label(f)}</b> {fmt(st.filled[f])}
                                      <span className="text-muted"> / {fmt(st.need[f])}</span>
                                    </p>
                                    <div className="mt-1">
                                      <Meter pct={p} label={`${label(f)} rempli à ${fmt(p)} %`} />
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>

        <Card className="h-fit xl:sticky xl:top-[100px]">
          <CardTitle>À remplir d&apos;ici demain</CardTitle>
          <p className="tnum mt-3 text-[26px] font-semibold tracking-[-0.02em]">
            {fmt(dueTotal)}
            <span className="ml-1 text-[14px] font-medium text-muted">bouteilles, {fmtT(dueT, 1)}</span>
          </p>
          <table className="mt-4 w-full text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th className="pb-2 font-medium">Format</th>
                <th className="pb-2 text-right font-medium">À remplir</th>
                <th className="pb-2 text-right font-medium">Pleins en stock</th>
              </tr>
            </thead>
            <tbody>
              {config.bottleTypes.map((b) => (
                <tr key={b.id} className="border-t border-line">
                  <td className="py-2 font-medium">{b.label}</td>
                  <td className="tnum py-2 text-right">{fmt(due[b.id] ?? 0)}</td>
                  <td className={cn("tnum py-2 text-right", (stock[b.id] ?? 0) < (due[b.id] ?? 0) ? "text-warn" : "text-muted")}>{fmt(stock[b.id] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[12px] text-faint">Les pleins en stock peuvent servir une commande : confirmez-la remplie dès que les bouteilles sont prêtes, du stock ou des lignes.</p>
        </Card>
      </div>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing ? `Remplissage de ${editing.number}` : ""}>
        {editing && editState && (
          <>
            <p className="text-[14px] text-muted">
              {names.get(editing.customerId)}, {MODE[editing.mode].toLowerCase()} le {fmtDate(editing.date, { day: "numeric", month: "long" })}. Indiquez les bouteilles prêtes pour ce bon de commande.
            </p>
            <div className="mt-4 divide-y divide-line">
              {Object.keys(editState.need).map((f) => (
                <div key={f} className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 py-2.5">
                  <span className="text-[15px] font-semibold">{label(f)}</span>
                  <Stepper ariaLabel={`Rempli ${label(f)}`} value={qty[f] ?? 0} step={kg(f) >= 30 ? 1 : 10} min={sentOf[f] ?? 0} onChange={(n) => setQty({ ...qty, [f]: Math.min(n, editState.need[f]) })} />
                  <span className="tnum text-[12px] text-muted">sur {fmt(editState.need[f])}</span>
                </div>
              ))}
            </div>
            <Button size="sm" variant="soft" className="mt-3" onClick={() => setQty({ ...editState.need })}>
              <Check className="size-4" />
              Tout est rempli
            </Button>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Annuler
              </Button>
              <Button
                onClick={() => {
                  const r = exec((e) => confirmFill(e, editing.id, qty));
                  if (r.ok) setEditing(null);
                }}
              >
                Confirmer
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}

export default function RemplissagePage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
