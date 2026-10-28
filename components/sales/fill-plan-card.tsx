"use client";

import { Card, CardTitle } from "@/components/ui/primitives";
import { Meter, TonePill } from "@/components/sales/ui";
import { cn, fmt } from "@/lib/format";
import type { FillPlan } from "@/lib/sales/fill-plan";

const TONE_TEXT = { ok: "Faisable", warn: "À surveiller", alert: "À arbitrer" } as const;

/** The coming week's fill plan: bottles to fill per format, own empties, line load. */
export function FillPlanCard({ title, plan }: { title: string; plan: FillPlan }) {
  const load = Number.isFinite(plan.loadPct) ? plan.loadPct : 100;
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
          <p className="mt-0.5 text-[13px] text-muted">6 jours ouvrés : prévision restante + reliquats − pleins libres + couverture. Vides : en stock + retours attendus de votre marque.</p>
        </div>
        <TonePill tone={plan.tone}>{TONE_TEXT[plan.tone]}</TonePill>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[300px] text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-muted">
              <th className="pb-2 font-medium">Format</th>
              <th className="pb-2 text-right font-medium">À remplir</th>
              <th className="pb-2 text-right font-medium" title="En stock, plus les retours attendus de votre marque">Vides propres</th>
              <th className="pb-2 text-right font-medium">Tonnes</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((r) => (
              <tr key={r.formatId} className="border-t border-line">
                <td className="py-2 pr-2 font-medium">{r.label}</td>
                <td className="tnum py-2 text-right">{fmt(r.needed)}</td>
                <td className={cn("tnum py-2 text-right", r.emptiesShort > 0 && "font-semibold text-alert")}>
                  {fmt(r.ownEmpties)}
                  <span className="text-faint"> +{fmt(r.incoming)}</span>
                </td>
                <td className="tnum py-2 text-right">{fmt(r.tonnes, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4">
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="text-muted">Charge des lignes</span>
          <span className="tnum font-medium">
            {fmt(plan.totalT, 0)} T sur {fmt(plan.capacityT, 0)} T
          </span>
        </div>
        <div className="mt-1.5">
          <Meter pct={load} tone={plan.loadPct > 100 ? "alert" : plan.tone === "warn" ? "warn" : undefined} label={`Charge des lignes, ${fmt(load)} %`} />
        </div>
      </div>
      {plan.reasons.length > 0 && (
        <ul className={cn("mt-4 space-y-1 rounded-2xl px-3 py-2 text-[13px]", plan.tone === "alert" ? "bg-alert/8 text-alert" : "bg-warn/12 text-warn-ink")}>
          {plan.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
