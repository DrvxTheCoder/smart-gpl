"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { ArrowLeft } from "@/components/ui/icons";
import { Button, Card, CardTitle, Field, IntegerInput, Stepper } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { ConfirmCount, CountGrid } from "@/components/sales/warehouse-ui";
import { Missing } from "@/components/sales/ui";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { consignmentPrice, recordPassage } from "@/lib/sales/commands/consignment";
import { byFormat, clientSite, siteBalance } from "@/lib/sales/bottle-ledger";
import { contractAt, isWholesaler } from "@/lib/sales/contracts";
import { PAYMENT_METHOD } from "@/lib/sales/labels";
import { cap, cn, fmt, fmtDate, fmtMoney } from "@/lib/format";
import type { BrandGrid, Confirmation, PaymentMethod } from "@/lib/sales/types";

/**
 * A wholesaler's visit is the settlement: every empty returned, of any brand,
 * is a bottle sold, and the same number of fulls is handed over by default.
 * A page of its own: the count runs brand by brand and takes a while.
 */
function Inner() {
  const { id } = useParams<{ id: string }>();
  const back = useSearchParams().get("depuis") === "grossistes" ? { href: "/ventes/grossistes", label: "Grossistes" } : null;
  const router = useRouter();
  const { config } = useStore();
  const { data, env, ledger, exec, today, own } = useSales();
  const customer = data.customers.find((c) => c.id === decodeURIComponent(id));
  const terms = customer ? contractAt(data.contracts, customer.id, today)?.terms : undefined;
  const [empties, setEmpties] = useState<BrandGrid>({});
  const [given, setGiven] = useState<Record<string, number> | null>(null); // null: follow what was sold
  const [paid, setPaid] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [confs, setConfs] = useState<Confirmation[]>([]);

  const held = useMemo(() => (customer ? siteBalance(ledger, clientSite(customer.id)).PLEIN[own] ?? {} : {}), [customer, ledger, own]);

  if (!customer || !isWholesaler(config.sales, customer)) return <Missing text="Ce grossiste n'existe pas." href="/ventes/grossistes" back="Revenir aux grossistes" />;

  const sheet = `/ventes/clients/${customer.id}`;
  const done = back?.href ?? sheet;
  const formats = config.bottleTypes.filter((b) => (held[b.id] ?? 0) > 0 || (terms?.floatCap[b.id] ?? 0) > 0);
  const sold = byFormat(empties);
  const soldTotal = Object.values(sold).reduce((a, b) => a + b, 0);
  const handed = given ?? sold;
  const amount = formats.reduce((a, b) => a + (sold[b.id] ?? 0) * consignmentPrice(env, customer.id, b.id, today), 0);
  const perVisit = terms?.paymentTrigger === "A_CHAQUE_PASSAGE";
  const pay = paid ?? (perVisit ? amount : 0);
  const mode = method ?? terms?.methods[0] ?? "ESPECES";
  const cur = config.sales.currency.label;
  const heldTotal = Object.values(held).reduce((a, b) => a + b, 0);
  const competitor = Object.entries(empties)
    .filter(([b]) => b !== own)
    .reduce((a, [, row]) => a + Object.values(row).reduce((x, y) => x + y, 0), 0);
  const confirmed = confs.length >= 2;

  const save = () => {
    const r = exec((e) => recordPassage(e, { customerId: customer.id, empties, given: handed, paid: pay > 0 ? { amount: pay, method: mode } : null, confirmations: confs }));
    if (r.ok) router.push(done);
  };

  return (
    <div>
      <Link href={back?.href ?? sheet} className="mb-3 inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-ink">
        <ArrowLeft className="size-4" />
        {back?.label ?? customer.name}
      </Link>

      <div className="mb-5">
        <h1 className="text-[30px] font-semibold tracking-[-0.03em] sm:text-[36px]">Passage</h1>
        <p className="mt-1 text-[15px] text-muted">
          {customer.name}, {fmtDate(today, { weekday: "long", day: "numeric", month: "long" })}. {fmt(heldTotal)} pleins en dépôt avant le passage.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <Step n={1} title="Vides rendues" />
            <p className="mt-1 text-[13px] text-muted">Toutes marques : chaque vide est une bouteille vendue. La marque ne change pas le montant, elle sert à l&apos;état journalier.</p>
            <div className="mt-4">
              <CountGrid brands={config.sales.brands} formats={formats} value={empties} onChange={setEmpties} />
            </div>
          </Card>

          <Card>
            <Step n={2} title="Pleins remis" />
            <p className="mt-1 text-[13px] text-muted">Par défaut autant que vendu, pour garder le dépôt au même niveau.</p>
            <div className="mt-3 divide-y divide-line">
              {formats.map((b) => {
                const after = (held[b.id] ?? 0) - (sold[b.id] ?? 0) + (handed[b.id] ?? 0);
                const ceiling = terms?.floatCap[b.id] ?? 0;
                return (
                  <div key={b.id} className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[60px_minmax(0,220px)_1fr]">
                    <span className="text-[14px] font-semibold">{b.label}</span>
                    <Stepper ariaLabel={`Pleins remis ${b.label}`} value={handed[b.id] ?? 0} step={10} onChange={(n) => setGiven({ ...handed, [b.id]: n })} />
                    <span className={cn("tnum col-span-2 text-[12px] sm:col-span-1 sm:text-right", ceiling && after > ceiling ? "font-medium text-warn" : "text-muted")}>
                      Dépôt après : {fmt(after)}
                      {ceiling ? ` / plafond ${fmt(ceiling)}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <Step n={3} title="Double confirmation" />
            <p className="mt-1 text-[13px] text-muted">La commerciale et le grossiste confirment le comptage avec leur nom et leur code.</p>
            <div className="mt-4">
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
          </Card>
        </div>

        <Card className="h-fit xl:sticky xl:top-[100px]">
          <CardTitle>Récapitulatif</CardTitle>
          <dl className="tnum mt-4 space-y-2 text-[14px]">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Bouteilles vendues</dt>
              <dd className="text-[22px] font-semibold">{fmt(soldTotal)}</dd>
            </div>
            {competitor > 0 && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">Dont vides d&apos;autres marques</dt>
                <dd>{fmt(competitor)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Pleins remis</dt>
              <dd>{fmt(Object.values(handed).reduce((a, b) => a + b, 0))}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
              <dt className="text-muted">Montant des ventes</dt>
              <dd className="text-[22px] font-semibold whitespace-nowrap">{fmtMoney(amount, cur)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[12px] text-muted">
            Prix {config.sales.consignment.priceBasis === "SETTLEMENT" ? "du jour du passage" : "du jour de la mise en dépôt"}.{" "}
            {terms?.invoicing === "RELEVE_PERIODIQUE" ? "Facturé sur le prochain relevé." : "Facturé avec ce passage."}
          </p>
          <div className="mt-4 space-y-3">
            <Field label="Encaissé" unit={cur} hint={perVisit ? "Le contrat prévoit un règlement à chaque passage" : "Règlement prévu au relevé ou à l'échéance"}>
              <IntegerInput ariaLabel="Montant encaissé" value={pay} onChange={setPaid} className="h-11" />
            </Field>
            {pay > 0 && (
              <Field label="Mode">
                <Select ariaLabel="Mode de paiement" value={mode} onChange={setMethod} options={(terms?.methods ?? ["ESPECES"]).map((m) => ({ value: m, label: PAYMENT_METHOD[m] }))} />
              </Field>
            )}
          </div>
          <Button className="mt-5 w-full" disabled={!confirmed} onClick={save}>
            Enregistrer le passage
          </Button>
          {!confirmed && <p className="mt-2 text-[12px] text-muted">{cap(confs.length ? "il manque une confirmation (étape 3)." : "les deux parties confirment le comptage avant l'enregistrement (étape 3).")}</p>}
        </Card>
      </div>
    </div>
  );
}

function Step({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="tnum grid size-7 shrink-0 place-items-center rounded-full bg-brand-100 text-[13px] font-semibold text-brand-800">{n}</span>
      <CardTitle>{title}</CardTitle>
    </div>
  );
}

export default function PassagePage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
