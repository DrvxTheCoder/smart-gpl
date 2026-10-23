"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Dialog, Field, Switch, inputCls } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/format";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { saveCustomer, type CustomerInput } from "@/lib/sales/commands/customers";
import type { Customer } from "@/lib/sales/types";

/** Create or edit a customer. A new one starts with its category's contract terms. */
export function CustomerDialog({ open, onClose, customer }: { open: boolean; onClose: () => void; customer?: Customer }) {
  const { config, centreId } = useStore();
  const { exec, actor } = useSales();
  const router = useRouter();
  const blank = (): CustomerInput => ({
    name: "",
    categoryId: config.sales.categories[0]?.id ?? "",
    zone: "",
    contactName: "",
    phone: "",
    centreIds: [centreId === "all" ? config.centres[0].id : centreId],
    rep: actor,
    active: true,
  });
  const [f, setF] = useState<CustomerInput>(blank);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setF(
      customer
        ? { id: customer.id, name: customer.name, categoryId: customer.categoryId, zone: customer.zone, contactName: customer.contact.name, phone: customer.contact.phone, centreIds: customer.centreIds, rep: customer.rep, active: customer.active }
        : blank(),
    );
    // Reset only when the dialog opens; later centre or role changes must not wipe a draft.
  }, [open, customer]);

  const set = (patch: Partial<CustomerInput>) => setF((x) => ({ ...x, ...patch }));
  const submit = () => {
    const r = exec((env) => saveCustomer(env, f));
    if (!r.ok) return setError(r.error);
    onClose();
    if (r.goTo) router.push(r.goTo);
  };

  return (
    <Dialog open={open} onClose={onClose} title={customer ? "Modifier la fiche client" : "Nouveau client"} width="max-w-xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Field label="Raison sociale" className="sm:col-span-2">
          <input className={inputCls} value={f.name} autoFocus onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Catégorie" hint={customer ? "Le contrat en cours garde ses conditions" : "Donne les conditions du premier contrat"}>
          <Select ariaLabel="Catégorie" value={f.categoryId} onChange={(v) => set({ categoryId: v })} options={config.sales.categories.map((c) => ({ value: c.id, label: c.label }))} />
        </Field>
        <Field label="Zone">
          <input className={inputCls} value={f.zone} placeholder="Ex. Pikine" onChange={(e) => set({ zone: e.target.value })} />
        </Field>
        <Field label="Contact">
          <input className={inputCls} value={f.contactName} onChange={(e) => set({ contactName: e.target.value })} />
        </Field>
        <Field label="Téléphone">
          <input className={inputCls} inputMode="tel" value={f.phone} placeholder="77 000 00 00" onChange={(e) => set({ phone: e.target.value })} />
        </Field>
        <Field label="Commercial">
          <input className={inputCls} value={f.rep} onChange={(e) => set({ rep: e.target.value })} />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-[13px] text-muted">Centres</legend>
          <div className="flex flex-wrap gap-2">
            {config.centres.map((c) => {
              const on = f.centreIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ centreIds: on ? f.centreIds.filter((x) => x !== c.id) : [...f.centreIds, c.id] })}
                  className={cn("h-10 rounded-full border px-3.5 text-[13px] transition-colors", on ? "border-brand-800 bg-brand-800 text-white" : "border-line bg-field hover:border-brand-600")}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </fieldset>
        {customer && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-board p-3 sm:col-span-2">
            <span className="text-[14px]">Client actif</span>
            <Switch checked={f.active} label="Client actif" onChange={(v) => set({ active: v })} />
          </div>
        )}
        {error && <p className="rounded-2xl border border-alert/40 bg-alert/6 p-3 text-[14px] text-alert sm:col-span-2">{error}</p>}
        <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit">{customer ? "Enregistrer" : "Créer le client"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
