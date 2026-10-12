"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { AlertCircle, ArrowLeft, Repeat, Search } from "@/components/ui/icons";
import { Button, Dialog, Field, IntegerInput, Segmented, Stepper, inputCls } from "@/components/ui/primitives";
import { DatePicker } from "@/components/ui/calendar";
import { Select } from "@/components/ui/select";
import { TonePill } from "@/components/sales/ui";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { checkOrder, confirmOrder, priceLines, saveDraft, type OrderCheck } from "@/lib/sales/commands/orders";
import { contractAt, categoryOf } from "@/lib/sales/contracts";
import { customersIn } from "@/lib/sales/selectors";
import { linesAmount, priceFor } from "@/lib/sales/pricing";
import { MODE, termLabel } from "@/lib/sales/labels";
import { cn, fmt, fmtMoney, fmtT } from "@/lib/format";
import { BULK, type DeliveryMode, type Order } from "@/lib/sales/types";

type Qty = Record<string, number>;

const DECISION_TONE = { ALLOW: "ok", WARN: "warn", APPROVAL: "warn", BLOCK: "alert" } as const;
const DECISION_TEXT = { ALLOW: "Crédit disponible", WARN: "À surveiller", APPROVAL: "Validation requise", BLOCK: "Crédit bloqué" } as const;

/** Quantities per format: steppers, unit price, availability and line amount, updated as you type. */
export function QtyGrid({ customerId, date, qty, onChange, check, disabled }: { customerId: string; date: string; qty: Qty; onChange: (q: Qty) => void; check: OrderCheck | null; disabled?: boolean }) {
  const { config } = useStore();
  const { data } = useSales();
  const terms = contractAt(data.contracts, customerId, date)?.terms;
  const price = (f: string) => (terms ? priceFor(config.sales.priceLists, terms.priceListId, f, date) : null);
  const formats = config.bottleTypes.filter((b) => price(b.id) != null);
  const bulk = price(BULK) != null;
  const short = new Map(check?.shortfalls.map((s) => [s.formatId, s.qty]));
  const cur = config.sales.currency.label;
  return (
    <div className="divide-y divide-line">
      {formats.map((b) => {
        const n = qty[b.id] ?? 0;
        const avail = check?.available[b.id];
        return (
          <div key={b.id} className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[72px_minmax(0,220px)_1fr]">
            <div>
              <p className="text-[15px] font-semibold">{b.label}</p>
              <p className="tnum text-[12px] text-muted">{fmt(price(b.id) ?? 0)}</p>
            </div>
            <Stepper ariaLabel={`Quantité ${b.label}`} value={n} step={b.kg >= 30 ? 1 : 10} disabled={disabled} onChange={(v) => onChange({ ...qty, [b.id]: v })} />
            <div className="col-span-2 flex items-baseline justify-between gap-2 text-[12px] sm:col-span-1 sm:block sm:text-right">
              <p className="tnum text-[14px] font-medium text-ink">{n ? fmtMoney(n * (price(b.id) ?? 0), cur) : "—"}</p>
              {avail != null && (
                <p className={cn("tnum", short.has(b.id) ? "font-medium text-warn" : "text-muted")}>{short.has(b.id) ? `Reliquat prévu : ${fmt(short.get(b.id) ?? 0)}` : `${fmt(Math.max(avail, 0))} disponibles`}</p>
              )}
            </div>
          </div>
        );
      })}
      {bulk && (
        <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[72px_minmax(0,220px)_1fr]">
          <div>
            <p className="text-[15px] font-semibold">Vrac</p>
            <p className="tnum text-[12px] text-muted">{fmt(price(BULK) ?? 0)} / kg</p>
          </div>
          <Field label="Quantité" unit="kg">
            <IntegerInput ariaLabel="Quantité de vrac en kg" value={qty[BULK] ?? 0} disabled={disabled} onChange={(v) => onChange({ ...qty, [BULK]: v })} className="h-11" />
          </Field>
          <div className="col-span-2 text-[12px] sm:col-span-1 sm:text-right">
            <p className="tnum text-[14px] font-medium text-ink">{qty[BULK] ? fmtMoney((qty[BULK] ?? 0) * (price(BULK) ?? 0), cur) : "—"}</p>
            <p className="tnum text-muted">{fmtT((qty[BULK] ?? 0) / 1000, 1)}, pesé au pont-bascule</p>
          </div>
        </div>
      )}
      {!formats.length && !bulk && <p className="py-6 text-center text-[14px] text-alert">Le tarif du contrat n&apos;a aucun prix à cette date : complétez-le dans Paramètres, Clients et contrats.</p>}
    </div>
  );
}

