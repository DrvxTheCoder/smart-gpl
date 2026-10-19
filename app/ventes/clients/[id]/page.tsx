"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, Contract, Info, Lock, Pencil, Phone, Plus, RotateCcw, Wallet } from "@/components/ui/icons";
import { Button, ButtonLink, Card, CardTitle, Dialog, Field, IntegerInput, Segmented, inputCls } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/calendar";
import { TermsEditor } from "@/components/settings/sales-settings";
import { CustomerDialog } from "@/components/sales/customer-dialog";
import { PassageDialog } from "@/components/sales/passage-dialog";
import { CallsPanel, CountsPanel, FloatPanel, PassagesPanel } from "@/components/sales/wholesaler-panels";
import { Badge, BadgeRow, Figure, Meter, Missing, OrderBadge, TabPanel, TabStrip, TonePill } from "@/components/sales/ui";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { customerPosition } from "@/lib/sales/selectors";
import { contractVersions } from "@/lib/sales/contracts";
import { newContract, nextContractDate, recordIncident, recordPayment, reverseEntry } from "@/lib/sales/commands/customers";
import { ANY_BRAND } from "@/lib/sales/bottle-ledger";
import { dayOf, shiftDate } from "@/lib/sales/dates";
import { dispatchedQty, remainingQty } from "@/lib/sales/stock";
import { isPartial } from "@/lib/sales/lifecycle";
import { linesAmount } from "@/lib/sales/pricing";
import { BILLING, INVOICING, PAYMENT_METHOD, PAYMENT_TRIGGER, termLabel } from "@/lib/sales/labels";
import { cap, cn, fmt, fmtDate, fmtMoney, fmtMoneyShort } from "@/lib/format";
import { BULK, UNKNOWN_BRAND, type ContractTerms, type IncidentKind, type PaymentMethod } from "@/lib/sales/types";

type Tab = "contrat" | "compte" | "bouteilles" | "commandes" | "depot" | "passages" | "comptages" | "appels";

