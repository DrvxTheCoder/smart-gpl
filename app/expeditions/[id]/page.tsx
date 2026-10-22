"use client";

import Link from "next/link";
import { AccessLink, useCanOpen } from "@/components/shell/access-link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, FileDown, Lock, Scale } from "@/components/ui/icons";
import { Button, Card, CardTitle, Dialog, Field, IntegerInput, Stepper, Switch, inputCls } from "@/components/ui/primitives";
import { Logo, PRODUCT } from "@/components/shell/app-shell";
import { ConfirmCount, CountGrid } from "@/components/sales/warehouse-ui";
import { DispatchBadge, Missing } from "@/components/sales/ui";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { advanceDispatch, confirmParty, dispatchContext, updateDispatch } from "@/lib/sales/commands/dispatch";
import { BL_MARK, buildBl } from "@/lib/sales/bl-pdf";
import { byFormat, gridTotal } from "@/lib/sales/bottle-ledger";
import { blockers, DISPATCH_FLOW, docLabel } from "@/lib/sales/lifecycle";
import { dayOf } from "@/lib/sales/dates";
import { MODE } from "@/lib/sales/labels";
import { cap, cn, fmt, fmtDate, fmtMoney, fmtT } from "@/lib/format";
import { BULK, UNKNOWN_BRAND, type Confirmation } from "@/lib/sales/types";

