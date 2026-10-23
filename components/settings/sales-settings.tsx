"use client";

import { useState } from "react";
import { Check, Lock, Plus, Trash2 } from "@/components/ui/icons";
import { Button, Card, CardTitle, Field, IntegerInput, NumberInput, Segmented, Switch, inputCls } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/calendar";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { ACCOUNTS, DEMO_PASSWORD, useAuth } from "@/lib/auth";
import { moduleDef } from "@/lib/modules";
import { cn, fmt, fmtMoney } from "@/lib/format";
import { ACTIONS, PRESETS, WORKFLOW_STEPS } from "@/lib/sales/defaults";
import { PAYMENT_METHODS } from "@/lib/sales/config";
import { AUTHORITY_COLUMNS, fileName } from "@/lib/sales/day-close";
import { SAGE_COLUMNS } from "@/lib/sales/sage";
import { formatNumber } from "@/lib/sales/lifecycle";
import { BILLING, DECISION, INVOICING, LADDER, PAYMENT_METHOD, PAYMENT_TRIGGER } from "@/lib/sales/labels";
import { BULK, type ContractTerms, type CustomerCategory, type Decision, type ReasonCode, type ReportTemplate, type SalesConfig, type WorkflowConfig } from "@/lib/sales/types";

/* Sales sections of Paramètres. Every change goes straight into the tenant
   configuration, like the production sections. */

function useSalesConfig() {
  const { config, setConfig } = useStore();
  const set = (fn: (s: SalesConfig) => SalesConfig) => setConfig((cfg) => ({ ...cfg, sales: fn(cfg.sales) }));
  // Orders record the workflow version they were made under, so any change bumps it.
  const setWorkflow = (patch: Partial<WorkflowConfig>) => set((s) => ({ ...s, workflow: { ...s.workflow, ...patch, version: s.workflow.version + 1 } }));
  return { sales: config.sales, config, set, setWorkflow };
}

const slug = (s: string) =>
  s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "") || `MOTIF_${Date.now().toString(36).toUpperCase()}`;

function RemoveBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-10 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-alert/10 hover:text-alert disabled:pointer-events-none disabled:opacity-30"
    >
      <Trash2 className="size-4" />
    </button>
  );
}


const DECISIONS: Exclude<Decision, "ALLOW">[] = ["WARN", "APPROVAL", "BLOCK"];

/* ---------------- Clients et contrats ---------------- */

