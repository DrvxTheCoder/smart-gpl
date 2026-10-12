"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Field, IntegerInput, Stepper } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { ConfirmCount, CountGrid } from "@/components/sales/warehouse-ui";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { consignmentPrice, recordPassage } from "@/lib/sales/commands/consignment";
import { byFormat, clientSite, siteBalance } from "@/lib/sales/bottle-ledger";
import { contractAt } from "@/lib/sales/contracts";
import { PAYMENT_METHOD } from "@/lib/sales/labels";
import { cn, fmt, fmtMoney } from "@/lib/format";
import type { BrandGrid, Confirmation, PaymentMethod } from "@/lib/sales/types";

/**
 * A visit is the settlement: every empty returned, of any brand, is a bottle
 * sold. The same number of fulls is handed over by default.
 */
export function PassageDialog({ open, onClose, customerId }: { open: boolean; onClose: () => void; customerId: string | null }) {
  const { config } = useStore();
  const { data, env, ledger, exec, today, own } = useSales();
  const customer = data.customers.find((c) => c.id === customerId);
  const terms = customer ? contractAt(data.contracts, customer.id, today)?.terms : undefined;
  const [empties, setEmpties] = useState<BrandGrid>({});
  const [given, setGiven] = useState<Record<string, number> | null>(null); // null: follow what was sold
  const [paid, setPaid] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("ESPECES");
  const [confs, setConfs] = useState<Confirmation[]>([]);

  useEffect(() => {
    if (!open) return;
    setEmpties({});
    setGiven(null);
    setPaid(null);
    setConfs([]);
    setMethod(terms?.methods[0] ?? "ESPECES");
    // Fresh form each time it opens.
  }, [open, customerId]);

  const held = useMemo(() => (customer ? siteBalance(ledger, clientSite(customer.id)).PLEIN[own] ?? {} : {}), [customer, ledger, own]);
  const formats = config.bottleTypes.filter((b) => (held[b.id] ?? 0) > 0 || (terms?.floatCap[b.id] ?? 0) > 0);
  const sold = byFormat(empties);
  const handed = given ?? sold;
  const amount = formats.reduce((a, b) => a + (sold[b.id] ?? 0) * (customer ? consignmentPrice(env, customer.id, b.id, today) : 0), 0);
  const perVisit = terms?.paymentTrigger === "A_CHAQUE_PASSAGE";
  const pay = paid ?? (perVisit ? amount : 0);
  const cur = config.sales.currency.label;
  const competitor = Object.entries(empties)
    .filter(([b]) => b !== own)
    .reduce((a, [, row]) => a + Object.values(row).reduce((x, y) => x + y, 0), 0);

  if (!customer) return null;

  return (
    <Dialog open={open} onClose={onClose} title={`Passage de ${customer.name}`} width="max-w-4xl">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <p className="text-[14px] text-muted">Comptez les vides rendues, toutes marques : chaque vide est une bouteille vendue. La marque ne change pas le montant, elle sert à l&apos;état journalier.</p>
          <div className="mt-4">
            <CountGrid brands={config.sales.brands} formats={formats} value={empties} onChange={setEmpties} />
          </div>
          <h3 className="mt-6 text-[15px] font-medium">Pleins remis</h3>
          <p className="text-[13px] text-muted">Par défaut autant que vendu, pour garder le dépôt au même niveau.</p>
          <div className="mt-2 divide-y divide-line">
            {formats.map((b) => {
              const after = (held[b.id] ?? 0) - (sold[b.id] ?? 0) + (handed[b.id] ?? 0);
              const cap = terms?.floatCap[b.id] ?? 0;
              return (
                <div key={b.id} className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[60px_minmax(0,220px)_1fr]">
                  <span className="text-[14px] font-semibold">{b.label}</span>
                  <Stepper ariaLabel={`Pleins remis ${b.label}`} value={handed[b.id] ?? 0} step={10} onChange={(n) => setGiven({ ...handed, [b.id]: n })} />
                  <span className={cn("tnum col-span-2 text-[12px] sm:col-span-1 sm:text-right", cap && after > cap ? "font-medium text-warn" : "text-muted")}>
                    Dépôt après : {fmt(after)}
                    {cap ? ` / plafond ${fmt(cap)}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-6">
            <p className="mb-2 text-[13px] text-muted">Double confirmation du comptage</p>
            <ConfirmCount
              parties={[
                { role: "Commerciale", name: env.by },
                { role: "Grossiste", name: customer.contact.name },
              ]}
              value={confs}
              onConfirm={(c) => {
                setConfs((list) => [...list.filter((x) => x.role !== c.role), { ...c, at: new Date().toISOString() }]);
                return true;
              }}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-2xl bg-board p-4 lg:self-start">
          <dl className="tnum space-y-2 text-[14px]">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Bouteilles vendues</dt>
              <dd className="text-[20px] font-semibold">{fmt(Object.values(sold).reduce((a, b) => a + b, 0))}</dd>
            </div>
            {competitor > 0 && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">Dont vides d&apos;autres marques</dt>
                <dd>{fmt(competitor)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
              <dt className="text-muted">Montant des ventes</dt>
              <dd className="text-[20px] font-semibold whitespace-nowrap">{fmtMoney(amount, cur)}</dd>
            </div>
          </dl>
          <p className="text-[12px] text-muted">
            Prix {config.sales.consignment.priceBasis === "SETTLEMENT" ? "du jour du passage" : "du jour de la mise en dépôt"}.{" "}
            {terms?.invoicing === "RELEVE_PERIODIQUE" ? "Facturé sur le prochain relevé." : "Facturé avec ce passage."}
          </p>
          <Field label="Encaissé" unit={cur} hint={perVisit ? "Le contrat prévoit un règlement à chaque passage" : "Règlement prévu au relevé ou à l'échéance"}>
            <IntegerInput ariaLabel="Montant encaissé" value={pay} onChange={setPaid} className="h-11" />
          </Field>
          {pay > 0 && (
            <Field label="Mode">
              <Select ariaLabel="Mode de paiement" value={method} onChange={setMethod} options={(terms?.methods ?? ["ESPECES"]).map((m) => ({ value: m, label: PAYMENT_METHOD[m] }))} />
            </Field>
          )}
          <Button
            className="w-full"
            disabled={confs.length < 2}
            onClick={() => {
              const r = exec((e) => recordPassage(e, { customerId: customer.id, empties, given: handed, paid: pay > 0 ? { amount: pay, method } : null, confirmations: confs }));
              if (r.ok) onClose();
            }}
          >
            Enregistrer le passage
          </Button>
          {confs.length < 2 && <p className="text-[12px] text-muted">Les deux parties confirment avant l&apos;enregistrement.</p>}
        </div>
      </div>
    </Dialog>
  );
}