export default function ExpeditionPage() {
  const { id } = useParams<{ id: string }>();
  const { config, startJob } = useStore();
  const { data, env, exec } = useSales();
  const canOpenPath = useCanOpen();
  const d = data.dispatches.find((x) => x.id === decodeURIComponent(id));
  const [damagedOpen, setDamagedOpen] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [ack, setAck] = useState(false);
  const ctx = useMemo(() => (d ? dispatchContext(env, d) : null), [d, env]);
  const steps = config.sales.workflow.steps;
  const cur = config.sales.currency.label;

  if (!d || !ctx) return <Missing text="Cette expédition n'existe pas." href="/expeditions" back="Revenir à la file des camions" />;

  const { order, bulk } = ctx;
  const customer = data.customers.find((c) => c.id === d.customerId);
  const centre = config.centres.find((c) => c.id === d.centreId);
  const formats = config.bottleTypes.filter((b) => order.lines.some((l) => l.formatId === b.id));
  const storekeeper = env.by;
  const locked = d.status === "EXPEDIE" || d.status === "LIVRE";
  const gateDone = d.status !== "PLANIFIE";
  const loadDone = d.status === "CHARGE" || locked;
  const pickup = order.mode === "ENLEVEMENT";
  const label = (f: string) => (f === BULK ? "Vrac" : config.bottleTypes.find((b) => b.id === f)?.label ?? f);
  const brandName = (b: string) => (b === UNKNOWN_BRAND ? "Marque non identifiée" : config.sales.brands.find((x) => x.id === b)?.name ?? b);
  const ordered = Object.fromEntries(order.lines.map((l) => [l.formatId, l.qty]));
  const emptiesTotal = gridTotal(d.empties) + gridTotal(d.damaged);
  const fullsTotal = Object.entries(d.loaded).filter(([f]) => f !== BULK).reduce((a, [, n]) => a + n, 0);
  const competitor = gridTotal(d.empties) - gridTotal({ [env.own]: d.empties[env.own] ?? {} });
  const set = (patch: Parameters<typeof updateDispatch>[2]) => exec((e) => updateDispatch(e, d.id, patch));
  const confirm = (phase: "gateIn" | "loading" | "delivery") => (c: Omit<Confirmation, "at">) => exec((e) => confirmParty(e, d.id, phase, c)).ok;
  const go = (action: "gateIn" | "load" | "expedite" | "deliver") => exec((e) => advanceDispatch(e, d.id, action));
  const pending = (action: string) => blockers(DISPATCH_FLOW, action, d.status, ctx, steps);
  const gateParties = [{ role: "Magasinier", name: storekeeper }, { role: pickup ? "Client" : "Chauffeur", name: pickup ? customer?.contact.name : d.driver }];

  const flow = [
    { id: "camion", label: "Camion", done: gateDone },
    ...(bulk ? [] : [{ id: "vides", label: "Vides reçues", done: gateDone }]),
    { id: "charge", label: "Chargement", done: loadDone },
    { id: "bl", label: "BL et départ", done: locked },
    ...(!pickup ? [{ id: "livraison", label: "Livraison", done: d.status === "LIVRE" }] : []),
  ];
  const current = flow.find((s) => !s.done)?.id;

  const pdf = () =>
    startJob({ kind: "bl", busyMsg: "Un BL est déjà en préparation", doneMsg: `Téléchargé avec succès`, run: (onProgress) => buildBl({ cfg: config, dispatch: d, order, customer, product: PRODUCT, onProgress }) });

  return (
    <div>
      <Link href="/expeditions" className="mb-3 inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-ink">
        <ArrowLeft className="size-4" />
        Expéditions
      </Link>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[30px] font-semibold tracking-[-0.03em] sm:text-[36px]">{d.number}</h1>
            <DispatchBadge status={d.status} />
          </div>
          <p className="mt-1 text-[15px] text-muted">
            {customer && (
              <AccessLink href={`/ventes/clients/${customer.id}`} className="text-brand-800 hover:underline" plainClassName="text-ink">
                {customer.name}
              </AccessLink>
            )}
            , commande{" "}
            <AccessLink href={`/ventes/commandes/${order.id}`} className="text-brand-800 hover:underline" plainClassName="text-ink">
              {order.number}
            </AccessLink>
            , {MODE[order.mode].toLowerCase()}, {centre?.name}
          </p>
        </div>
        {locked && (
          <Button variant="ghost" onClick={pdf}>
            <FileDown className="size-4" />
            BL en PDF
          </Button>
        )}
      </div>

      <ol className="no-scrollbar mb-4 flex gap-2 overflow-x-auto" aria-label="Étapes de l'expédition">
        {flow.map((s, i) => (
          <li key={s.id} aria-current={s.id === current ? "step" : undefined} className={cn("flex h-10 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium", s.done ? "bg-ok/10 text-ok" : s.id === current ? "bg-brand-800 text-white" : "bg-card text-muted ring-1 ring-line")}>
            {s.done ? <Check className="size-4" /> : <span className="tnum">{i + 1}</span>}
            {s.label}
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Camion</CardTitle>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Field label="Immatriculation">
                <input className={cn(inputCls, "h-11")} disabled={gateDone} value={d.truck} onChange={(e) => set({ truck: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="Chauffeur">
                <input className={cn(inputCls, "h-11")} disabled={gateDone} value={d.driver} onChange={(e) => set({ driver: e.target.value })} />
              </Field>
              <Field label="Créneau">
                <input className={cn(inputCls, "h-11")} disabled value={`${cap(fmtDate(dayOf(d.slot), { weekday: "short", day: "numeric", month: "short" }))} à ${new Date(d.slot).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`} />
              </Field>
            </div>
            {bulk && !gateDone && (
              <div className="mt-4 flex justify-end">
                <Button onClick={() => go("gateIn")}>Mettre le camion en chargement</Button>
              </div>
            )}
          </Card>

          {!bulk && (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Vides reçues</CardTitle>
                  <p className="mt-0.5 text-[13px] text-muted">Comptées par marque à l&apos;entrée. Seules les vides de votre marque se remplissent ; les autres attendent l&apos;échange.</p>
                </div>
                {gateDone && (
                  <span className="flex items-center gap-1.5 text-[13px] text-muted">
                    <Lock className="size-4" /> Comptage figé
                  </span>
                )}
              </div>
              <div className="mt-4">
                {gateDone ? (
                  <EmptiesTable empties={d.empties} damaged={d.damaged} formats={formats} brandName={brandName} />
                ) : (
                  <>
                    <CountGrid brands={config.sales.brands} formats={formats} value={d.empties} onChange={(g) => set({ empties: g })} />
                    <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-board p-3">
                      <span className="text-[14px]">Bouteilles réformées à l&apos;arrivée (abîmées, hors d&apos;usage)</span>
                      <Switch checked={damagedOpen || gridTotal(d.damaged) > 0} label="Saisir des bouteilles réformées" onChange={setDamagedOpen} />
                    </div>
                    {(damagedOpen || gridTotal(d.damaged) > 0) && (
                      <div className="mt-3">
                        <CountGrid brands={config.sales.brands} formats={formats} value={d.damaged} onChange={(g) => set({ damaged: g })} withUnknown={false} />
                      </div>
                    )}
                    <Field label="Comptage contesté" hint="Noté sur le BL, sans bloquer le camion" className="mt-4">
                      <input className={inputCls} value={d.dispute ?? ""} placeholder="Ex. Le chauffeur annonce 20 B12,5 de plus" onChange={(e) => set({ dispute: e.target.value || null })} />
                    </Field>
                  </>
                )}
                {d.dispute && gateDone && <p className="mt-3 rounded-2xl bg-warn/12 p-3 text-[13px] text-[#7a5306]">Comptage contesté : {d.dispute}</p>}
              </div>
              {(!gateDone || d.gateIn.length > 0) && steps.gateInspection && (
                <div className="mt-5">
                  <p className="mb-2 text-[13px] text-muted">Double confirmation du comptage</p>
                  <ConfirmCount parties={gateParties} value={d.gateIn} onConfirm={confirm("gateIn")} disabled={gateDone} />
                </div>
              )}
              {!gateDone && (
                <ActionRow failures={pending("gateIn").map((f) => f.message)}>
                  <Button onClick={() => go("gateIn")} disabled={pending("gateIn").length > 0}>
                    Valider les vides
                  </Button>
                </ActionRow>
              )}
            </Card>
          )}

          {gateDone && (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Chargement</CardTitle>
                  <p className="mt-0.5 text-[13px] text-muted">{bulk ? "Le net de la pesée est la quantité livrée." : "Quantités réellement chargées, au plus le reste à livrer."}</p>
                </div>
                {loadDone && (
                  <span className="flex items-center gap-1.5 text-[13px] text-muted">
                    <Lock className="size-4" /> Chargement figé
                  </span>
                )}
              </div>
              <div className="mt-4 divide-y divide-line">
                {formats.map((b) => (
                  <div key={b.id} className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[72px_minmax(0,240px)_1fr]">
                    <span className="text-[15px] font-semibold">{b.label}</span>
                    <Stepper ariaLabel={`Chargé ${b.label}`} value={d.loaded[b.id] ?? 0} step={b.kg >= 30 ? 1 : 10} disabled={loadDone} onChange={(n) => set({ loaded: { ...d.loaded, [b.id]: Math.min(n, ctx.remaining[b.id] ?? 0) } })} />
                    <p className="tnum col-span-2 text-[12px] text-muted sm:col-span-1 sm:text-right">
                      Commandé {fmt(ordered[b.id] ?? 0)}, reste {fmt(ctx.remaining[b.id] ?? 0)}
                    </p>
                  </div>
                ))}
                {bulk && (
                  <div className="py-3">
                    {steps.weighbridge ? (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="Tare (à vide)" unit="kg">
                          <IntegerInput className="h-11" disabled={loadDone} value={d.weighing?.tareKg ?? 0} onChange={(v) => set({ weighing: { tareKg: v, grossKg: d.weighing?.grossKg ?? 0 }, loaded: { ...d.loaded, [BULK]: Math.max((d.weighing?.grossKg ?? 0) - v, 0) } })} />
                        </Field>
                        <Field label="Poids en charge" unit="kg">
                          <IntegerInput className="h-11" disabled={loadDone} value={d.weighing?.grossKg ?? 0} onChange={(v) => set({ weighing: { tareKg: d.weighing?.tareKg ?? 0, grossKg: v }, loaded: { ...d.loaded, [BULK]: Math.max(v - (d.weighing?.tareKg ?? 0), 0) } })} />
                        </Field>
                        <div className="flex flex-col justify-end rounded-2xl bg-board p-3">
                          <span className="flex items-center gap-1.5 text-[12px] text-muted">
                            <Scale className="size-4" /> Net
                          </span>
                          <span className="tnum text-[20px] font-semibold">{fmtT((d.loaded[BULK] ?? 0) / 1000, 2)}</span>
                          <span className="tnum text-[12px] text-muted">Commandé {fmtT((ordered[BULK] ?? 0) / 1000, 2)}</span>
                        </div>
                      </div>
                    ) : (
                      <Field label="Quantité livrée" unit="kg" className="sm:max-w-xs">
                        <IntegerInput className="h-11" disabled={loadDone} value={d.loaded[BULK] ?? 0} onChange={(v) => set({ loaded: { ...d.loaded, [BULK]: Math.min(v, ctx.remaining[BULK] ?? 0) } })} />
                      </Field>
                    )}
                  </div>
                )}
              </div>
              {!bulk && !loadDone && (
                <p className={cn("mt-3 rounded-2xl p-3 text-[13px]", Object.entries(d.loaded).every(([f, n]) => n <= (ctx.fillable[f] ?? 0)) ? "bg-ok/8 text-ok" : steps.fillConfirmation ? "bg-warn/12 text-[#7a5306]" : "bg-board text-muted")}>
                  Rempli par la production :{" "}
                  {formats.map((b) => `${b.label} ${fmt(ctx.fillable[b.id] ?? 0)}`).join(", ")}
                  {Object.entries(d.loaded).some(([f, n]) => n > (ctx.fillable[f] ?? 0)) ? (steps.fillConfirmation ? ". Le chargement attend la confirmation du remplissage." : ". Confirmation indicative : elle ne bloque pas le chargement.") : "."}
                </p>
              )}
              {steps.prepayment && ctx.cash && !loadDone && (
                <p className={cn("mt-3 rounded-2xl p-3 text-[13px]", ctx.prepaid ? "bg-ok/8 text-ok" : "bg-warn/12 text-[#7a5306]")}>
                  {ctx.prepaid ? "Client au comptant : règlement reçu, le chargement peut partir." : (
                    <>
                      Client au comptant : {fmtMoney(ctx.amount, cur)} à encaisser avant de charger.{" "}
                      {customer && (
                        canOpenPath(`/ventes/clients/${customer.id}`) ? (
                          <Link href={`/ventes/clients/${customer.id}`} className="font-medium underline">
                            Enregistrer le règlement
                          </Link>
                        ) : (
                          <span className="font-medium">Le service commercial enregistre le règlement.</span>
                        )
                      )}
                    </>
                  )}
                </p>
              )}
              <div className="mt-5">
                <p className="mb-2 text-[13px] text-muted">Confirmation du chargement</p>
                <ConfirmCount parties={[{ role: "Magasinier", name: storekeeper }]} value={d.loading} onConfirm={confirm("loading")} disabled={locked} />
              </div>
              {d.status === "EN_CHARGEMENT" && (
                <ActionRow failures={pending("load").map((f) => f.message)}>
                  <Button onClick={() => go("load")} disabled={pending("load").length > 0}>
                    Valider le chargement
                  </Button>
                </ActionRow>
              )}
              {d.status === "CHARGE" && (
                <ActionRow failures={pending("expedite").map((f) => f.message)}>
                  <Button onClick={() => setShipping(true)} disabled={pending("expedite").length > 0}>
                    Émettre le BL et expédier
                  </Button>
                </ActionRow>
              )}
            </Card>
          )}

          {locked && (
            <Card className="overflow-hidden p-0">
              <div className="flex items-center gap-3 border-b-4 border-brand-800 bg-white p-5">
                <span className="grid size-11 place-items-center rounded-xl bg-brand-800 text-[15px] font-bold text-white">{config.branding.shortName}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold">{config.branding.companyName}</p>
                  <p className="text-[12px] text-muted">Bon de livraison numérique · {centre?.name}</p>
                </div>
                <div className="text-right">
                  <p className="tnum text-[15px] font-semibold">{d.number}</p>
                  <p className="text-[12px] text-muted">{fmtDate(dayOf(d.slot))}</p>
                </div>
              </div>
              {/* <p className="bg-warn/12 px-5 py-2.5 text-[13px] font-medium text-[#7a5306]">{BL_MARK}</p> */}
              <div className="grid gap-5 p-5 sm:grid-cols-3">
                <dl className="text-[14px]">
                  <dt className="text-[12px] text-muted">Client</dt>
                  <dd className="font-medium">{customer?.name}</dd>
                  <dd className="text-[12px] text-muted">{customer?.code}</dd>
                </dl>
                <dl className="text-[14px]">
                  <dt className="text-[12px] text-muted">Commande</dt>
                  <dd className="font-medium">{order.number}</dd>
                  <dd className="text-[12px] text-muted">{MODE[order.mode]}</dd>
                </dl>
                <dl className="text-[14px]">
                  <dt className="text-[12px] text-muted">Camion</dt>
                  <dd className="font-medium">{d.truck}</dd>
                  <dd className="text-[12px] text-muted">{d.driver}</dd>
                </dl>
              </div>
              <div className="px-5">
                <table className="w-full text-[14px]">
                  <thead>
                    <tr className="text-left text-[12px] text-muted">
                      <th className="pb-2 font-medium">Format</th>
                      <th className="pb-2 text-right font-medium">Commandé</th>
                      <th className="pb-2 text-right font-medium">Livré</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(d.loaded)
                      .filter(([, n]) => n > 0)
                      .map(([f, n]) => (
                        <tr key={f} className="border-t border-line">
                          <td className="py-2 font-medium">{f === BULK ? "Vrac (kg)" : label(f)}</td>
                          <td className="tnum py-2 text-right">{fmt(ordered[f] ?? 0)}</td>
                          <td className="tnum py-2 text-right font-semibold">{fmt(n)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 space-y-1 px-5 pb-5 text-[12px] text-muted">
                {[...d.gateIn.map((c) => ["Entrée", c] as const), ...d.loading.map((c) => ["Chargement", c] as const), ...d.delivery.map((c) => ["Livraison", c] as const)].map(([step, c]) => (
                  <p key={`${step}-${c.role}`}>
                    {step}, {c.role.toLowerCase()} : {c.name}, {new Date(c.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                ))}
                <p className="flex items-center gap-1.5 pt-2">
                  <Logo className="size-3.5" /> Propulsé par {PRODUCT}
                </p>
              </div>
            </Card>
          )}

          {d.status === "EXPEDIE" && !pickup && (
            <Card>
              <CardTitle>Livraison</CardTitle>
              <p className="mt-0.5 text-[13px] text-muted">{steps.proofOfDelivery ? "Le client confirme la réception avec son nom et son code." : "Confirmez quand le camion a livré."}</p>
              {steps.proofOfDelivery && (
                <div className="mt-4">
                  <ConfirmCount parties={[{ role: "Client", name: customer?.contact.name }]} value={d.delivery} onConfirm={confirm("delivery")} />
                </div>
              )}
              <ActionRow failures={pending("deliver").map((f) => f.message)}>
                <Button onClick={() => go("deliver")} disabled={pending("deliver").length > 0}>
                  Confirmer la livraison
                </Button>
              </ActionRow>
            </Card>
          )}
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-[100px] xl:self-start">
          <Card>
            <CardTitle>Bilan du camion</CardTitle>
            <dl className="tnum mt-4 space-y-2.5 text-[14px]">
              {!bulk && (
                <>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted">Vides reçues</dt>
                    <dd className="font-semibold">{fmt(emptiesTotal)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted">Dont autres marques</dt>
                    <dd className={cn(competitor > emptiesTotal / 2 && "text-warn")}>{fmt(competitor)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted">Pleins à charger</dt>
                    <dd className="font-semibold">{fmt(fullsTotal)}</dd>
                  </div>
                  {emptiesTotal !== fullsTotal && (
                    <p className="text-[12px] text-muted">
                      {emptiesTotal > fullsTotal ? `${fmt(emptiesTotal - fullsTotal)} vides de plus que de pleins : le client est crédité en bouteilles.` : `${fmt(fullsTotal - emptiesTotal)} pleins sans vide en échange : ils s'ajoutent aux bouteilles détenues par le client.`}
                    </p>
                  )}
                </>
              )}
              <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2.5">
                <dt className="text-muted">Valeur du chargement</dt>
                <dd className="font-semibold whitespace-nowrap">{fmtMoney(ctx.amount, cur)}</dd>
              </div>
              <p className="text-[12px] text-muted">{ctx.billing === "A_L_EXPEDITION" ? "Facturée au client à l'émission du BL." : "Mise en consignation : facturée quand le grossiste vend."}</p>
            </dl>
            {!bulk && Object.keys(byFormat(d.empties)).length > 0 && competitor > 0 && (
              <p className="mt-3 rounded-2xl bg-board p-3 text-[12px] text-muted">Les {fmt(competitor)} vides d&apos;autres marques ne se remplissent pas : elles rejoignent le stock d&apos;échange du magasin.</p>
            )}
          </Card>
        </aside>
      </div>

      <Dialog open={shipping} onClose={() => setShipping(false)} title="Émettre le BL et expédier ?">
        <p className="text-[14px] text-muted">Le BL devient un document figé. Les pleins sortent du stock{ctx.billing === "A_L_EXPEDITION" ? " et le montant est porté au compte du client" : ""}.</p>
        <dl className="tnum mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-board p-4 text-[14px]">
          {Object.entries(d.loaded)
            .filter(([, n]) => n > 0)
            .map(([f, n]) => (
              <div key={f} className="contents">
                <dt className="text-muted">{f === BULK ? "Vrac (kg)" : label(f)}</dt>
                <dd className="text-right font-semibold">{fmt(n)}</dd>
              </div>
            ))}
          <dt className="border-t border-line pt-2 text-muted">Valeur</dt>
          <dd className="border-t border-line pt-2 text-right font-semibold">{fmtMoney(ctx.amount, cur)}</dd>
        </dl>
        <label className="mt-4 flex items-start gap-3 rounded-2xl border border-line p-3 text-[14px]">
          <input type="checkbox" className="mt-1 size-4 accent-[var(--b-800)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>Les quantités chargées correspondent à ce BL.</span>
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setShipping(false)}>
            Revenir
          </Button>
          <Button
            disabled={!ack}
            onClick={() => {
              const r = go("expedite");
              if (r.ok) {
                setShipping(false);
                setAck(false);
              }
            }}
          >
            Émettre le BL
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

/** The primary action of a section, with what still blocks it spelled out. */
function ActionRow({ failures, children }: { failures: string[]; children: React.ReactNode }) {
  return (
    <div className="mt-5 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
      {failures.length > 0 && (
        <ul className="flex-1 space-y-1 text-[13px] text-muted">
          {failures.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      {children}
    </div>
  );
}

function EmptiesTable({ empties, damaged, formats, brandName }: { empties: Record<string, Record<string, number>>; damaged: Record<string, Record<string, number>>; formats: { id: string; label: string }[]; brandName: (b: string) => string }) {
  const rows = [...Object.entries(empties).map(([b, r]) => [brandName(b), r] as const), ...Object.entries(damaged).map(([b, r]) => [`${brandName(b)}, réformées`, r] as const)].filter(([, r]) => Object.values(r).some((n) => n > 0));
  if (!rows.length) return <p className="text-[14px] text-muted">Aucune vide reçue.</p>;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[360px] text-[14px]">
        <thead>
          <tr className="text-left text-[12px] text-muted">
            <th className="pb-2 font-medium">Marque</th>
            {formats.map((f) => (
              <th key={f.id} className="pb-2 pl-3 text-right font-medium">
                {f.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, r]) => (
            <tr key={name} className="border-t border-line">
              <td className="py-2">{name}</td>
              {formats.map((f) => (
                <td key={f.id} className="tnum py-2 pl-3 text-right">
                  {r[f.id] ? fmt(r[f.id]) : "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