export function TermsEditor({ terms, onChange, wholesaler, disabled }: { terms: ContractTerms; onChange: (t: ContractTerms) => void; wholesaler: boolean; disabled?: boolean }) {
  const { sales, config } = useSalesConfig();
  const set = (patch: Partial<ContractTerms>) => onChange({ ...terms, ...patch });
  const deferred = terms.payment.kind === "DIFFERE";
  const formats = config.bottleTypes;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Paiement">
        <Select
          ariaLabel="Délai de paiement"
          disabled={disabled}
          value={deferred ? String(terms.payment.days) : "0"}
          onChange={(v) => set({ payment: v === "0" ? { kind: "COMPTANT", days: 0 } : { kind: "DIFFERE", days: Number(v) } })}
          options={[
            { value: "0", label: "Comptant" },
            ...[15, 30, 45, 60, 90].map((d) => ({ value: String(d), label: `Différé, ${d} jours` })),
            ...(deferred && ![15, 30, 45, 60, 90].includes(terms.payment.days) ? [{ value: String(terms.payment.days), label: `Différé, ${terms.payment.days} jours` }] : []),
          ]}
        />
      </Field>
      <Field label="Plafond de crédit" unit={sales.currency.label}>
        <IntegerInput value={terms.creditLimit} disabled={disabled} onChange={(v) => set({ creditLimit: v })} />
      </Field>
      <Field label="Tarif">
        <Select ariaLabel="Tarif" disabled={disabled} value={terms.priceListId} onChange={(v) => set({ priceListId: v })} options={sales.priceLists.map((p) => ({ value: p.id, label: p.label }))} />
      </Field>
      <Field label="Garanties détenues" unit={sales.currency.label}>
        <IntegerInput value={terms.guarantees} disabled={disabled} onChange={(v) => set({ guarantees: v })} />
      </Field>
      <Field label="Facturation">
        <Select ariaLabel="Facturation" disabled={disabled} value={terms.billing} onChange={(v) => set({ billing: v })} options={Object.entries(BILLING).map(([value, label]) => ({ value: value as ContractTerms["billing"], label }))} />
      </Field>
      <Field label="Règlement">
        <Select
          ariaLabel="Déclencheur du règlement"
          disabled={disabled}
          value={terms.paymentTrigger}
          onChange={(v) => set({ paymentTrigger: v })}
          options={Object.entries(PAYMENT_TRIGGER).map(([value, label]) => ({ value: value as ContractTerms["paymentTrigger"], label }))}
        />
      </Field>
      {wholesaler && (
        <>
          <Field label="Facture">
            <Select ariaLabel="Mode de facturation" disabled={disabled} value={terms.invoicing} onChange={(v) => set({ invoicing: v })} options={Object.entries(INVOICING).map(([value, label]) => ({ value: value as ContractTerms["invoicing"], label }))} />
          </Field>
          <Field label="Relance après" unit="jours" hint="Vide : valeur de la catégorie ou du réglage général">
            <input
              className={inputCls}
              inputMode="numeric"
              disabled={disabled}
              value={terms.inactivityDays ?? ""}
              placeholder="Par défaut"
              onChange={(e) => {
                const n = Number(e.target.value.replace(/\D/g, ""));
                set({ inactivityDays: e.target.value.trim() && n >= 1 ? n : null });
              }}
            />
          </Field>
        </>
      )}
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-[13px] text-muted">Modes de paiement acceptés</legend>
        <div className="flex flex-wrap gap-2">
          {PAYMENT_METHODS.map((m) => {
            const on = terms.methods.includes(m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                disabled={disabled || (on && terms.methods.length === 1)}
                onClick={() => set({ methods: on ? terms.methods.filter((x) => x !== m) : [...terms.methods, m] })}
                className={cn(
                  "h-9 rounded-full border px-3.5 text-[13px] transition-colors disabled:opacity-60",
                  on ? "border-brand-800 bg-brand-800 text-white" : "border-line bg-field text-ink hover:border-brand-600",
                )}
              >
                {PAYMENT_METHOD[m]}
              </button>
            );
          })}
        </div>
      </fieldset>
      {wholesaler && (
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-[13px] text-muted">Plafond de bouteilles en consignation, par format (0 : sans plafond)</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {formats.map((b) => (
              <Field key={b.id} label={b.label}>
                <IntegerInput ariaLabel={`Plafond ${b.label}`} disabled={disabled} value={terms.floatCap[b.id] ?? 0} onChange={(v) => set({ floatCap: { ...terms.floatCap, [b.id]: v } })} />
              </Field>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

export function CustomersPanel() {
  const { sales, set, config } = useSalesConfig();
  const { can } = useSales();
  const [open, setOpen] = useState<string | null>(sales.categories[0]?.id ?? null);
  const setCat = (id: string, fn: (c: CustomerCategory) => CustomerCategory) => set((s) => ({ ...s, categories: s.categories.map((c) => (c.id === id ? fn(c) : c)) }));
  const canPrice = can("price.edit");
  const formats = [...config.bottleTypes.map((b) => ({ id: b.id, label: b.label })), { id: BULK, label: "Vrac (par kg)" }];
  const w = sales.solvency.weights;
  const wTotal = w.delay + w.overdue + w.utilization + w.incidents || 1;

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Catégories de clients</CardTitle>
            <p className="mt-1 text-[13px] text-muted">Chaque catégorie donne ses conditions par défaut aux nouveaux contrats et sa règle de crédit.</p>
          </div>
          <Button
            size="sm"
            variant="soft"
            onClick={() => {
              const id = `cat-${Date.now().toString(36)}`;
              set((s) => ({ ...s, categories: [...s.categories, { ...s.categories[0], id, label: "Nouvelle catégorie", kind: "STANDARD" }] }));
              setOpen(id);
            }}
          >
            <Plus className="size-4" />
            Ajouter une catégorie
          </Button>
        </div>
        <ul className="mt-5 space-y-2">
          {sales.categories.map((cat) => {
            const expanded = open === cat.id;
            return (
              <li key={cat.id} className="rounded-2xl bg-board">
                <div className="flex items-center gap-3 p-3">
                  <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : cat.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{cat.label}</span>
                      <span className="block truncate text-[12px] text-muted">
                        {cat.kind === "GROSSISTE" ? "Consignation, " : ""}
                        {cat.defaults.payment.kind === "COMPTANT" ? "comptant" : `${cat.defaults.payment.days} jours`}, plafond {fmtMoney(cat.defaults.creditLimit, sales.currency.label)}
                      </span>
                    </span>
                    <span className="text-[13px] text-brand-ink">{expanded ? "Replier" : "Modifier"}</span>
                  </button>
                  <RemoveBtn label={`Supprimer ${cat.label}`} disabled={sales.categories.length <= 1} onClick={() => set((s) => ({ ...s, categories: s.categories.filter((c) => c.id !== cat.id) }))} />
                </div>
                {expanded && (
                  <div className="panel-in space-y-5 border-t border-line p-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
                      <Field label="Libellé">
                        <input className={inputCls} value={cat.label} onChange={(e) => setCat(cat.id, (c) => ({ ...c, label: e.target.value }))} />
                      </Field>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[13px] text-muted">Type</span>
                        <Segmented
                          label="Type de catégorie"
                          value={cat.kind}
                          onChange={(v) => setCat(cat.id, (c) => ({ ...c, kind: v, defaults: v === "GROSSISTE" ? { ...c.defaults, billing: "A_LA_VENTE", paymentTrigger: "A_CHAQUE_PASSAGE" } : c.defaults }))}
                          options={[
                            { value: "STANDARD", label: "Standard" },
                            { value: "GROSSISTE", label: "Grossiste" },
                          ]}
                        />
                      </div>
                    </div>
                    <TermsEditor terms={cat.defaults} wholesaler={cat.kind === "GROSSISTE"} onChange={(t) => setCat(cat.id, (c) => ({ ...c, defaults: t }))} />
                    <div>
                      <h3 className="text-[15px] font-medium">Règle de crédit</h3>
                      <div className="mt-3 grid gap-4 sm:grid-cols-3">
                        <Field label="Plafond dépassé">
                          <Select ariaLabel="Plafond dépassé" value={cat.credit.onLimit} onChange={(v) => setCat(cat.id, (c) => ({ ...c, credit: { ...c.credit, onLimit: v } }))} options={DECISIONS.map((d) => ({ value: d, label: DECISION[d] }))} />
                        </Field>
                        <Field label="Retard toléré" unit="jours">
                          <IntegerInput value={cat.credit.overdueDays} onChange={(v) => setCat(cat.id, (c) => ({ ...c, credit: { ...c.credit, overdueDays: v } }))} />
                        </Field>
                        <Field label="Au-delà du retard toléré">
                          <Select ariaLabel="Au-delà du retard toléré" value={cat.credit.onOverdue} onChange={(v) => setCat(cat.id, (c) => ({ ...c, credit: { ...c.credit, onOverdue: v } }))} options={DECISIONS.map((d) => ({ value: d, label: DECISION[d] }))} />
                        </Field>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Tarifs</CardTitle>
            <p className="mt-1 text-[13px] text-muted">Prix unitaires datés : une nouvelle ligne prend effet à sa date, les commandes passées gardent leur prix.</p>
          </div>
          {!canPrice && (
            <span className="flex items-center gap-1.5 text-[13px] text-muted">
              <Lock className="size-4" /> Lecture seule pour votre rôle
            </span>
          )}
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 2xl:grid-cols-2">
          {sales.priceLists.map((pl) => (
            <div key={pl.id} className="rounded-2xl border border-line p-4">
              <input
                aria-label="Nom du tarif"
                disabled={!canPrice}
                className={cn(inputCls, "font-medium")}
                value={pl.label}
                onChange={(e) => set((s) => ({ ...s, priceLists: s.priceLists.map((x) => (x.id === pl.id ? { ...x, label: e.target.value } : x)) }))}
              />
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[440px] text-[14px]">
                  <thead>
                    <tr className="text-left text-[12px] text-muted">
                      <th className="pb-2 font-medium">Format</th>
                      <th className="pb-2 font-medium">À partir du</th>
                      <th className="pb-2 font-medium">Prix unitaire</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {pl.lines.map((l, i) => {
                      const upd = (patch: Partial<typeof l>) => set((s) => ({ ...s, priceLists: s.priceLists.map((x) => (x.id === pl.id ? { ...x, lines: x.lines.map((y, j) => (j === i ? { ...y, ...patch } : y)) } : x)) }));
                      return (
                        <tr key={`${l.formatId}-${l.from}-${i}`} className="border-t border-line">
                          <td className="py-2 pr-2">
                            <Select ariaLabel="Format" disabled={!canPrice} value={l.formatId} onChange={(v) => upd({ formatId: v })} options={formats.map((f) => ({ value: f.id, label: f.label }))} />
                          </td>
                          <td className="py-2 pr-2">
                            <DatePicker ariaLabel="Date d'effet" disabled={!canPrice} value={l.from} onChange={(v) => v && upd({ from: v })} />
                          </td>
                          <td className="py-2 pr-2">
                            <IntegerInput ariaLabel={`Prix ${l.formatId}`} disabled={!canPrice} value={l.price} onChange={(v) => upd({ price: v })} />
                          </td>
                          <td className="py-2">
                            <RemoveBtn label="Supprimer la ligne" disabled={!canPrice} onClick={() => set((s) => ({ ...s, priceLists: s.priceLists.map((x) => (x.id === pl.id ? { ...x, lines: x.lines.filter((_, j) => j !== i) } : x)) }))} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="mt-3"
                disabled={!canPrice}
                onClick={() => set((s) => ({ ...s, priceLists: s.priceLists.map((x) => (x.id === pl.id ? { ...x, lines: [...x.lines, { formatId: formats[0].id, from: new Date().toISOString().slice(0, 10), price: 0 }] } : x)) }))}
              >
                <Plus className="size-4" />
                Ajouter un prix
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>Solvabilité</CardTitle>
        <p className="mt-1 text-[13px] text-muted">
          Note de 0 à 100, calculée par règles et expliquée sur chaque fiche client. Les pondérations et seuils fournis sont indicatifs : ajustez-les à votre politique de crédit.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {(
            [
              ["delay", "Délai de paiement"],
              ["overdue", "Part d'impayés échus"],
              ["utilization", "Utilisation du plafond"],
              ["incidents", "Incidents"],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label} unit={`${fmt((w[k] / wTotal) * 100)} %`}>
              <IntegerInput value={w[k]} onChange={(v) => set((s) => ({ ...s, solvency: { ...s.solvency, weights: { ...s.solvency.weights, [k]: v } } }))} />
            </Field>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Field label="Solvable à partir de" unit="/ 100">
            <IntegerInput value={sales.solvency.okFrom} onChange={(v) => set((s) => ({ ...s, solvency: { ...s.solvency, okFrom: Math.min(Math.max(v, s.solvency.warnFrom), 100) } }))} />
          </Field>
          <Field label="À surveiller à partir de" unit="/ 100">
            <IntegerInput value={sales.solvency.warnFrom} onChange={(v) => set((s) => ({ ...s, solvency: { ...s.solvency, warnFrom: Math.min(v, s.solvency.okFrom) } }))} />
          </Field>
          <Field label="Historique analysé" unit="jours">
            <IntegerInput value={sales.solvency.lookbackDays} min={7} onChange={(v) => set((s) => ({ ...s, solvency: { ...s.solvency, lookbackDays: v } }))} />
          </Field>
        </div>
        <div className="mt-5 flex h-3 overflow-hidden rounded-full" aria-hidden>
          <span className="bg-alert/80" style={{ flex: sales.solvency.warnFrom }} />
          <span className="bg-warn/70" style={{ flex: Math.max(sales.solvency.okFrom - sales.solvency.warnFrom, 0.5) }} />
          <span className="bg-ok/70" style={{ flex: 100 - sales.solvency.okFrom }} />
        </div>
        <p className="tnum mt-2 text-[12px] text-muted">
          À justifier sous {sales.solvency.warnFrom}, à surveiller jusqu&apos;à {sales.solvency.okFrom}, solvable au-delà.
        </p>
      </Card>
    </div>
  );
}

/* ---------------- Ventes et flux ---------------- */

function ReasonList({ title, sub, items, onChange }: { title: string; sub: string; items: ReasonCode[]; onChange: (v: ReasonCode[]) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div>
      <h3 className="text-[15px] font-medium">{title}</h3>
      <p className="text-[13px] text-muted">{sub}</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {items.map((r) => (
          <li key={r.code} className="flex h-9 items-center gap-1 rounded-full bg-board pr-1 pl-3.5 text-[13px]" title={r.code}>
            {r.label}
            <button
              type="button"
              aria-label={`Retirer ${r.label}`}
              disabled={items.length <= 1}
              onClick={() => onChange(items.filter((x) => x.code !== r.code))}
              className="grid size-7 place-items-center rounded-full text-muted hover:bg-alert/10 hover:text-alert disabled:opacity-30"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const label = draft.trim();
          const code = slug(label);
          if (label && !items.some((x) => x.code === code)) onChange([...items, { code, label }]);
          setDraft("");
        }}
      >
        <input className={inputCls} placeholder="Nouveau motif" aria-label={`Nouveau motif, ${title}`} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button size="sm" variant="soft" type="submit" className="h-10 shrink-0">
          <Plus className="size-4" />
          Ajouter
        </Button>
      </form>
    </div>
  );
}

export function WorkflowPanel() {
  const { sales, set, setWorkflow } = useSalesConfig();
  const { toast } = useStore();
  const wf = sales.workflow;
  const active = PRESETS.find((p) => Object.entries(p.steps).every(([k, v]) => wf.steps[k as keyof typeof wf.steps] === v));
  const sample = (pattern: string) => formatNumber(pattern, { centre: "RUF", date: new Date().toISOString().slice(0, 10), seq: 42 });

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card>
        <CardTitle>Préréglages</CardTitle>
        <p className="mt-1 text-[13px] text-muted">Un clic règle toutes les étapes facultatives. Vous pouvez ensuite ajuster chaque étape.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Préréglage du flux">
          {PRESETS.map((p) => {
            const on = active?.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setWorkflow({ steps: p.steps });
                  toast(`Préréglage « ${p.label} » appliqué`, "success");
                }}
                className={cn("rounded-2xl border p-4 text-left transition-colors", on ? "border-brand-800 bg-brand-50" : "border-line hover:border-faint")}
              >
                <span className="flex items-center justify-between gap-2 text-[15px] font-medium">
                  {p.label}
                  <span className={cn("grid size-5 place-items-center rounded-full border", on ? "border-brand-800 bg-brand-800 text-white" : "border-line")}>{on && <Check className="size-3" />}</span>
                </span>
                <span className="mt-1 block text-[13px] text-muted">{p.sub}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Étapes du flux commande-livraison</CardTitle>
          <span className="tnum text-[12px] text-faint">Version {wf.version}</span>
        </div>
        <p className="mt-1 text-[13px] text-muted">
          Le cycle Brouillon, Confirmée, Expédiée, Livrée, Clôturée est fixe. La sortie de stock, le mouvement des vides et l&apos;écriture client s&apos;exécutent toujours, quelles que soient les étapes actives.
        </p>
        <ul className="mt-4 divide-y divide-line">
          {WORKFLOW_STEPS.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-[15px] font-medium">{s.label}</p>
                <p className="text-[13px] text-muted">{s.sub}</p>
                {s.id === "approval" && wf.steps.approval && (
                  <div className="mt-3 max-w-xs">
                    <Field label="Seuil de validation" unit={sales.currency.label}>
                      <IntegerInput value={wf.approvalThreshold} onChange={(v) => setWorkflow({ approvalThreshold: v })} />
                    </Field>
                  </div>
                )}
              </div>
              <Switch checked={wf.steps[s.id]} label={s.label} onChange={(v) => setWorkflow({ steps: { ...wf.steps, [s.id]: v } })} />
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardTitle>Numérotation des documents</CardTitle>
          <p className="mt-1 text-[13px] text-muted">
            Repères : {"{CENTRE}"}, {"{AAAA}"}, {"{MM}"}, {"{JJ}"} et un compteur {"{N}"} ou {"{N:5}"} (sur 5 chiffres), remis à zéro chaque année par centre.
          </p>
          <div className="mt-4 space-y-4">
            {(
              [
                ["order", "Bon de commande"],
                ["dispatch", "Bon de livraison"],
                ["settlement", "Règlement grossiste"],
              ] as const
            ).map(([k, label]) => {
              const v = wf.numbering[k];
              const valid = /\{N(:\d+)?\}/.test(v);
              return (
                <Field key={k} label={label} hint={valid ? `Exemple : ${sample(v)}` : "Compteur manquant : ajoutez {N} ou {N:5}."}>
                  <input className={cn(inputCls, !valid && "border-alert")} value={v} onChange={(e) => setWorkflow({ numbering: { ...wf.numbering, [k]: e.target.value } })} />
                </Field>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardTitle>Stock et disponibilité</CardTitle>
          <div className="mt-4 space-y-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] text-muted">Commande supérieure au disponible</span>
              <Segmented
                label="Politique de reliquat"
                value={sales.stock.backorder}
                onChange={(v) => set((s) => ({ ...s, stock: { ...s.stock, backorder: v } }))}
                options={[
                  { value: "RELIQUAT", label: "Autoriser, avec reliquat" },
                  { value: "BLOQUER", label: "Bloquer" },
                ]}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Couverture de sécurité" unit="jours" hint="Plan de remplissage">
                <IntegerInput value={sales.stock.safetyDays} onChange={(v) => set((s) => ({ ...s, stock: { ...s.stock, safetyDays: v } }))} />
              </Field>
              <Field label="Production prise en compte" unit="jours" hint="Horizon du disponible à la vente">
                <IntegerInput value={sales.stock.atpHorizonDays} onChange={(v) => set((s) => ({ ...s, stock: { ...s.stock, atpHorizonDays: v } }))} />
              </Field>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle>Objectifs de service</CardTitle>
        <p className="mt-1 text-[13px] text-muted">Seuils des pastilles des tableaux de bord : dans l&apos;objectif, à surveiller, sous l&apos;objectif.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {(
            [
              ["fillRate", "Taux de service", "au moins"],
              ["otif", "Livré complet et à l'heure", "au moins"],
              ["mape", "Écart de prévision (MAPE)", "au plus"],
            ] as const
          ).map(([k, label, way]) => (
            <fieldset key={k} className="grid grid-cols-2 gap-2">
              <legend className="mb-1.5 text-[13px] text-muted">{label}</legend>
              {([0, 1] as const).map((i) => (
                <Field key={i} label={i === 0 ? `Objectif, ${way}` : "Alerte au-delà"} unit="%">
                  <NumberInput
                    value={sales.targets[k][i]}
                    onChange={(v) =>
                      set((s) => {
                        const pair = [...s.targets[k]] as [number, number];
                        pair[i] = Math.min(Math.max(v, 0), 100);
                        // Keep the pair ordered: the objective is always the stricter threshold.
                        if (k === "mape" ? pair[0] > pair[1] : pair[0] < pair[1]) pair[i === 0 ? 1 : 0] = pair[i];
                        return { ...s, targets: { ...s.targets, [k]: pair } };
                      })
                    }
                  />
                </Field>
              ))}
            </fieldset>
          ))}
          <Field label="Charge des lignes à surveiller au-delà de" unit="%">
            <IntegerInput value={sales.targets.capacityWarnPct} onChange={(v) => set((s) => ({ ...s, targets: { ...s.targets, capacityWarnPct: Math.min(v, 100) } }))} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardTitle>Motifs</CardTitle>
        <div className="mt-4 grid gap-6 lg:grid-cols-3">
          <ReasonList title="Reliquats" sub="Pourquoi une quantité n'a pas été servie." items={sales.reasons.reliquat} onChange={(v) => set((s) => ({ ...s, reasons: { ...s.reasons, reliquat: v } }))} />
          <ReasonList title="Écarts de comptage" sub="Justification d'un écart physique." items={sales.reasons.variance} onChange={(v) => set((s) => ({ ...s, reasons: { ...s.reasons, variance: v } }))} />
          <ReasonList title="Ajustements de stock" sub="Corrections datées après clôture." items={sales.reasons.adjustment} onChange={(v) => set((s) => ({ ...s, reasons: { ...s.reasons, adjustment: v } }))} />
        </div>
      </Card>
    </div>
  );
}

/* ---------------- Marques ---------------- */

export function BrandsCard() {
  const { sales, set, config } = useSalesConfig();
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Marques</CardTitle>
          <p className="mt-1 text-[13px] text-muted">Les bouteilles s&apos;échangent entre marques. Seules les vides de votre marque se remplissent ; les autres sont suivies par marque pour l&apos;état journalier.</p>
        </div>
        <Button
          size="sm"
          variant="soft"
          onClick={() => set((s) => ({ ...s, brands: [...s.brands, { id: `m${Date.now().toString(36)}`, name: "Nouvelle marque", own: false, deposit: {} }] }))}
        >
          <Plus className="size-4" />
          Ajouter une marque
        </Button>
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[720px] text-[14px]">
          <thead>
            <tr className="text-left text-[12px] text-muted">
              <th className="pb-2 font-medium">Marque</th>
              <th className="pb-2 font-medium">La vôtre</th>
              {config.bottleTypes.map((b) => (
                <th key={b.id} className="pb-2 font-medium">
                  Consigne {b.label}
                </th>
              ))}
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {sales.brands.map((br) => {
              const upd = (patch: Partial<typeof br>) => set((s) => ({ ...s, brands: s.brands.map((x) => (x.id === br.id ? { ...x, ...patch } : x)) }));
              return (
                <tr key={br.id} className="border-t border-line">
                  <td className="py-2 pr-2">
                    <input aria-label="Nom de la marque" className={inputCls} value={br.name} onChange={(e) => upd({ name: e.target.value })} />
                  </td>
                  <td className="py-2 pr-2">
                    <label className="flex h-10 items-center gap-2 text-[13px]">
                      <input
                        type="radio"
                        name="own-brand"
                        className="size-4 accent-[var(--b-800)]"
                        checked={br.own}
                        onChange={() => set((s) => ({ ...s, brands: s.brands.map((x) => ({ ...x, own: x.id === br.id })) }))}
                      />
                      <span className="sr-only">Marque de l&apos;entreprise</span>
                    </label>
                  </td>
                  {config.bottleTypes.map((b) => (
                    <td key={b.id} className="py-2 pr-2">
                      <IntegerInput ariaLabel={`Consigne ${b.label}, ${br.name}`} value={br.deposit[b.id] ?? 0} onChange={(v) => upd({ deposit: { ...br.deposit, [b.id]: v } })} />
                    </td>
                  ))}
                  <td className="py-2">
                    <RemoveBtn label={`Supprimer ${br.name}`} disabled={br.own || sales.brands.length <= 2} onClick={() => set((s) => ({ ...s, brands: s.brands.filter((x) => x.id !== br.id) }))} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] text-faint">Consignes en {sales.currency.label} par bouteille. Les vides de marque non identifiable sont comptées à part et jamais remplies.</p>
    </Card>
  );
}

/* ---------------- Consignation ---------------- */

export function ConsignmentPanel() {
  const { sales, set } = useSalesConfig();
  const c = sales.consignment;
  const setC = (patch: Partial<typeof c>) => set((s) => ({ ...s, consignment: { ...s.consignment, ...patch } }));
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardTitle>Suivi des grossistes</CardTitle>
        <p className="mt-1 text-[13px] text-muted">Le stock chez le grossiste reste à vous : il est valorisé, pas facturé. Chaque passage règle ce qui a été vendu.</p>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <Field label="Relance sans passage après" unit="jours" hint="Catégorie et contrat peuvent le remplacer">
            <IntegerInput value={c.inactivityDays} min={1} onChange={(v) => setC({ inactivityDays: v })} />
          </Field>
          <Field label="Comptage physique tous les" unit="jours">
            <IntegerInput value={c.countEveryDays} min={1} onChange={(v) => setC({ countEveryDays: v })} />
          </Field>
          <Field label="Tolérance d'écart au comptage" unit="%">
            <NumberInput value={c.varianceTolerancePct} onChange={(v) => setC({ varianceTolerancePct: Math.max(v, 0) })} />
          </Field>
        </div>
        <div className="mt-5 space-y-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-muted">Prix des ventes en consignation</span>
            <Segmented
              label="Prix des ventes en consignation"
              value={c.priceBasis}
              onChange={(v) => setC({ priceBasis: v })}
              options={[
                { value: "SETTLEMENT", label: "Au jour du règlement" },
                { value: "PLACEMENT", label: "Au jour de la mise en dépôt" },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-muted">Solde de bouteilles des clients</span>
            <Segmented
              label="Solde de bouteilles des clients"
              value={c.balanceBasis}
              onChange={(v) => setC({ balanceBasis: v })}
              options={[
                { value: "FORMAT", label: "Par format" },
                { value: "BRAND", label: "Par marque et format" },
              ]}
            />
            <span className="text-[12px] text-faint">Le stock physique et l&apos;état journalier restent toujours par marque.</span>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Relances sans passage</CardTitle>
        <p className="mt-1 text-[13px] text-muted">Jours écoulés depuis le dernier passage, pour un seuil de {c.inactivityDays} jours. Un seuil propre au grossiste décale toute l&apos;échelle.</p>
        <ul className="mt-4 space-y-2">
          {c.ladder.map((s, i) => (
            <li key={i} className="grid grid-cols-[110px_1fr_auto] items-end gap-3 rounded-2xl bg-board p-3">
              <Field label="Jour">
                <IntegerInput
                  value={s.day}
                  min={1}
                  onChange={(v) => setC({ ladder: c.ladder.map((x, j) => (j === i ? { ...x, day: v } : x)) })}
                />
              </Field>
              <Field label="Action">
                <Select ariaLabel="Action" value={s.action} onChange={(v) => setC({ ladder: c.ladder.map((x, j) => (j === i ? { ...x, action: v } : x)) })} options={Object.entries(LADDER).map(([value, label]) => ({ value: value as typeof s.action, label }))} />
              </Field>
              <RemoveBtn label="Retirer l'étape" disabled={c.ladder.length <= 1} onClick={() => setC({ ladder: c.ladder.filter((_, j) => j !== i) })} />
            </li>
          ))}
        </ul>
        {c.ladder.some((s, i) => i > 0 && s.day <= c.ladder[i - 1].day) && <p className="mt-2 text-[13px] text-alert">Jours non croissants : chaque étape doit venir après la précédente.</p>}
        <Button size="sm" variant="ghost" className="mt-3" onClick={() => setC({ ladder: [...c.ladder, { day: (c.ladder[c.ladder.length - 1]?.day ?? 0) + 3, action: "NOTIFIER" }] })}>
          <Plus className="size-4" />
          Ajouter une étape
        </Button>
      </Card>
    </div>
  );
}

/* ---------------- Rapports ---------------- */

function TemplateCard({ title, t, columns, onChange }: { title: string; t: ReportTemplate; columns: Record<string, { label: string }>; onChange: (t: ReportTemplate) => void }) {
  const unused = Object.keys(columns).filter((k) => !t.columns.includes(k));
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        {t.placeholder && <span className="rounded-md bg-warn/12 px-2 py-0.5 text-[12px] font-medium text-warn-ink">Modèle provisoire</span>}
      </div>
      <div className="mt-4 grid gap-4">
        <Field label="Titre">
          <input className={inputCls} value={t.title} onChange={(e) => onChange({ ...t, title: e.target.value })} />
        </Field>
        <Field label="En-tête du fichier" hint="Première ligne du fichier, laissez vide pour l'omettre">
          <input className={inputCls} value={t.header} onChange={(e) => onChange({ ...t, header: e.target.value })} />
        </Field>
        <div className="grid grid-cols-[1fr_100px] gap-4">
          <Field label="Nom du fichier" hint={`Exemple : ${fileName(t.filename, "RUF", new Date().toISOString().slice(0, 10))}`}>
            <input className={inputCls} value={t.filename} onChange={(e) => onChange({ ...t, filename: e.target.value })} />
          </Field>
          <Field label="Séparateur">
            <input className={inputCls} maxLength={1} value={t.separator} onChange={(e) => onChange({ ...t, separator: e.target.value || ";" })} />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[13px] text-muted">Colonnes, dans l&apos;ordre</legend>
          <ol className="flex flex-wrap gap-2">
            {t.columns.map((k, i) => (
              <li key={k} className="flex h-9 items-center gap-1 rounded-full bg-board pr-1 pl-3 text-[13px]">
                <span className="tnum text-faint">{i + 1}.</span> {columns[k]?.label ?? k}
                <button type="button" aria-label={`Retirer ${columns[k]?.label ?? k}`} disabled={t.columns.length <= 1} onClick={() => onChange({ ...t, columns: t.columns.filter((x) => x !== k) })} className="grid size-7 place-items-center rounded-full text-muted hover:bg-alert/10 hover:text-alert disabled:opacity-30">
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ol>
          {unused.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {unused.map((k) => (
                <button key={k} type="button" onClick={() => onChange({ ...t, columns: [...t.columns, k] })} className="flex h-8 items-center gap-1 rounded-full border border-dashed border-line px-3 text-[13px] text-muted hover:border-brand-600 hover:text-ink">
                  <Plus className="size-3.5" /> {columns[k].label}
                </button>
              ))}
            </div>
          )}
        </fieldset>
        <label className="flex items-start gap-3 rounded-2xl bg-board p-3 text-[13px]">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--b-800)]" checked={!t.placeholder} onChange={(e) => onChange({ ...t, placeholder: !e.target.checked })} />
          <span>Ce modèle suit la spécification officielle fournie. Tant que la case n&apos;est pas cochée, les fichiers portent la mention « modèle provisoire ».</span>
        </label>
      </div>
    </Card>
  );
}

export function ReportsPanel() {
  const { sales, set } = useSalesConfig();
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <TemplateCard title="État journalier des bouteilles (autorité)" t={sales.reports.authority} columns={AUTHORITY_COLUMNS} onChange={(t) => set((s) => ({ ...s, reports: { ...s.reports, authority: t } }))} />
      <TemplateCard title="Export des ventes vers Sage" t={sales.reports.sage} columns={SAGE_COLUMNS} onChange={(t) => set((s) => ({ ...s, reports: { ...s.reports, sage: t } }))} />
    </div>
  );
}

/* ---------------- Rôles ---------------- */

export function RolesPanel() {
  const { sales, set } = useSalesConfig();
  const { account } = useAuth();
  return (
    <div className="grid grid-cols-1 gap-4">
      <Card>
        <CardTitle>Comptes de démonstration</CardTitle>
        <p className="mt-1 text-[13px] text-muted">
          Prototype : connexion simulée, sans serveur. Chaque responsable ne voit que son module ; l&apos;administrateur voit tout. Mot de passe commun&nbsp;: «&nbsp;{DEMO_PASSWORD}&nbsp;».
        </p>
        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ACCOUNTS.map((a) => (
            <li key={a.id} className={cn("flex items-center gap-3 rounded-2xl border p-3", a.id === account?.id ? "border-brand-800 bg-brand-50" : "border-line")}>
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-full text-[13px] font-semibold", a.id === account?.id ? "bg-brand-800 text-white" : "bg-board text-ink")}>
                {a.name
                  .split(" ")
                  .map((p) => p[0])
                  .join("")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">
                  {a.name}, {a.title.toLowerCase()}
                </span>
                <span className="block truncate text-[12px] text-muted">
                  {a.email} · {a.admin ? "tous les modules" : a.modules.map((m) => moduleDef(m).label).join(", ")} · permissions : {sales.roles.find((r) => r.id === a.salesRole)?.label ?? a.salesRole}
                  {a.admin ? " (toutes)" : ""}
                </span>
              </span>
              {a.id === account?.id && <span className="text-[12px] font-medium text-brand-ink">Connecté</span>}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle>Permissions</CardTitle>
        <p className="mt-1 text-[13px] text-muted">Qui peut valider, forcer ou clôturer. Les autres actions sont ouvertes à tous les rôles.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th className="pb-2 font-medium">Action</th>
                {sales.roles.map((r) => (
                  <th key={r.id} className="pb-2 text-center font-medium">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ACTIONS.map((a) => (
                <tr key={a.id} className="border-t border-line">
                  <td className="py-2.5 pr-3">{a.label}</td>
                  {sales.roles.map((r) => {
                    const on = sales.permissions[a.id].includes(r.id);
                    return (
                      <td key={r.id} className="py-2.5 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${a.label} : ${r.label}`}
                          className="size-4 accent-[var(--b-800)]"
                          checked={on}
                          onChange={() => set((s) => ({ ...s, permissions: { ...s.permissions, [a.id]: on ? s.permissions[a.id].filter((x) => x !== r.id) : [...s.permissions[a.id], r.id] } }))}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
