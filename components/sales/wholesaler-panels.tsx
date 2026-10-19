"use client";

import { useMemo, useState } from "react";
import { FileText, Plus } from "@/components/ui/icons";
import { Button, Dialog, Field, IntegerInput, inputCls } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/calendar";
import { Badge, Meter, TonePill, type BadgeTone } from "@/components/sales/ui";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { countFloat, issueStatement, logCall, logDeclaration } from "@/lib/sales/commands/consignment";
import { wholesalerStatuses } from "@/lib/sales/alerts";
import { clientSite, gridTotal } from "@/lib/sales/bottle-ledger";
import { contractAt } from "@/lib/sales/contracts";
import { passagesOf, sellOut, variance } from "@/lib/sales/consignment";
import { daysBetween, dayOf, shiftDate } from "@/lib/sales/dates";
import { CALL_OUTCOME, LADDER } from "@/lib/sales/labels";
import { cap, cn, fmt, fmtDate, fmtMoney } from "@/lib/format";
import type { CallOutcome } from "@/lib/sales/types";

/** The float held at the wholesaler, how fast it turns, and what the follow-up says. */
export function FloatPanel({ customerId }: { customerId: string }) {
  const { config } = useStore();
  const { data, ledger, today, own, exec } = useSales();
  const site = clientSite(customerId);
  const terms = contractAt(data.contracts, customerId, today)?.terms;
  const status = wholesalerStatuses({ cfg: config, data, ledger, today, own, centreId: "all" }).find((w) => w.customer.id === customerId);
  const held = useMemo(() => {
    const out: Record<string, number> = {};
    for (const m of ledger) if (m.site === site && m.state === "PLEIN" && m.brand === own) out[m.formatId] = (out[m.formatId] ?? 0) + m.qty;
    return out;
  }, [ledger, site, own]);
  const from = shiftDate(today, -28);
  const out = sellOut(data.settlements, customerId, from, today);
  const sellIn = useMemo(() => {
    const r: Record<string, number> = {};
    for (const m of ledger) if (m.site === site && m.kind === "PLACEMENT" && dayOf(m.ts) >= from) r[m.formatId] = (r[m.formatId] ?? 0) + m.qty;
    return r;
  }, [ledger, site, from]);
  const lastCount = data.counts.filter((k) => k.site === site).sort((a, b) => b.ts.localeCompare(a.ts))[0];
  const countDue = lastCount ? daysBetween(dayOf(lastCount.ts), today) >= config.sales.consignment.countEveryDays : true;
  const unbilled = data.settlements.filter((s) => s.customerId === customerId && s.status === "CONFIRME" && !s.statementId);
  const formats = config.bottleTypes.filter((b) => (held[b.id] ?? 0) || (terms?.floatCap[b.id] ?? 0) || out[b.id]);
  const total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const cur = config.sales.currency.label;

  return (
    <div className="space-y-6">
      {status && (
        <div className={cn("flex flex-wrap items-center gap-3 rounded-2xl p-4", status.step ? (status.step.action === "BLOQUER" ? "bg-alert/8" : "bg-warn/10") : "bg-board")}>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium">{status.daysSince == null ? "Aucun passage enregistré" : `${status.daysSince} jour${status.daysSince > 1 ? "s" : ""} depuis le dernier passage`}</p>
            <p className="text-[13px] text-muted">
              Relance à {status.threshold} j{terms?.inactivityDays ? " (propre au contrat)" : ""}
              {status.typical ? `, rythme habituel ${fmt(status.typical)} j` : ""}
              {status.lastCall
                ? `. Dernier appel le ${fmtDate(dayOf(status.lastCall.ts), { day: "numeric", month: "short" })} : ${status.lastCall.promised ? `passage promis le ${fmtDate(status.lastCall.promised, { day: "numeric", month: "short" })}` : CALL_OUTCOME[status.lastCall.outcome].toLowerCase()}`
                : ""}
              .
            </p>
          </div>
          {status.step ? <TonePill tone={status.step.action === "BLOQUER" ? "alert" : "warn"}>{LADDER[status.step.action]}</TonePill> : status.lateForThem ? <TonePill tone="warn">Plus tard que d&apos;habitude</TonePill> : <TonePill tone="ok">Dans son rythme</TonePill>}
        </div>
      )}

      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[560px] text-[14px]">
          <thead>
            <tr className="text-left text-[12px] text-muted">
              <th className="pb-2 font-medium">Format</th>
              <th className="pb-2 pl-3 font-medium">Pleins en dépôt / plafond</th>
              <th className="pb-2 pl-3 text-right font-medium">Vendus 28 j</th>
              <th className="pb-2 pl-3 text-right font-medium">Remis 28 j</th>
              <th className="pb-2 pl-3 text-right font-medium">Jours de stock</th>
            </tr>
          </thead>
          <tbody>
            {formats.map((b) => {
              const h = held[b.id] ?? 0;
              const c = terms?.floatCap[b.id] ?? 0;
              const daily = (out[b.id] ?? 0) / 28;
              return (
                <tr key={b.id} className="border-t border-line">
                  <td className="py-2.5 font-medium">{b.label}</td>
                  <td className="w-56 py-2.5 pl-3">
                    <p className="tnum text-[13px]">
                      {fmt(h)} {c ? <span className="text-muted">/ {fmt(c)}</span> : null}
                    </p>
                    {c > 0 && (
                      <div className="mt-1">
                        <Meter pct={(h / c) * 100} tone={h > c ? "alert" : undefined} label={`Dépôt ${b.label}, ${fmt((h / c) * 100)} % du plafond`} />
                      </div>
                    )}
                  </td>
                  <td className="tnum py-2.5 pl-3 text-right">{fmt(out[b.id] ?? 0)}</td>
                  <td className="tnum py-2.5 pl-3 text-right">{fmt(sellIn[b.id] ?? 0)}</td>
                  <td className="tnum py-2.5 pl-3 text-right">{daily ? fmt(h / daily, 1) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-2xl bg-board p-4 sm:grid-cols-4">
        <div>
          <dt className="text-[12px] text-muted">Rotation sur 28 jours</dt>
          <dd className="tnum text-[20px] font-semibold">{total(held) ? `${fmt(total(out) / total(held), 1)} fois` : "—"}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-muted">Vente / remise</dt>
          <dd className="tnum text-[20px] font-semibold">{total(sellIn) ? `${fmt((total(out) / total(sellIn)) * 100)} %` : "—"}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-muted">Dernier comptage</dt>
          <dd className="text-[15px] font-medium">{lastCount ? fmtDate(dayOf(lastCount.ts), { day: "numeric", month: "short" }) : "Jamais"}</dd>
          {countDue && <dd className="text-[12px] text-warn">Comptage à faire</dd>}
        </div>
        <div>
          <dt className="text-[12px] text-muted">Passages non facturés</dt>
          <dd className="tnum text-[20px] font-semibold">{terms?.invoicing === "RELEVE_PERIODIQUE" ? unbilled.length : "—"}</dd>
        </div>
      </dl>
      <p className="text-[12px] text-faint">La vente au client final (sell-out) reflète la demande mieux que les commandes : elle alimente la mesure des prévisions.</p>
      {terms?.invoicing === "RELEVE_PERIODIQUE" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line p-4">
          <p className="text-[14px]">
            Facturation par relevé : {unbilled.length} passage{unbilled.length > 1 ? "s" : ""} à facturer, {fmtMoney(unbilled.reduce((a, s) => a + s.amount, 0), cur)}.
          </p>
          <Button variant="soft" size="sm" disabled={!unbilled.length} onClick={() => exec((e) => issueStatement(e, customerId))}>
            <FileText className="size-4" />
            Émettre le relevé
          </Button>
        </div>
      )}
    </div>
  );
}

export function PassagesPanel({ customerId }: { customerId: string }) {
  const { config } = useStore();
  const { data } = useSales();
  const list = passagesOf(data.settlements, customerId).reverse();
  const label = (f: string) => config.bottleTypes.find((b) => b.id === f)?.label ?? f;
  if (!list.length) return <p className="py-8 text-center text-muted">Aucun passage. Le premier règle les ventes depuis la mise en dépôt.</p>;
  return (
    <ul className="divide-y divide-line">
      {list.slice(0, 40).map((s) => {
        const competitor = gridTotal(s.empties) - gridTotal({ x: s.empties[config.sales.brands.find((b) => b.own)?.id ?? ""] ?? {} });
        return (
          <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium">
                {s.number} · {cap(fmtDate(dayOf(s.ts), { weekday: "short", day: "numeric", month: "short" }))}
              </span>
              <span className="tnum block text-[12px] text-muted">
                Vendu :{" "}
                {Object.entries(s.sold)
                  .filter(([, n]) => n)
                  .map(([f, n]) => `${label(f)} ${fmt(n)}`)
                  .join(", ")}
                {competitor ? ` · ${fmt(competitor)} vides d'autres marques` : ""}
              </span>
            </span>
            <span className="tnum text-right text-[14px]">
              {fmtMoney(s.amount, config.sales.currency.label)}
              <span className={cn("block text-[12px]", s.paid ? "text-ok" : "text-muted")}>{s.paid ? `Encaissé ${fmt(s.paid.amount)}` : s.statementId ? "Sur relevé" : "À facturer au relevé"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function CountsPanel({ customerId }: { customerId: string }) {
  const { config } = useStore();
  const { data, ledger, own, exec, can } = useSales();
  const site = clientSite(customerId);
  const expected = useMemo(() => {
    const out: Record<string, number> = {};
    for (const m of ledger) if (m.site === site && m.state === "PLEIN" && m.brand === own) out[m.formatId] = (out[m.formatId] ?? 0) + m.qty;
    return out;
  }, [ledger, site, own]);
  const [counted, setCounted] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const formats = config.bottleTypes.filter((b) => expected[b.id]);
  const v = variance({ [own]: counted }, { [own]: expected }, config.sales.consignment.varianceTolerancePct);
  const any = Object.values(counted).some((n) => n > 0);
  const history = data.counts.filter((k) => k.site === site).sort((a, b) => b.ts.localeCompare(a.ts));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <p className="text-[14px] text-muted">Le commercial compte les pleins présents chez le grossiste. Un manque est une démarque (perte, vol, bouteilles non rendues), revue avec son motif.</p>
          <div className="mt-3 divide-y divide-line">
            {formats.map((b) => (
              <div key={b.id} className="grid grid-cols-[60px_minmax(0,1fr)_auto] items-center gap-3 py-2">
                <span className="text-[14px] font-semibold">{b.label}</span>
                <IntegerInput ariaLabel={`Compté ${b.label}`} value={counted[b.id] ?? 0} onChange={(n) => setCounted({ ...counted, [b.id]: n })} className="h-11" />
                <span className="tnum text-[12px] text-muted">attendu {fmt(expected[b.id] ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3 rounded-2xl bg-board p-4 lg:self-start">
          <p className="text-[13px] text-muted">Démarque constatée</p>
          <p className={cn("tnum text-[26px] font-semibold", any && !v.withinTolerance && "text-alert")}>{any ? fmt(v.shrinkage) : "—"}</p>
          {any && <TonePill tone={v.withinTolerance ? "ok" : "alert"}>{v.withinTolerance ? "Dans la tolérance" : `À justifier, ${fmt(v.pct, 1)} %`}</TonePill>}
          {any && !v.withinTolerance && (
            <Field label="Motif">
              <Select ariaLabel="Motif de l'écart" value={reason} placeholder="Choisir" onChange={setReason} options={config.sales.reasons.variance.map((r) => ({ value: r.code, label: r.label }))} />
            </Field>
          )}
          <Field label="Remarque">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Facultatif" />
          </Field>
          <Button
            className="w-full"
            disabled={!any}
            onClick={() => {
              const r = exec((e) => countFloat(e, customerId, counted, reason || null, note));
              if (r.ok) {
                setCounted({});
                setReason("");
                setNote("");
              }
            }}
          >
            Enregistrer le comptage
          </Button>
        </div>
      </div>
      <div>
        <h3 className="text-[15px] font-medium">Historique</h3>
        {history.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">Aucun comptage. Fréquence prévue : tous les {config.sales.consignment.countEveryDays} jours.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {history.map((k) => {
              const kv = variance(k.counted, k.expected, config.sales.consignment.varianceTolerancePct);
              return (
                <li key={k.id} className="flex items-center gap-3 py-2.5 text-[14px]">
                  <span className="min-w-0 flex-1">
                    {cap(fmtDate(dayOf(k.ts), { weekday: "short", day: "numeric", month: "short" }))}, {k.by}
                    <span className="tnum block text-[12px] text-muted">
                      {fmt(gridTotal(k.counted))} comptés, {fmt(gridTotal(k.expected))} attendus{kv.shrinkage ? `, ${fmt(kv.shrinkage)} manquants` : ""}
                      {k.reason ? `, ${config.sales.reasons.variance.find((r) => r.code === k.reason)?.label.toLowerCase() ?? k.reason}` : ""}
                    </span>
                  </span>
                  <TonePill tone={k.status === "VALIDE" ? "ok" : k.status === "A_VALIDER" ? "warn" : "alert"}>{k.status === "VALIDE" ? "Validé" : k.status === "A_VALIDER" ? (can("variance.approve") ? "À valider" : "En attente") : "Refusé"}</TonePill>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[12px] text-faint">Les écarts se valident dans Stock et bouteilles, onglet Comptage, comme ceux du magasin.</p>
      </div>
    </div>
  );
}

const OUTCOME_TONE: Record<CallOutcome, BadgeTone> = { JOINT: "ok", INJOIGNABLE: "alert", RAPPELER: "pending", PASSAGE_PROMIS: "brand" };

/**
 * Calls to a wholesaler and what they declare having sold. Each side reads
 * the same way: what it is, one action to log an entry, then the history.
 */
export function CallsPanel({ customerId }: { customerId: string }) {
  const { config } = useStore();
  const { data } = useSales();
  const [modal, setModal] = useState<"call" | "declaration" | null>(null);
  const calls = data.calls.filter((c) => c.customerId === customerId).sort((a, b) => b.ts.localeCompare(a.ts));
  const decls = data.declarations.filter((c) => c.customerId === customerId).sort((a, b) => b.ts.localeCompare(a.ts));
  const label = (f: string) => config.bottleTypes.find((b) => b.id === f)?.label ?? f;
  const when = (ts: string) => new Date(ts).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    // Sized on the card's width, not the screen's: the tab lives beside the credit card.
    <div className="@container">
    <div className="grid grid-cols-1 gap-x-8 gap-y-8 @3xl:grid-cols-2">
      <section className="min-w-0" aria-labelledby="calls-title">
        <PanelHead id="calls-title" title="Journal des appels" sub="Chaque appel de relance et ce qui en est sorti." action="Noter un appel" onAction={() => setModal("call")} />
        {calls.length === 0 ? (
          <EmptyNote>Aucun appel noté. Notez chaque relance et son résultat : la dernière apparaît dans le suivi des passages.</EmptyNote>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {calls.map((c) => (
              <li key={c.id} className="flex items-start gap-3 py-3">
                <Badge tone={OUTCOME_TONE[c.outcome]} className="mt-0.5">
                  {CALL_OUTCOME[c.outcome]}
                </Badge>
                <div className="min-w-0 flex-1 text-[14px]">
                  {c.promised && <p className="font-medium">Passage promis le {fmtDate(c.promised, { weekday: "short", day: "numeric", month: "short" })}</p>}
                  {c.note && <p className={c.promised ? "text-muted" : undefined}>{c.note}</p>}
                  <p className="tnum text-[12px] text-muted">
                    {when(c.ts)}, {c.by}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="min-w-0" aria-labelledby="decl-title">
        <PanelHead id="decl-title" title="Déclarations du grossiste" sub="Ce qu'il annonce avoir vendu. Simple recoupement : seul le comptage des vides au passage est facturé." action="Noter une déclaration" onAction={() => setModal("declaration")} />
        {decls.length === 0 ? (
          <EmptyNote>Aucune déclaration. Quand le grossiste annonce ses ventes au téléphone, notez-les pour les comparer au prochain comptage.</EmptyNote>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {decls.map((d) => {
              const lines = Object.entries(d.sold).filter(([, n]) => n);
              const total = lines.reduce((a, [, n]) => a + n, 0);
              return (
                <li key={d.id} className="py-3">
                  <div className="flex items-baseline justify-between gap-3 text-[14px]">
                    <span className="font-medium">{cap(fmtDate(dayOf(d.ts), { weekday: "short", day: "numeric", month: "short" }))}</span>
                    <span className="tnum text-[13px] text-muted">{fmt(total)} bouteilles</span>
                  </div>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Quantités déclarées">
                    {lines.map(([f, n]) => (
                      <li key={f} className="tnum inline-flex h-6 items-center gap-1 rounded-md bg-board px-2 text-[12px]">
                        <span className="font-semibold">{label(f)}</span> {fmt(n)}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[12px] text-muted">
                    {d.by}
                    {d.note ? ` : ${d.note}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <CallDialog open={modal === "call"} onClose={() => setModal(null)} customerId={customerId} />
      <DeclarationDialog open={modal === "declaration"} onClose={() => setModal(null)} customerId={customerId} />
    </div>
    </div>
  );
}

function PanelHead({ id, title, sub, action, onAction }: { id: string; title: string; sub: string; action: string; onAction: () => void }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1 basis-56">
        <h3 id={id} className="text-[15px] font-medium">
          {title}
        </h3>
        <p className="mt-0.5 text-[13px] text-muted">{sub}</p>
      </div>
      <Button size="sm" variant="soft" className="h-10 shrink-0" onClick={onAction}>
        <Plus className="size-4" />
        {action}
      </Button>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 rounded-2xl border border-dashed border-line p-4 text-[13px] text-muted">{children}</p>;
}

function CallDialog({ open, onClose, customerId }: { open: boolean; onClose: () => void; customerId: string }) {
  const { exec, today } = useSales();
  const [outcome, setOutcome] = useState<CallOutcome>("JOINT");
  const [promised, setPromised] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const close = () => {
    setOutcome("JOINT");
    setPromised(null);
    setNote("");
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title="Noter un appel">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (exec((env) => logCall(env, { customerId, outcome, promised, note })).ok) close();
        }}
      >
        <fieldset>
          <legend className="mb-1.5 text-[13px] text-muted">Résultat</legend>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(CALL_OUTCOME) as CallOutcome[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={outcome === k}
                onClick={() => setOutcome(k)}
                className={cn(
                  "h-11 rounded-xl px-3 text-[14px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:outline-none",
                  outcome === k ? "bg-brand-800 text-white" : "bg-board text-ink ring-1 ring-line hover:bg-brand-50",
                )}
              >
                {CALL_OUTCOME[k]}
              </button>
            ))}
          </div>
        </fieldset>
        {outcome === "PASSAGE_PROMIS" && (
          <Field label="Passage promis le">
            <DatePicker ariaLabel="Date de passage promise" value={promised} min={today} onChange={setPromised} />
          </Field>
        )}
        <Field label="Note">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ce qui a été dit" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={close}>
            Annuler
          </Button>
          <Button type="submit">Noter l&apos;appel</Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeclarationDialog({ open, onClose, customerId }: { open: boolean; onClose: () => void; customerId: string }) {
  const { config } = useStore();
  const { exec } = useSales();
  const [declared, setDeclared] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const formats = config.bottleTypes.filter((b) => b.kg < 30);
  const total = Object.values(declared).reduce((a, n) => a + n, 0);
  const close = () => {
    setDeclared({});
    setNote("");
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title="Noter une déclaration">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (exec((env) => logDeclaration(env, { customerId, sold: declared, note })).ok) close();
        }}
      >
        <p className="text-[13px] text-muted">Bouteilles que le grossiste annonce avoir vendues depuis son dernier passage.</p>
        <div className="grid grid-cols-2 gap-3">
          {formats.map((b) => (
            <Field key={b.id} label={b.label}>
              <IntegerInput ariaLabel={`Déclaré ${b.label}`} value={declared[b.id] ?? 0} onChange={(n) => setDeclared({ ...declared, [b.id]: n })} />
            </Field>
          ))}
        </div>
        <Field label="Note">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Facultatif" />
        </Field>
        <div className="flex items-center justify-end gap-2 pt-2">
          <span className="tnum mr-auto text-[13px] text-muted">{fmt(total)} bouteilles</span>
          <Button type="button" variant="ghost" onClick={close}>
            Annuler
          </Button>
          <Button type="submit" disabled={total === 0}>
            Noter
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
