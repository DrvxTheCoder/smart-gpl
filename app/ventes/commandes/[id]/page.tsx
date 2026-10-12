"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, Lock, Truck } from "@/components/ui/icons";
import { Button, Card, CardTitle, Dialog, Field, inputCls } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/calendar";
import { TimePicker } from "@/components/ui/time-picker";
import { CheckPanel, QtyGrid } from "@/components/sales/order-entry";
import { DispatchBadge, Missing, OrderBadge, TabPanel, TabStrip } from "@/components/sales/ui";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { approveOrder, cancelOrder, checkOrder, closeOrder, confirmOrder, declareReliquat, planDispatch, saveDraft } from "@/lib/sales/commands/orders";
import { dispatchedQty, plannedQty, remainingQty } from "@/lib/sales/stock";
import { DISPATCH_STATUS, isPartial } from "@/lib/sales/lifecycle";
import { linesAmount } from "@/lib/sales/pricing";
import { customerPosition } from "@/lib/sales/selectors";
import { dayOf } from "@/lib/sales/dates";
import { MODE } from "@/lib/sales/labels";
import { cap, cn, fmt, fmtDate, fmtMoney, fmtMoneyShort } from "@/lib/format";
import { BULK } from "@/lib/sales/types";

type Tab = "lignes" | "expeditions" | "historique";
type Modal = null | "confirm" | "approve" | "plan" | "reliquat" | "cancel";