/** Live credit, approval and stock position of an order being entered. */
export function CheckPanel({ check, compact }: { check: OrderCheck; compact?: boolean }) {
  const { config } = useStore();
  const cur = config.sales.currency.label;
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-muted">Montant</span>
        <span className="tnum text-[26px] font-semibold tracking-[-0.02em]">
          {fmt(check.amount)}
          <span className="ml-1 text-[14px] font-medium text-muted">{cur}</span>
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-muted">Crédit</span>
        <TonePill tone={DECISION_TONE[check.credit.decision]}>{DECISION_TEXT[check.credit.decision]}</TonePill>
      </div>
      {check.credit.reasons.length > 0 && (
        <ul className={cn("space-y-1 rounded-2xl p-3 text-[13px]", check.credit.decision === "BLOCK" ? "bg-alert/8 text-alert" : "bg-warn/12 text-[#7a5306]")}>
          {check.credit.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {!compact && check.approval.length > 0 && check.credit.decision !== "BLOCK" && (
        <p className="rounded-2xl bg-warn/12 p-3 text-[13px] text-[#7a5306]">Après confirmation, la commande attendra la validation d&apos;un responsable avant le chargement.</p>
      )}
      {check.overCap.map((r) => (
        <p key={r} className="rounded-2xl bg-warn/12 p-3 text-[13px] text-[#7a5306]">
          {r} Validation du responsable requise.
        </p>
      ))}
      {check.placementBlocked && <p className="rounded-2xl bg-alert/8 p-3 text-[13px] text-alert">{check.placementBlocked}</p>}
      {check.shortfalls.length > 0 && (
        <p className="rounded-2xl bg-warn/12 p-3 text-[13px] text-[#7a5306]">
          Stock disponible insuffisant pour {check.shortfalls.length} format{check.shortfalls.length > 1 ? "s" : ""} :{" "}
          {config.sales.stock.backorder === "RELIQUAT" ? "la commande peut être confirmée, le manque deviendra un reliquat." : "réduisez les quantités, la politique du site bloque les commandes au-delà du disponible."}
        </p>
      )}
    </div>
  );
}

/**
 * Fast order entry: find the customer, type quantities, confirm. Prices,
 * credit and availability update as you type; one primary action.
 */
export function OrderEntry({ open, onClose, initialCustomer }: { open: boolean; onClose: () => void; initialCustomer?: string | null }) {
  const { config, centreId } = useStore();
  const { data, env, exec, can, today } = useSales();
  const router = useRouter();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [qty, setQty] = useState<Qty>({});
  const [mode, setMode] = useState<DeliveryMode>("LIVRAISON");
  const [date, setDate] = useState(today);
  const [centre, setCentre] = useState(centreId === "all" ? config.centres[0].id : centreId);
  const [override, setOverride] = useState("");
  const [draftId, setDraftId] = useState("");

  useEffect(() => {
    if (!open) return;
    setCustomerId(initialCustomer && data.customers.some((c) => c.id === initialCustomer && c.active) ? initialCustomer : null);
    setQuery("");
    setQty({});
    setDate(today);
    setOverride("");
    setDraftId(crypto.randomUUID());
    // A new entry each time the dialog opens; later data changes must not reset it.
  }, [open, initialCustomer]);

  const customer = data.customers.find((c) => c.id === customerId);
  useEffect(() => {
    if (!customer) return;
    if (!customer.centreIds.includes(centre)) setCentre(customer.centreIds[0]);
    const last = lastOrder(data.orders, customer.id);
    setMode(last?.mode ?? (categoryOf(config.sales, customer)?.kind === "GROSSISTE" ? "ENLEVEMENT" : "LIVRAISON"));
  }, [customer]);

  const pool = useMemo(() => customersIn(data.customers, centreId).filter((c) => c.active), [data.customers, centreId]);
  const recent = useMemo(() => {
    const seen = new Set<string>();
    return [...data.orders]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter((o) => !seen.has(o.customerId) && seen.add(o.customerId))
      .map((o) => pool.find((c) => c.id === o.customerId))
      .filter((c): c is NonNullable<typeof c> => !!c);
  }, [data.orders, pool]);
  const shown = query ? pool : recent.length ? recent : pool;

  const draft: Order | null = useMemo(() => {
    if (!customer) return null;
    const lines = priceLines(env, customer.id, date, qty);
    return {
      id: draftId,
      number: "",
      centreId: centre,
      customerId: customer.id,
      contractVersion: 0,
      workflowVersion: 0,
      mode,
      date,
      createdAt: env.now,
      createdBy: env.by,
      lines,
      status: "BROUILLON",
      approval: { required: false, reasons: [], by: null, at: null, note: null },
      reliquats: [],
      history: [],
      replaces: null,
      replacedBy: null,
      exported: false,
    };
  }, [customer, env, date, qty, centre, mode, draftId]);
  const check = useMemo(() => (draft ? checkOrder(env, draft, override.trim() ? { by: env.by, reason: override } : null) : null), [draft, env, override]);
  const last = customer ? lastOrder(data.orders, customer.id) : undefined;
  const blocked = check?.credit.decision === "BLOCK"; // only ever BLOCK when the credit check is on
  const empty = !draft || linesAmount(draft.lines) === 0;

  const save = (confirm: boolean) => {
    if (!customer) return;
    const r = exec((e) => saveDraft(e, { id: draftId, customerId: customer.id, centreId: centre, mode, date, qty }));
    if (!r.ok) return;
    if (confirm) exec((e) => confirmOrder(e, draftId, { override: blocked ? override : undefined }));
    onClose();
    router.push(`/ventes/commandes/${draftId}`);
  };

  return (
    <Dialog open={open} onClose={onClose} title={customer ? `Nouvelle commande, ${customer.name}` : "Nouvelle commande"} width="max-w-4xl">
      {!customer ? (
        <Command label="Choisir le client" className="rounded-2xl border border-line" shouldFilter={!!query}>
          <div className="flex h-12 items-center gap-2.5 border-b border-line px-4">
            <Search className="size-[18px] text-muted" />
            <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder="Client : nom, code, zone…" className="h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" />
          </div>
          <Command.List className="scroll-area max-h-[min(380px,55vh)] overflow-y-auto p-1.5">
            <Command.Empty className="py-8 text-center text-[14px] text-muted">Aucun client ne correspond. Créez-le depuis la page Clients.</Command.Empty>
            {!query && recent.length > 0 && <p className="px-3 pt-2 pb-1 text-[12px] font-medium text-faint">Récemment servis</p>}
            {shown.map((c) => {
              const terms = contractAt(data.contracts, c.id, today)?.terms;
              return (
                <Command.Item
                  key={c.id}
                  value={`${c.name} ${c.code} ${c.zone} ${c.contact.name}`}
                  onSelect={() => setCustomerId(c.id)}
                  className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-[14px] data-[selected=true]:bg-board"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block truncate text-[12px] text-muted">
                      {c.code}, {c.zone}, {categoryOf(config.sales, c)?.label ?? ""}
                    </span>
                  </span>
                  {terms && <span className="text-[12px] text-faint">{termLabel(terms.payment)}</span>}
                </Command.Item>
              );
            })}
          </Command.List>
        </Command>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-end gap-2">
              <button type="button" onClick={() => setCustomerId(null)} className="inline-flex h-10 items-center gap-1.5 rounded-full px-2 text-[13px] text-muted hover:text-ink">
                <ArrowLeft className="size-4" />
                Autre client
              </button>
              <Segmented label="Mode" value={mode} onChange={setMode} options={(["LIVRAISON", "ENLEVEMENT"] as const).map((m) => ({ value: m, label: MODE[m] }))} />
              <div className="w-full sm:w-56">
                <DatePicker ariaLabel="Date souhaitée" value={date} min={today} onChange={(v) => v && setDate(v)} />
              </div>
              {customer.centreIds.length > 1 && (
                <Select className="w-full sm:w-52" ariaLabel="Centre" value={centre} onChange={setCentre} options={customer.centreIds.map((id) => ({ value: id, label: config.centres.find((c) => c.id === id)?.name ?? id }))} />
              )}
            </div>
            {last && (
              <Button
                size="sm"
                variant="soft"
                className="mt-3"
                onClick={() => setQty(Object.fromEntries(last.lines.map((l) => [l.formatId, l.qty])))}
              >
                <Repeat className="size-4" />
                Reprendre la dernière commande ({last.number})
              </Button>
            )}
            <div className="mt-2">
              <QtyGrid customerId={customer.id} date={date} qty={qty} onChange={setQty} check={check} />
            </div>
          </div>
          <div className="rounded-2xl bg-board p-4 lg:self-start">
            {check && <CheckPanel check={check} />}
            {blocked && (
              <div className="mt-3">
                {can("credit.override") ? (
                  <Field label="Motif du forçage" hint="Inscrit dans l'historique ; la commande attendra ensuite une validation">
                    <input className={inputCls} value={override} onChange={(e) => setOverride(e.target.value)} placeholder="Ex. Garantie bancaire reçue" />
                  </Field>
                ) : (
                  <p className="flex items-start gap-2 text-[13px] text-muted">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    Un responsable commercial peut forcer en indiquant un motif. Gardez la commande en brouillon en attendant.
                  </p>
                )}
              </div>
            )}
            <div className="mt-4 flex flex-col gap-2">
              <Button disabled={empty || (!!blocked && !override.trim()) || !!check?.placementBlocked || (check?.failures.some((f) => f.guard !== "credit") ?? false)} onClick={() => save(true)}>
                {blocked && can("credit.override") ? "Forcer et confirmer" : "Confirmer la commande"}
              </Button>
              <Button variant="ghost" disabled={empty} onClick={() => save(false)}>
                Garder en brouillon
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** The customer's latest order that was not cancelled. */
export const lastOrder = (orders: Order[], customerId: string) =>
  orders.filter((o) => o.customerId === customerId && o.status !== "ANNULEE").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
