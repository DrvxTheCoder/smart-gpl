"use client";

import { useState } from "react";
import { Check } from "@/components/ui/icons";
import { Button, Field, Stepper, inputCls } from "@/components/ui/primitives";
import { cn, fmt } from "@/lib/format";
import type { Brand, BrandGrid, Confirmation } from "@/lib/sales/types";
import { UNKNOWN_BRAND } from "@/lib/sales/types";
import type { BottleType } from "@/lib/types";

/**
 * Two-party (or one-party) confirmation: each person enters a name and a
 * personal code. The proof is a field of the Confirmation record, so a
 * drawn signature can replace the code later without touching callers.
 */
export function ConfirmCount({ parties, value, onConfirm, disabled }: { parties: { role: string; name?: string }[]; value: Confirmation[]; onConfirm: (c: Omit<Confirmation, "at">) => boolean; disabled?: boolean }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {parties.map((p) => (
        <Party key={p.role} role={p.role} suggested={p.name ?? ""} done={value.find((c) => c.role === p.role)} onConfirm={onConfirm} disabled={disabled} />
      ))}
    </ul>
  );
}

function Party({ role, suggested, done, onConfirm, disabled }: { role: string; suggested: string; done?: Confirmation; onConfirm: (c: Omit<Confirmation, "at">) => boolean; disabled?: boolean }) {
  const [name, setName] = useState(suggested);
  const [code, setCode] = useState("");
  if (done)
    return (
      <li className="flex items-center gap-3 rounded-2xl bg-ok/8 p-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ok text-white">
          <Check className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-[12px] text-muted">{role}</span>
          <span className="block truncate text-[15px] font-medium">{done.name}</span>
          <span className="tnum block text-[12px] text-muted">Confirmé à {new Date(done.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
        </span>
      </li>
    );
  return (
    <li className="rounded-2xl border border-line p-3">
      <p className="text-[13px] font-medium">{role}</p>
      <form
        className="mt-2 grid grid-cols-[minmax(0,1fr)_96px] gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (onConfirm({ role, name, code })) setCode("");
        }}
      >
        <Field label="Nom">
          <input className={cn(inputCls, "h-11")} value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Code">
          <input className={cn(inputCls, "h-11")} type="password" inputMode="numeric" autoComplete="off" value={code} disabled={disabled} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Button type="submit" variant="soft" className="col-span-2" disabled={disabled || !name.trim() || !code.trim()}>
          Confirmer
        </Button>
      </form>
    </li>
  );
}

/**
 * Bottle counts by brand × format, with steppers: one block per brand so a
 * thumb reaches every field on a phone. Totals per format underneath.
 */
export function CountGrid({ brands, formats, value, onChange, disabled, withUnknown = true }: { brands: Brand[]; formats: BottleType[]; value: BrandGrid; onChange: (g: BrandGrid) => void; disabled?: boolean; withUnknown?: boolean }) {
  const rows = [...brands.map((b) => ({ id: b.id, name: b.name, own: b.own })), ...(withUnknown ? [{ id: UNKNOWN_BRAND, name: "Marque non identifiée", own: false }] : [])];
  const set = (b: string, f: string, n: number) => onChange({ ...value, [b]: { ...value[b], [f]: n } });
  const total = (f: string) => rows.reduce((a, r) => a + (value[r.id]?.[f] ?? 0), 0);
  return (
    // Sized on its own width (container queries): it lives in pages and in narrow dialog columns.
    <div className="@container space-y-3">
      {rows.map((r) => (
        <fieldset key={r.id} className={cn("rounded-2xl p-3", r.own ? "bg-brand-50 ring-1 ring-brand-200" : "bg-board")}>
          <legend className="sr-only">{r.name}</legend>
          <p className="mb-2 flex items-center gap-2 text-[14px] font-medium" aria-hidden>
            {r.name}
            {r.own && <span className="rounded-md bg-brand-800 px-1.5 py-0.5 text-[11px] font-medium text-white">Votre marque</span>}
          </p>
          <div className="grid grid-cols-1 gap-x-4 gap-y-2 @lg:grid-cols-2 @4xl:grid-cols-3">
            {formats.map((f) => (
              <div key={f.id} className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-2">
                <span className="text-[14px] font-semibold">{f.label}</span>
                <Stepper ariaLabel={`${r.name}, ${f.label}`} value={value[r.id]?.[f.id] ?? 0} step={f.kg >= 30 ? 1 : 10} disabled={disabled} onChange={(n) => set(r.id, f.id, n)} />
              </div>
            ))}
          </div>
        </fieldset>
      ))}
      <dl className="tnum flex flex-wrap gap-x-5 gap-y-1 px-1 text-[13px]">
        {formats.map((f) => (
          <div key={f.id} className="flex gap-1.5">
            <dt className="text-muted">{f.label}</dt>
            <dd className="font-semibold">{fmt(total(f.id))}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