export default function CommandePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { config } = useStore();
  const { data, env, exec, can, today } = useSales();
  const order = data.orders.find((o) => o.id === decodeURIComponent(id));
  const [tab, setTab] = useState<Tab>("lignes");
  const [modal, setModal] = useState<Modal>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [override, setOverride] = useState("");
  const [ackShort, setAckShort] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [relReason, setRelReason] = useState(config.sales.reasons.reliquat[0]?.code ?? "");
  const [rectify, setRectify] = useState(true);
  const [truck, setTruck] = useState({ truck: "", driver: "", date: today, time: "09:00" });
  const cur = config.sales.currency.label;

  const check = useMemo(() => (order && order.status === "BROUILLON" ? checkOrder(env, order, override.trim() ? { by: env.by, reason: override } : null) : null), [order, env, override]);
  const customer = order ? data.customers.find((c) => c.id === order.customerId) : undefined;
  const pos = useMemo(() => (customer ? customerPosition(env, customer) : null), [customer, env]);

  if (!order) return <Missing text="Cette commande n'existe pas." href="/ventes/commandes" back="Revenir à la liste des commandes" />;

  const centre = config.centres.find((c) => c.id === order.centreId);
  const sent = dispatchedQty(data.dispatches, order.id);
  const planned = plannedQty(data.dispatches, order.id);
  const rem = remainingQty(order, data.dispatches);
  const amount = linesAmount(order.lines);
  const partial = isPartial(order, sent, rem);
  const trucks = data.dispatches.filter((d) => d.orderId === order.id).sort((a, b) => a.slot.localeCompare(b.slot));
  const draft = order.status === "BROUILLON";
  const waiting = order.status === "CONFIRMEE" && order.approval.required && !order.approval.by;
  const open = order.status === "CONFIRMEE" || order.status === "EXPEDIEE";
  const toPlan = Object.entries(rem).some(([f, n]) => n - (planned[f] ?? 0) > 0);
  const label = (f: string) => (f === BULK ? "Vrac (kg)" : config.bottleTypes.find((b) => b.id === f)?.label ?? f);
  const reliquatOf = (f: string) => order.reliquats.filter((r) => r.formatId === f).reduce((a, r) => a + r.qty, 0);
  const replaces = order.replaces ? data.orders.find((o) => o.id === order.replaces) : undefined;
  const replacedBy = order.replacedBy ? data.orders.find((o) => o.id === order.replacedBy) : undefined;
  const blocked = check?.credit.decision === "BLOCK";
  const otherFailures = check?.failures.filter((f) => f.guard !== "credit") ?? [];
  const steps = config.sales.workflow.steps;

  const next = (() => {
    if (draft) return check?.failures.length ? "Corriger ce qui bloque, puis confirmer." : "Confirmer la commande.";
    if (waiting) return "Validation d'un responsable avant le chargement.";
    const active = trucks.find((d) => d.status !== "EXPEDIE" && d.status !== "LIVRE");
    if (active) return `Camion ${active.number} : ${DISPATCH_STATUS[active.status].label.toLowerCase()}. Suite aux Expéditions.`;
    if (open && toPlan) return "Planifier un camion pour le reste à livrer.";
    if (order.status === "EXPEDIEE") return "Livraison à confirmer sur le BL.";
    if (order.status === "LIVREE") return steps.accountingExport && !order.exported ? "Exporter vers Sage, puis clôturer." : "Clôturer la commande.";
    return null;
  })();

  const setQty = (qty: Record<string, number>) => {
    const r = exec((e) => saveDraft(e, { id: order.id, customerId: order.customerId, centreId: order.centreId, mode: order.mode, date: order.date, qty }));
    if (r.ok) setSavedAt(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  };
  const setHeader = (patch: { mode?: typeof order.mode; date?: string }) => {
    exec((e) => saveDraft(e, { id: order.id, customerId: order.customerId, centreId: order.centreId, mode: patch.mode ?? order.mode, date: patch.date ?? order.date, qty: Object.fromEntries(order.lines.map((l) => [l.formatId, l.qty])) }));
  };
  const close = () => {
    setModal(null);
    setNote("");
    setReason("");
    setOverride("");
    setAckShort(false);
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "lignes", label: "Lignes" },
    { id: "expeditions", label: "Expéditions", count: trucks.length },
    { id: "historique", label: "Historique" },
  ];

  return (
    <div>
      <Link href="/ventes/commandes" className="mb-3 inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-ink">
        <ArrowLeft className="size-4" />
        Commandes
      </Link>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[30px] font-semibold tracking-[-0.03em] sm:text-[36px]">{order.number}</h1>
            <OrderBadge status={order.status} partial={partial} />
            {waiting && <span className="inline-flex h-6 items-center rounded-md border border-warn/45 px-2 text-[12px] font-medium text-warn">À valider</span>}
          </div>
          <p className="mt-1 text-[15px] text-muted">
            {customer ? (
              <Link href={`/ventes/clients/${customer.id}`} className="text-brand-800 hover:underline">
                {customer.name}
              </Link>
            ) : (
              "Client supprimé"
            )}
            , {centre?.name}, {MODE[order.mode].toLowerCase()} le {fmtDate(order.date, { day: "numeric", month: "long" })}, contrat v{order.contractVersion}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {draft && savedAt && (
            <span className="flex items-center gap-1.5 text-[13px] text-muted" aria-live="polite">
              <Check className="size-4 text-ok" />
              Enregistré à {savedAt}
            </span>
          )}
          {order.status !== "ANNULEE" && order.status !== "CLOTUREE" && (draft || can("order.cancel")) && (
            <Button variant="ghost" onClick={() => setModal("cancel")}>
              {draft ? "Annuler le brouillon" : "Annuler / rectifier"}
            </Button>
          )}
          {order.status === "EXPEDIEE" && (
            <Button variant="ghost" onClick={() => setModal("reliquat")}>
              Déclarer un reliquat
            </Button>
          )}
          {draft && <Button onClick={() => setModal("confirm")}>Confirmer la commande</Button>}
          {waiting && can("order.approve") && <Button onClick={() => setModal("approve")}>Valider la commande</Button>}
          {open && !waiting && toPlan && (
            <Button onClick={() => setModal("plan")}>
              <Truck className="size-4" />
              Planifier un camion
            </Button>
          )}
          {order.status === "LIVREE" && (
            <Button disabled={steps.accountingExport && !order.exported} title={steps.accountingExport && !order.exported ? "Exportez d'abord vers Sage" : undefined} onClick={() => exec((e) => closeOrder(e, order.id))}>
              Clôturer la commande
            </Button>
          )}
        </div>
      </div>

      {!draft && (
        <div className={cn("mb-4 flex items-start gap-3 rounded-2xl px-4 py-3 text-[14px]", order.status === "ANNULEE" ? "bg-alert/8 text-alert" : "bg-brand-100 text-brand-950")}>
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>
            {order.status === "ANNULEE"
              ? `Commande annulée${order.history.at(-1)?.note ? ` : ${order.history.at(-1)?.note}` : ""}.`
              : "Commande validée : les lignes et les prix sont en lecture seule. Pour la modifier, annulez-la et rectifiez : une nouvelle commande reprend les lignes, les mouvements déjà passés sont contre-passés."}
            {replacedBy && (
              <>
                {" "}
                Remplacée par{" "}
                <Link href={`/ventes/commandes/${replacedBy.id}`} className="font-medium underline">
                  {replacedBy.number}
                </Link>
                .
              </>
            )}
            {waiting && !can("order.approve") && " En attente de validation d'un responsable commercial ou de la direction."}
          </span>
        </div>
      )}
      {replaces && (
        <p className="mb-4 text-[14px] text-muted">
          Rectifie{" "}
          <Link href={`/ventes/commandes/${replaces.id}`} className="text-brand-800 underline">
            {replaces.number}
          </Link>
          .
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0 p-0">
          <TabStrip tabs={tabs} value={tab} onChange={setTab} label="Sections de la commande" />

          {tab === "lignes" && (
            <TabPanel key="lignes" id="lignes">
              {draft ? (
                <>
                  <div className="mb-3 flex flex-wrap items-end gap-3">
                    <Field label="Mode" className="w-full sm:w-48">
                      <Select ariaLabel="Mode" value={order.mode} onChange={(v) => setHeader({ mode: v })} options={(["LIVRAISON", "ENLEVEMENT"] as const).map((m) => ({ value: m, label: MODE[m] }))} />
                    </Field>
                    <Field label="Date souhaitée" className="w-full sm:w-60">
                      <DatePicker ariaLabel="Date souhaitée" value={order.date} min={today} onChange={(v) => v && setHeader({ date: v })} />
                    </Field>
                  </div>
                  <QtyGrid customerId={order.customerId} date={order.date} qty={Object.fromEntries(order.lines.map((l) => [l.formatId, l.qty]))} onChange={setQty} check={check} />
                </>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[500px] text-[14px]">
                    <thead>
                      <tr className="text-left text-[12px] text-muted">
                        <th className="pb-2 font-medium">Format</th>
                        <th className="pb-2 pl-3 text-right font-medium">Commandé</th>
                        <th className="pb-2 pl-3 text-right font-medium">Expédié</th>
                        <th className="pb-2 pl-3 text-right font-medium">Reliquat</th>
                        <th className="pb-2 pl-3 text-right font-medium">Reste</th>
                        <th className="pb-2 pl-3 text-right font-medium">Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.lines.map((l) => (
                        <tr key={l.formatId} className="border-t border-line">
                          <td className="py-2.5 pr-3 font-medium">{label(l.formatId)}</td>
                          <td className="tnum py-2.5 text-right">{fmt(l.qty)}</td>
                          <td className="tnum py-2.5 text-right">{fmt(sent[l.formatId] ?? 0)}</td>
                          <td className={cn("tnum py-2.5 text-right", reliquatOf(l.formatId) > 0 && "text-warn")}>{reliquatOf(l.formatId) ? fmt(reliquatOf(l.formatId)) : "—"}</td>
                          <td className="tnum py-2.5 text-right">
                            {fmt(rem[l.formatId] ?? 0)}
                            {(planned[l.formatId] ?? 0) > 0 && <span className="block text-[12px] text-muted">{fmt(planned[l.formatId])} sur un camion prévu</span>}
                          </td>
                          <td className="tnum py-2.5 text-right">
                            {fmt(l.qty * l.price)}
                            <span className="block text-[12px] text-muted">à {fmt(l.price)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-ink/80 font-semibold">
                        <td className="pt-3" colSpan={5}>
                          Total
                        </td>
                        <td className="tnum pt-3 text-right">{fmtMoney(amount, cur)}</td>
                      </tr>
                    </tfoot>
                  </table>
                  {order.reliquats.length > 0 && (
                    <ul className="mt-4 space-y-1 rounded-2xl bg-warn/10 px-4 py-3 text-[13px] text-[#7a5306]">
                      {order.reliquats.map((r, i) => (
                        <li key={i}>
                          Reliquat {label(r.formatId)} : {fmt(r.qty)}, {config.sales.reasons.reliquat.find((x) => x.code === r.reason)?.label.toLowerCase() ?? r.reason} ({r.by}, {fmtDate(dayOf(r.at), { day: "numeric", month: "short" })})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </TabPanel>
          )}

          {tab === "expeditions" && (
            <TabPanel key="expeditions" id="expeditions">
              {trucks.length === 0 ? (
                <p className="py-8 text-center text-muted">{open ? "Aucun camion. Planifiez-en un pour servir la commande." : "Aucune expédition pour cette commande."}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {trucks.map((d) => (
                    <li key={d.id}>
                      <Link href={`/expeditions/${d.id}`} className="-mx-2 flex flex-wrap items-center gap-3 rounded-xl px-2 py-3 hover:bg-board">
                        <span className="grid size-10 place-items-center rounded-xl bg-brand-100 text-brand-800">
                          <Truck className="size-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] font-medium">{d.number}</span>
                          <span className="block text-[12px] text-muted">
                            {cap(fmtDate(dayOf(d.slot), { weekday: "short", day: "numeric", month: "short" }))} à {new Date(d.slot).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}, {d.truck}
                            {d.driver ? `, ${d.driver}` : ""}
                          </span>
                        </span>
                        <span className="tnum text-[13px] text-muted">
                          {Object.entries(d.loaded)
                            .filter(([, n]) => n)
                            .map(([f, n]) => `${label(f)} ${fmt(n)}`)
                            .join(", ")}
                        </span>
                        <DispatchBadge status={d.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </TabPanel>
          )}

          {tab === "historique" && (
            <TabPanel key="historique" id="historique">
              <ol className="relative space-y-4 border-l border-line pl-5">
                {[...order.history].reverse().map((h, i) => (
                  <li key={i} className="relative">
                    <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-brand-600 ring-4 ring-card" aria-hidden />
                    <p className="text-[14px] font-medium">{h.label}</p>
                    <p className="text-[12px] text-muted">
                      {new Date(h.at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}, {h.by}
                      {h.note ? ` : ${h.note}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </TabPanel>
          )}
        </Card>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-[100px] xl:self-start">
          <Card>
            <CardTitle>Résumé</CardTitle>
            <div className="mt-4">
              {check ? (
                <CheckPanel check={check} />
              ) : (
                <dl className="tnum space-y-2 text-[14px]">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted">Montant</dt>
                    <dd className="text-[22px] font-semibold tracking-[-0.02em]">{fmtMoney(amount, cur)}</dd>
                  </div>
                  {pos && (
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted">Encours du client</dt>
                      <dd className="whitespace-nowrap">
                        {fmtMoneyShort(pos.exposure.total, "")} / {fmtMoneyShort(pos.terms.creditLimit, cur)}
                      </dd>
                    </div>
                  )}
                  {order.approval.required && (
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted">Validation</dt>
                      <dd>{order.approval.by ? `${order.approval.by}` : "En attente"}</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
            {order.approval.reasons.length > 0 && !draft && (
              <ul className="mt-3 space-y-1 rounded-2xl bg-board p-3 text-[13px] text-muted">
                {order.approval.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            {next && (
              <div className="mt-4 rounded-2xl border border-line p-3">
                <p className="text-[12px] text-muted">Prochaine étape</p>
                <p className="mt-0.5 text-[14px] font-medium">{next}</p>
              </div>
            )}
          </Card>
        </aside>
      </div>

      {/* Confirmation, like closing an inventory: summary, blockers, explicit acknowledgements. */}
      <Dialog open={modal === "confirm"} onClose={close} title="Confirmer la commande ?" width="max-w-lg">
        <p className="text-[14px] text-muted">Les lignes et les prix seront figés. Une modification passera ensuite par une rectification.</p>
        <dl className="tnum mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-board p-4 text-[14px]">
          <dt className="text-muted">Client</dt>
          <dd className="text-right font-semibold">{customer?.name}</dd>
          <dt className="text-muted">Montant</dt>
          <dd className="text-right font-semibold">{fmtMoney(amount, cur)}</dd>
          <dt className="text-muted">{MODE[order.mode]}</dt>
          <dd className="text-right">{fmtDate(order.date, { weekday: "short", day: "numeric", month: "short" })}</dd>
        </dl>
        {otherFailures.length > 0 && (
          <ul className="mt-4 space-y-1 rounded-2xl border border-alert/40 bg-alert/6 p-3 text-[14px] text-alert">
            {otherFailures.map((f) => (
              <li key={f.guard}>{f.message}</li>
            ))}
          </ul>
        )}
        {check && check.credit.decision !== "ALLOW" && (
          <div className={cn("mt-4 rounded-2xl border p-3 text-[14px]", blocked ? "border-alert/40 bg-alert/6 text-alert" : "border-warn/45 bg-warn/8 text-[#7a5306]")}>
            {check.credit.reasons.map((r) => (
              <p key={r}>{r}</p>
            ))}
            {blocked &&
              (can("credit.override") ? (
                <Field label="Motif du forçage" className="mt-3 text-ink">
                  <input className={inputCls} value={override} onChange={(e) => setOverride(e.target.value)} placeholder="Ex. Garantie bancaire reçue" />
                </Field>
              ) : (
                <p className="mt-2">Seul un responsable commercial ou la direction peut forcer. La commande reste en brouillon.</p>
              ))}
          </div>
        )}
        {check && check.approval.length > 0 && !blocked && <p className="mt-4 rounded-2xl bg-warn/12 p-3 text-[13px] text-[#7a5306]">Elle attendra ensuite la validation d&apos;un responsable avant le chargement.</p>}
        {check && check.shortfalls.length > 0 && config.sales.stock.backorder === "RELIQUAT" && (
          <label className="mt-4 flex items-start gap-3 rounded-2xl border border-warn/45 bg-warn/8 p-3 text-[14px]">
            <input type="checkbox" className="mt-1 size-4 accent-[var(--warn)]" checked={ackShort} onChange={(e) => setAckShort(e.target.checked)} />
            <span>
              Stock disponible insuffisant ({check.shortfalls.map((s) => `${label(s.formatId)} : ${fmt(s.qty)}`).join(", ")}). Je confirme quand même : le manque sera servi plus tard ou déclaré en reliquat.
            </span>
          </label>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Continuer la saisie
          </Button>
          <Button
            disabled={otherFailures.length > 0 || (blocked && (!override.trim() || !can("credit.override"))) || (!!check?.shortfalls.length && config.sales.stock.backorder === "RELIQUAT" && !ackShort)}
            onClick={() => {
              const r = exec((e) => confirmOrder(e, order.id, { override: blocked ? override : undefined }));
              if (r.ok) close();
            }}
          >
            {blocked && can("credit.override") ? "Forcer et confirmer" : "Confirmer"}
          </Button>
        </div>
      </Dialog>

      <Dialog open={modal === "approve"} onClose={close} title="Valider la commande ?">
        <ul className="space-y-1 rounded-2xl bg-board p-3 text-[13px] text-muted">
          {order.approval.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <Field label="Commentaire" className="mt-4">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Facultatif, inscrit dans l'historique" />
        </Field>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Plus tard
          </Button>
          <Button
            onClick={() => {
              const r = exec((e) => approveOrder(e, order.id, note));
              if (r.ok) close();
            }}
          >
            Valider
          </Button>
        </div>
      </Dialog>

      <Dialog open={modal === "plan"} onClose={close} title="Planifier un camion">
        <p className="text-[14px] text-muted">Le camion part avec tout le reste à livrer ; les quantités pourront être ajustées au chargement.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Camion" className="col-span-2 sm:col-span-1">
            <input className={inputCls} value={truck.truck} placeholder="DK-1234-AB" onChange={(e) => setTruck({ ...truck, truck: e.target.value })} />
          </Field>
          <Field label="Chauffeur" className="col-span-2 sm:col-span-1">
            <input className={inputCls} value={truck.driver} onChange={(e) => setTruck({ ...truck, driver: e.target.value })} />
          </Field>
          <Field label="Jour">
            <DatePicker ariaLabel="Jour de chargement" value={truck.date} min={today} onChange={(v) => v && setTruck({ ...truck, date: v })} />
          </Field>
          <Field label="Créneau">
            <TimePicker ariaLabel="Heure de chargement" value={truck.time} minuteStep={15} onChange={(v) => setTruck({ ...truck, time: v })} />
          </Field>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Annuler
          </Button>
          <Button
            onClick={() => {
              const r = exec((e) => planDispatch(e, order.id, truck));
              if (r.ok) {
                close();
                if (r.goTo) router.push(r.goTo);
              }
            }}
          >
            Planifier
          </Button>
        </div>
      </Dialog>

      <Dialog open={modal === "reliquat"} onClose={close} title="Déclarer un reliquat ?">
        <p className="text-[14px] text-muted">Le reste à livrer ne sera pas servi sur cette commande. Il compte dans le taux de service et les reliquats, avec son motif.</p>
        <dl className="tnum mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-board p-4 text-[14px]">
          {Object.entries(rem)
            .filter(([, n]) => n > 0)
            .map(([f, n]) => (
              <div key={f} className="contents">
                <dt className="text-muted">{label(f)}</dt>
                <dd className="text-right font-semibold">{fmt(n)}</dd>
              </div>
            ))}
        </dl>
        <Field label="Motif" className="mt-4">
          <Select ariaLabel="Motif du reliquat" value={relReason} onChange={setRelReason} options={config.sales.reasons.reliquat.map((r) => ({ value: r.code, label: r.label }))} />
        </Field>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Annuler
          </Button>
          <Button
            onClick={() => {
              const r = exec((e) => declareReliquat(e, order.id, relReason));
              if (r.ok) close();
            }}
          >
            Déclarer le reliquat
          </Button>
        </div>
      </Dialog>

      <Dialog open={modal === "cancel"} onClose={close} title={draft ? "Annuler ce brouillon ?" : "Annuler ou rectifier la commande ?"} width="max-w-lg">
        <p className="text-[14px] text-muted">
          {draft
            ? "Le brouillon passe en annulé et reste consultable."
            : trucks.some((d) => d.status !== "PLANIFIE")
              ? "Des camions sont déjà passés : leurs mouvements de bouteilles et leurs écritures client seront contre-passés avec votre motif. Rien n'est effacé."
              : "La commande passe en annulée et reste consultable. Les camions planifiés sont libérés."}
        </p>
        <Field label="Motif" className="mt-4">
          <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. Quantités erronées" />
        </Field>
        {!draft && (
          <label className="mt-4 flex items-start gap-3 rounded-2xl bg-board p-3 text-[14px]">
            <input type="checkbox" className="mt-1 size-4 accent-[var(--b-800)]" checked={rectify} onChange={(e) => setRectify(e.target.checked)} />
            <span>Créer une nouvelle commande en brouillon avec les mêmes lignes, à corriger puis confirmer.</span>
          </label>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Garder la commande
          </Button>
          <Button
            variant="danger"
            disabled={!reason.trim()}
            onClick={() => {
              const r = exec((e) => cancelOrder(e, order.id, reason, !draft && rectify));
              if (r.ok) {
                close();
                if (r.goTo) router.push(r.goTo);
              }
            }}
          >
            {draft ? "Annuler le brouillon" : rectify ? "Annuler et rectifier" : "Annuler la commande"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