export default function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const { config } = useStore();
  const { data, ledger, today, own, exec, can } = useSales();
  const customer = data.customers.find((c) => c.id === decodeURIComponent(id));
  const [picked, setTab] = useState<Tab | null>(null);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [passing, setPassing] = useState(false);
  const [explain, setExplain] = useState(false);
  const [incident, setIncident] = useState(false);
  const [reversing, setReversing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ terms: ContractTerms; from: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const cur = config.sales.currency.label;

  const pos = useMemo(() => (customer ? customerPosition({ cfg: config, data, ledger, today, own }, customer) : null), [customer, config, data, ledger, today, own]);

  const account = useMemo(() => {
    if (!customer) return [];
    const list = data.entries.filter((e) => e.customerId === customer.id).sort((a, b) => a.ts.localeCompare(b.ts));
    let run = 0;
    const withBal = list.map((e) => ({ e, bal: (run += e.kind === "DEBIT" ? e.amount : -e.amount) }));
    return withBal.reverse();
  }, [customer, data.entries]);

  const orders = useMemo(() => (customer ? data.orders.filter((o) => o.customerId === customer.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []), [customer, data.orders]);

  const returns = useMemo(() => {
    if (!customer) return { own: 0, other: 0 };
    const since = shiftDate(today, -30);
    let o = 0;
    let other = 0;
    for (const m of ledger) {
      if (m.refs.customerId !== customer.id || m.kind !== "VIDES_ENTREE" || m.state !== "VIDE" || dayOf(m.ts) < since) continue;
      if (m.brand === own) o += m.qty;
      else other += m.qty;
    }
    return { own: o, other };
  }, [customer, ledger, today, own]);

  // Wholesalers open on their float; everyone else on the contract.
  const tab: Tab = picked ?? (pos?.wholesaler ? "depot" : "contrat");

  if (!customer || !pos) return <Missing text="Ce client n'existe pas." href="/ventes/clients" back="Revenir à la liste des clients" />;

  const versions = contractVersions(data.contracts, customer.id);
  const util = pos.terms.creditLimit ? (pos.exposure.total / pos.terms.creditLimit) * 100 : 0;
  const openIds = new Set(pos.open.map((o) => o.entry.id));
  const reversed = new Set(data.entries.filter((e) => e.reverses).map((e) => e.reverses));
  const incidents = data.incidents.filter((i) => i.customerId === customer.id).sort((a, b) => b.ts.localeCompare(a.ts));
  const formats = config.bottleTypes;
  const brandName = (b: string) => (b === ANY_BRAND ? "Toutes marques" : b === UNKNOWN_BRAND ? "Marque non identifiée" : config.sales.brands.find((x) => x.id === b)?.name ?? b);
  const returnShare = returns.own + returns.other ? returns.other / (returns.own + returns.other) : 0;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    ...(pos.wholesaler
      ? [
          { id: "depot" as Tab, label: "Stock chez le grossiste" },
          { id: "passages" as Tab, label: "Passages" },
          { id: "comptages" as Tab, label: "Comptages", count: data.counts.filter((k) => k.site === `client:${customer.id}` && k.status === "A_VALIDER").length },
          { id: "appels" as Tab, label: "Appels" },
        ]
      : []),
    { id: "contrat", label: "Contrat" },
    { id: "compte", label: "Compte", count: pos.open.filter((o) => o.daysLate > 0).length },
    { id: "bouteilles", label: "Bouteilles" },
    { id: "commandes", label: "Commandes", count: orders.filter((o) => o.status === "BROUILLON" || o.status === "CONFIRMEE").length },
  ];

  return (
    <div>
      <Link href="/ventes/clients" className="mb-3 inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-ink">
        <ArrowLeft className="size-4" />
        Clients
      </Link>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[30px] font-semibold tracking-[-0.03em] sm:text-[36px]">{customer.name}</h1>
            <BadgeRow>
              <Badge tone="brand">{pos.category?.label ?? "Sans catégorie"}</Badge>
              {!customer.active && <Badge tone="muted">Inactif</Badge>}
            </BadgeRow>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[15px] text-muted">
            <span>
              {customer.code}, {customer.zone}, suivi par {customer.rep}
            </span>
            {customer.contact.phone && (
              <a href={`tel:${customer.contact.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-brand-800 hover:underline">
                <Phone className="size-4" />
                {customer.contact.name}, {customer.contact.phone}
              </a>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
            Modifier
          </Button>
          <ButtonLink variant="ghost" href={`/ventes/commandes?nouveau=1&client=${customer.id}`}>
            <Plus className="size-4" />
            Nouvelle commande
          </ButtonLink>
          {pos.wholesaler ? (
            <>
              <Button variant="ghost" onClick={() => setPaying(true)}>
                <Wallet className="size-4" />
                Règlement
              </Button>
              <Button onClick={() => setPassing(true)}>Enregistrer un passage</Button>
            </>
          ) : (
            <Button onClick={() => setPaying(true)}>
              <Wallet className="size-4" />
              Enregistrer un règlement
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0 p-0">
          <TabStrip tabs={tabs} value={tab} onChange={setTab} label="Sections de la fiche client" />

          {tab === "depot" && (
            <TabPanel key="depot" id="depot">
              <FloatPanel customerId={customer.id} />
            </TabPanel>
          )}
          {tab === "passages" && (
            <TabPanel key="passages" id="passages">
              <PassagesPanel customerId={customer.id} />
            </TabPanel>
          )}
          {tab === "comptages" && (
            <TabPanel key="comptages" id="comptages">
              <CountsPanel customerId={customer.id} />
            </TabPanel>
          )}
          {tab === "appels" && (
            <TabPanel key="appels" id="appels">
              <CallsPanel customerId={customer.id} />
            </TabPanel>
          )}

          {tab === "contrat" && (
            <TabPanel key="contrat" id="contrat">
              {draft ? (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h3 className="text-[16px] font-medium">Nouvelle version du contrat</h3>
                      <p className="text-[13px] text-muted">La version en cours s&apos;arrête la veille. Les commandes déjà passées gardent leurs conditions.</p>
                    </div>
                    <div className="w-full sm:w-64">
                      <Field label="Prend effet le">
                        <DatePicker ariaLabel="Date d'effet" value={draft.from} min={today} onChange={(v) => v && setDraft({ ...draft, from: v })} />
                      </Field>
                    </div>
                  </div>
                  <TermsEditor terms={draft.terms} wholesaler={pos.wholesaler} onChange={(t) => setDraft({ ...draft, terms: t })} />
                  {pos.solvency.suggestedLimit !== draft.terms.creditLimit && (
                    <p className="flex items-start gap-2 rounded-2xl bg-board p-3 text-[13px] text-muted">
                      <Info className="mt-0.5 size-4 shrink-0" />
                      <span>
                        Plafond suggéré par la note de solvabilité : <b className="tnum text-ink">{fmtMoney(pos.solvency.suggestedLimit, cur)}</b>. Suggestion seulement, jamais appliquée d&apos;office.
                      </span>
                    </p>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setDraft(null)}>
                      Annuler
                    </Button>
                    <Button
                      onClick={() => {
                        const r = exec((env) => newContract(env, customer.id, draft.terms, draft.from));
                        if (r.ok) setDraft(null);
                      }}
                    >
                      Enregistrer la version
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="flex items-center gap-2 text-[16px] font-medium">
                        <Contract className="size-[18px] text-brand-800" />
                        {pos.contract ? `Version ${pos.contract.version}, depuis le ${fmtDate(pos.contract.validFrom)}` : "Aucun contrat en vigueur"}
                      </h3>
                      <p className="mt-0.5 text-[13px] text-muted">Chaque commande garde la version sous laquelle elle a été passée.</p>
                    </div>
                    <Button size="sm" variant="soft" onClick={() => setDraft({ terms: pos.terms, from: nextContractDate(today) })}>
                      <Plus className="size-4" />
                      Nouvelle version
                    </Button>
                  </div>
                  <TermsList terms={pos.terms} wholesaler={pos.wholesaler} currency={cur} formatLabel={(f) => formats.find((b) => b.id === f)?.label ?? f} priceList={config.sales.priceLists.find((p) => p.id === pos.terms.priceListId)?.label ?? pos.terms.priceListId} />
                  <h3 className="mt-8 text-[15px] font-medium">Historique des versions</h3>
                  <ol className="mt-3 space-y-2">
                    {versions.map((v) => (
                      <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-board px-4 py-3 text-[14px]">
                        <span className="flex items-center gap-2">
                          {v.validTo && v.validTo < today ? <Lock className="size-4 text-muted" /> : <span className="size-2 rounded-full bg-ok" aria-hidden />}
                          <b className="font-medium">v{v.version}</b>
                          <span className="text-muted">
                            du {fmtDate(v.validFrom, { day: "numeric", month: "short", year: "numeric" })}
                            {v.validTo ? ` au ${fmtDate(v.validTo, { day: "numeric", month: "short", year: "numeric" })}` : ", en cours"}
                          </span>
                        </span>
                        <span className="tnum text-[13px] text-muted">
                          {termLabel(v.terms.payment)}, plafond {fmtMoneyShort(v.terms.creditLimit, cur)}, par {v.createdBy}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </TabPanel>
          )}

          {tab === "compte" && (
            <TabPanel key="compte" id="compte">
              <dl className="grid grid-cols-2 gap-4 rounded-2xl bg-board p-4 sm:grid-cols-5">
                {(
                  [
                    ["Non échu", pos.ageing.notDue],
                    ["1 à 30 j", pos.ageing.d1_30],
                    ["31 à 60 j", pos.ageing.d31_60],
                    ["61 à 90 j", pos.ageing.d61_90],
                    ["Plus de 90 j", pos.ageing.d90],
                  ] as const
                ).map(([k, v], i) => (
                  <div key={k}>
                    <dt className="text-[12px] text-muted">{k}</dt>
                    <dd className={cn("tnum text-[17px] font-semibold", v > 0 && i >= 3 ? "text-alert" : v > 0 && i >= 1 ? "text-warn" : undefined)} title={fmtMoney(v, cur)}>
                      {fmtMoneyShort(v, "")}
                    </dd>
                  </div>
                ))}
              </dl>
              {pos.balance < 0 && (
                <p className="mt-3 rounded-2xl bg-ok/8 p-3 text-[13px] text-ok">Avance client : {fmtMoney(-pos.balance, cur)} payés d&apos;avance, imputés sur les prochaines factures.</p>
              )}
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[680px] text-[14px]">
                  <thead>
                    <tr className="text-left text-[12px] text-muted">
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Libellé</th>
                      <th className="pb-2 text-right font-medium">Débit</th>
                      <th className="pb-2 text-right font-medium">Crédit</th>
                      <th className="pb-2 text-right font-medium">Solde</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {(showAll ? account : account.slice(0, 25)).map(({ e, bal }) => {
                      const open = pos.open.find((o) => o.entry.id === e.id);
                      return (
                        <tr key={e.id} className={cn("border-t border-line", (e.reverses || reversed.has(e.id)) && "text-muted")}>
                          <td className="tnum py-2.5 pr-3 whitespace-nowrap">{fmtDate(dayOf(e.ts), { day: "numeric", month: "short" })}</td>
                          <td className="py-2.5 pr-3">
                            <p className={cn(reversed.has(e.id) && "line-through")}>{e.label}</p>
                            <p className="text-[12px] text-muted">
                              {e.kind === "CREDIT" ? (e.method ? PAYMENT_METHOD[e.method] : "") : e.dueDate ? `Échéance ${fmtDate(e.dueDate, { day: "numeric", month: "short" })}` : ""}
                              {e.reason ? ` · Motif : ${e.reason}` : ""}
                            </p>
                          </td>
                          <td className="tnum py-2.5 pr-3 text-right">{e.kind === "DEBIT" ? fmt(e.amount) : ""}</td>
                          <td className="tnum py-2.5 pr-3 text-right">{e.kind === "CREDIT" ? fmt(e.amount) : ""}</td>
                          <td className="tnum py-2.5 pr-3 text-right">
                            {fmt(bal)}
                            {openIds.has(e.id) && open && open.daysLate > 0 && (
                              <span className="ml-2 inline-block">
                                <TonePill tone={open.daysLate > (pos.category?.credit.overdueDays ?? 0) ? "alert" : "warn"}>{open.daysLate} j de retard</TonePill>
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 text-right">
                            {!e.reverses && !reversed.has(e.id) && can("order.cancel") && (
                              <button type="button" onClick={() => setReversing(e.id)} aria-label={`Annuler l'écriture ${e.label}`} className="grid size-8 place-items-center rounded-full text-muted hover:bg-board hover:text-ink">
                                <RotateCcw className="size-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {account.length === 0 && <p className="py-8 text-center text-muted">Aucune écriture : le compte s&apos;alimente à la facturation et aux règlements.</p>}
                {account.length > 25 && (
                  <Button size="sm" variant="ghost" className="mt-3" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Afficher les 25 dernières" : `Afficher les ${account.length} écritures`}
                  </Button>
                )}
              </div>
              <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-[15px] font-medium">Incidents</h3>
                <Button size="sm" variant="ghost" onClick={() => setIncident(true)}>
                  <AlertCircle className="size-4" />
                  Signaler un incident
                </Button>
              </div>
              {incidents.length ? (
                <ul className="mt-3 divide-y divide-line">
                  {incidents.map((i) => (
                    <li key={i.id} className="flex items-start gap-3 py-3 text-[14px]">
                      <TonePill tone={i.kind === "CHEQUE_IMPAYE" ? "alert" : "warn"}>{i.kind === "CHEQUE_IMPAYE" ? "Chèque impayé" : "Litige"}</TonePill>
                      <div className="min-w-0">
                        <p>{i.note}</p>
                        <p className="text-[12px] text-muted">
                          {fmtDate(dayOf(i.ts))}, {i.by}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[13px] text-muted">Aucun incident. Un chèque impayé ou un litige pèse sur la note de solvabilité.</p>
              )}
            </TabPanel>
          )}

          {tab === "bouteilles" && (
            <TabPanel key="bouteilles" id="bouteilles">
              <p className="text-[14px] text-muted">
                Bouteilles détenues par le client : pleins reçus moins vides rendues,{" "}
                {config.sales.consignment.balanceBasis === "FORMAT" ? "par format (les bouteilles sont interchangeables)." : "par marque et par format."} Négatif : il a rendu plus qu&apos;il n&apos;a pris.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[520px] text-[14px]">
                  <thead>
                    <tr className="text-left text-[12px] text-muted">
                      <th className="pb-2 font-medium">Marque</th>
                      {formats.map((b) => (
                        <th key={b.id} className="pb-2 text-right font-medium">
                          {b.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(pos.bottles).map(([b, row]) => (
                      <tr key={b} className="border-t border-line">
                        <td className="py-2.5 pr-3">{brandName(b)}</td>
                        {formats.map((f) => {
                          const n = row[f.id] ?? 0;
                          return (
                            <td key={f.id} className={cn("tnum py-2.5 text-right", n < 0 && "text-warn")}>
                              {n ? fmt(n) : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {Object.keys(pos.bottles).length === 0 && <p className="py-8 text-center text-muted">Aucun mouvement de bouteilles pour ce client.</p>}
              </div>
              {returns.own + returns.other > 0 && (
                <div className={cn("mt-6 rounded-2xl p-4", returnShare > 0.5 ? "bg-warn/10" : "bg-board")}>
                  <p className="text-[14px] font-medium">Vides rendues sur 30 jours</p>
                  <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-line" aria-hidden>
                    <span className="bg-brand-600" style={{ flex: returns.own }} />
                    <span className="hatch" style={{ flex: returns.other }} />
                  </div>
                  <p className="tnum mt-2 text-[13px] text-muted">
                    {fmt(returns.own)} de votre marque, {fmt(returns.other)} d&apos;autres marques ({fmt(returnShare * 100)} %).
                  </p>
                  {returnShare > 0.5 && (
                    <p className="mt-2 text-[13px] text-[#7a5306]">
                      La majorité des vides rendues ne se remplissent pas : elles attendent l&apos;échange avec les autres sociétés et réduisent vos vides disponibles pour la production.
                    </p>
                  )}
                </div>
              )}
            </TabPanel>
          )}

          {tab === "commandes" && (
            <TabPanel key="commandes" id="commandes">
              {orders.length === 0 ? (
                <p className="py-8 text-center text-muted">Aucune commande. Créez-en une avec « Nouvelle commande ».</p>
              ) : (
                <ul className="divide-y divide-line">
                  {orders.slice(0, 40).map((o) => {
                    const amount = linesAmount(o.lines);
                    const sent = dispatchedQty(data.dispatches, o.id);
                    return (
                      <li key={o.id}>
                        <Link href={`/ventes/commandes/${o.id}`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-3 hover:bg-board">
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-[14px] font-medium whitespace-nowrap">{o.number}</span>
                              <OrderBadge status={o.status} partial={isPartial(o, sent, remainingQty(o, data.dispatches))} />
                            </span>
                            <span className="block text-[12px] text-muted">
                              {cap(fmtDate(o.date, { weekday: "short", day: "numeric", month: "short" }))}
                              {o.lines.some((l) => l.formatId === BULK) ? ", vrac" : ""}
                            </span>
                          </span>
                          <span className="tnum shrink-0 text-right text-[14px]">{fmtMoney(amount, cur)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </TabPanel>
          )}
        </Card>

        <aside className="xl:sticky xl:top-[100px] xl:self-start">
          <Card className="overflow-hidden p-0">
            <div className="p-5">
              <CardTitle>Position de crédit</CardTitle>
              <p className="tnum mt-4 text-[32px] leading-none font-semibold tracking-[-0.03em]" title={fmtMoney(pos.exposure.total, cur)}>
                {fmtMoneyShort(pos.exposure.total, "")}
                <span className="ml-1 text-[15px] font-medium text-muted">{cur}</span>
              </p>
              <p className="mt-1 text-[13px] text-muted">Encours total, pour un plafond de {fmtMoneyShort(pos.terms.creditLimit, cur)}</p>
              <div className="mt-3">
                <Meter pct={util} tone={util > 100 ? "alert" : util > 85 ? "warn" : undefined} label={`Utilisation du plafond, ${fmt(util)} %`} />
                <p className="tnum mt-1.5 text-[12px] text-muted">{fmt(util)} % du plafond utilisé</p>
              </div>
              <dl className="tnum mt-4 space-y-2 text-[14px]">
                {[
                  ["Créances", pos.exposure.receivables],
                  ["Commandes confirmées non livrées", pos.exposure.pendingOrders],
                  ...(pos.wholesaler ? [["Stock en consignation", pos.exposure.consignment] as [string, number]] : []),
                ].map(([k, v]) => (
                  <div key={k as string} className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted">{k}</dt>
                    <dd className="whitespace-nowrap" title={fmtMoney(v as number, cur)}>
                      {fmtMoneyShort(v as number, cur)}
                    </dd>
                  </div>
                ))}
                {pos.ageing.overdue > 0 && (
                  <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2 font-semibold text-alert">
                    <dt>Dont échu</dt>
                    <dd className="whitespace-nowrap">{fmtMoneyShort(pos.ageing.overdue, cur)}</dd>
                  </div>
                )}
              </dl>
            </div>
            <div className={cn("border-t border-line p-5", pos.solvency.tone === "ok" ? "bg-ok/6" : pos.solvency.tone === "warn" ? "bg-warn/8" : "bg-alert/8")}>
              <p className="text-[13px] text-muted">Solvabilité</p>
              <div className="mt-1 flex items-baseline gap-3">
                <p className={cn("tnum text-[40px] leading-none font-semibold tracking-[-0.04em]", pos.solvency.tone === "ok" ? "text-ok" : pos.solvency.tone === "warn" ? "text-warn" : "text-alert")}>
                  {pos.solvency.score}
                  <span className="text-[16px] font-medium text-muted"> / 100</span>
                </p>
                <TonePill tone={pos.solvency.tone}>{pos.solvency.label}</TonePill>
              </div>
              <button type="button" onClick={() => setExplain(true)} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-800 hover:underline">
                <Info className="size-4" />
                Comment c&apos;est calculé
              </button>
            </div>
            {pos.wholesaler && (
              <dl className="tnum grid grid-cols-2 gap-3 border-t border-line p-5">
                <Figure label="Pleins chez le grossiste" value={fmt(Object.values(pos.floatQty).reduce((a, b) => a + b, 0))} />
                <Figure label="Valeur du dépôt" value={fmtMoneyShort(pos.floatValue, "")} unit={cur} />
              </dl>
            )}
          </Card>
        </aside>
      </div>

      <CustomerDialog open={editing} onClose={() => setEditing(false)} customer={customer} />
      <PassageDialog open={passing} onClose={() => setPassing(false)} customerId={customer.id} />
      <PaymentDialog open={paying} onClose={() => setPaying(false)} customerId={customer.id} methods={pos.terms.methods} />
      <IncidentDialog open={incident} onClose={() => setIncident(false)} customerId={customer.id} />
      <ReverseDialog
        open={reversing !== null}
        onClose={() => setReversing(null)}
        label={data.entries.find((e) => e.id === reversing)?.label ?? ""}
        onConfirm={(reason) => {
          const r = exec((env) => reverseEntry(env, reversing ?? "", reason));
          if (r.ok) setReversing(null);
          return r.ok ? null : r.error;
        }}
      />

      <Dialog open={explain} onClose={() => setExplain(false)} title="Comment la note est calculée" width="max-w-xl">
        <p className="text-[14px] text-muted">
          Quatre critères notés de 0 à 1, pondérés selon les réglages de {config.branding.companyName}, sur les {config.sales.solvency.lookbackDays} derniers jours. Aucune donnée extérieure.
        </p>
        <ul className="mt-4 space-y-3">
          {pos.solvency.parts.map((p) => (
            <li key={p.key} className="rounded-2xl bg-board p-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[14px] font-medium">{p.label}</p>
                <p className="tnum text-[13px] text-muted">
                  {fmt(p.sub * 100)} / 100 × {fmt(p.weight * 100)} %
                </p>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
                <span className={cn("block h-full rounded-full", p.sub >= 0.7 ? "bg-ok" : p.sub >= 0.4 ? "bg-warn" : "bg-alert")} style={{ width: `${p.sub * 100}%` }} />
              </div>
              <p className="mt-2 text-[13px] text-muted">{p.detail}</p>
            </li>
          ))}
        </ul>
        <dl className="tnum mt-4 grid grid-cols-2 gap-3 rounded-2xl border border-line p-4 text-[14px]">
          <dt className="text-muted">Note</dt>
          <dd className="text-right font-semibold">
            {pos.solvency.score} / 100, {pos.solvency.label.toLowerCase()}
          </dd>
          <dt className="text-muted">Plafond actuel</dt>
          <dd className="text-right">{fmtMoney(pos.terms.creditLimit, cur)}</dd>
          <dt className="text-muted">Plafond suggéré</dt>
          <dd className="text-right font-semibold">{fmtMoney(pos.solvency.suggestedLimit, cur)}</dd>
        </dl>
        <p className="mt-3 text-[12px] text-faint">
          Plafond suggéré : ventes moyennes sur le délai de paiement plus 7 jours{pos.wholesaler ? ", plus la valeur du stock en consignation" : ""}, réduites de 20 % si la note est à surveiller et de 50 % si elle est à justifier, sans jamais dépasser le plafond actuel dans ces deux cas. Il n&apos;est jamais appliqué automatiquement : changez-le par une
          nouvelle version du contrat.
        </p>
        <div className="mt-5 flex justify-end">
          <Button variant="ghost" onClick={() => setExplain(false)}>
            Fermer
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function TermsList({ terms, wholesaler, currency, formatLabel, priceList }: { terms: ContractTerms; wholesaler: boolean; currency: string; formatLabel: (f: string) => string; priceList: string }) {
  const caps = Object.entries(terms.floatCap).filter(([, n]) => n > 0);
  const rows: [string, string][] = [
    ["Paiement", terms.payment.kind === "COMPTANT" ? "Comptant" : `Différé, ${terms.payment.days} jours`],
    ["Plafond de crédit", fmtMoney(terms.creditLimit, currency)],
    ["Garanties détenues", terms.guarantees ? fmtMoney(terms.guarantees, currency) : "Aucune"],
    ["Tarif", priceList],
    ["Facturation", BILLING[terms.billing]],
    ["Règlement", PAYMENT_TRIGGER[terms.paymentTrigger]],
    ["Modes acceptés", terms.methods.map((m) => PAYMENT_METHOD[m]).join(", ")],
    ...(wholesaler
      ? ([
          ["Facture", INVOICING[terms.invoicing]],
          ["Relance sans passage", terms.inactivityDays ? `${terms.inactivityDays} jours (propre au contrat)` : "Valeur par défaut"],
          ["Plafond en consignation", caps.length ? caps.map(([f, n]) => `${formatLabel(f)} ${fmt(n)}`).join(", ") : "Sans plafond"],
        ] as [string, string][])
      : []),
  ];
  return (
    <dl className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col border-b border-line pb-2.5">
          <dt className="text-[12px] text-muted">{k}</dt>
          <dd className="tnum text-[15px]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function PaymentDialog({ open, onClose, customerId, methods }: { open: boolean; onClose: () => void; customerId: string; methods: PaymentMethod[] }) {
  const { exec, today } = useSales();
  const { config } = useStore();
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>(methods[0]);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onClose={onClose} title="Enregistrer un règlement">
      <form
        className="grid grid-cols-1 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const r = exec((env) => recordPayment(env, { customerId, amount, method, date, note }));
          if (!r.ok) return setError(r.error);
          setAmount(0);
          setNote("");
          setError(null);
          onClose();
        }}
      >
        <Field label="Montant reçu" unit={config.sales.currency.label}>
          <IntegerInput value={amount} ariaLabel="Montant reçu" onChange={setAmount} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mode">
            <Select ariaLabel="Mode de paiement" value={methods.includes(method) ? method : methods[0]} onChange={setMethod} options={methods.map((m) => ({ value: m, label: PAYMENT_METHOD[m] }))} />
          </Field>
          <Field label="Reçu le">
            <DatePicker ariaLabel="Date du règlement" value={date} max={today} onChange={(v) => v && setDate(v)} />
          </Field>
        </div>
        <Field label="Référence">
          <input className={inputCls} value={note} placeholder="N° de chèque, de virement… (facultatif)" onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="text-[12px] text-faint">Le règlement solde d&apos;abord les factures les plus anciennes. Modes proposés : ceux du contrat.</p>
        {error && <p className="rounded-2xl border border-alert/40 bg-alert/6 p-3 text-[14px] text-alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit">Enregistrer</Button>
        </div>
      </form>
    </Dialog>
  );
}

function IncidentDialog({ open, onClose, customerId }: { open: boolean; onClose: () => void; customerId: string }) {
  const { exec } = useSales();
  const { config } = useStore();
  const [kind, setKind] = useState<IncidentKind>("LITIGE");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onClose={onClose} title="Signaler un incident">
      <form
        className="grid grid-cols-1 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const r = exec((env) => recordIncident(env, { customerId, kind, note, amount }));
          if (!r.ok) return setError(r.error);
          setNote("");
          setAmount(0);
          setError(null);
          onClose();
        }}
      >
        <Segmented
          label="Type d'incident"
          value={kind}
          onChange={setKind}
          options={[
            { value: "LITIGE", label: "Litige" },
            { value: "CHEQUE_IMPAYE", label: "Chèque impayé" },
          ]}
        />
        {kind === "CHEQUE_IMPAYE" && (
          <Field label="Montant du chèque" unit={config.sales.currency.label} hint="Remis au débit du client, exigible tout de suite">
            <IntegerInput value={amount} ariaLabel="Montant du chèque" onChange={setAmount} />
          </Field>
        )}
        <Field label="Description">
          <textarea rows={3} className={cn(inputCls, "h-auto py-2")} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <p className="rounded-2xl border border-alert/40 bg-alert/6 p-3 text-[14px] text-alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit">Enregistrer</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ReverseDialog({ open, onClose, label, onConfirm }: { open: boolean; onClose: () => void; label: string; onConfirm: (reason: string) => string | null }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onClose={onClose} title="Annuler cette écriture ?">
      <p className="text-[14px] text-muted">
        « {label} » reste dans l&apos;historique. Une écriture inverse du même montant l&apos;annule, avec votre motif.
      </p>
      <Field label="Motif" className="mt-4">
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. Saisie en double" />
      </Field>
      {error && <p className="mt-3 rounded-2xl border border-alert/40 bg-alert/6 p-3 text-[14px] text-alert">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Garder l&apos;écriture
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            const err = onConfirm(reason);
            setError(err);
            if (!err) setReason("");
          }}
        >
          Annuler l&apos;écriture
        </Button>
      </div>
    </Dialog>
  );
}
