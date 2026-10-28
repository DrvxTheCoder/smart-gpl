"use client";

import Link from "next/link";
import { Suspense, useMemo } from "react";
import { ChevronLeft, ChevronRight, Plus, Search } from "@/components/ui/icons";
import { Button, Card, CardTitle, inputCls } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { CustomerDialog } from "@/components/sales/customer-dialog";
import { Meter, TonePill } from "@/components/sales/ui";
import { useQuery, useQueryText } from "@/components/sales/use-query";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { customerPosition, customersIn } from "@/lib/sales/selectors";
import { termLabel } from "@/lib/sales/labels";
import { cn, fmt, fmtMoney, fmtMoneyShort } from "@/lib/format";

const PAGE = 12;

function Inner() {
  const { config, centreId, centre } = useStore();
  const { data, ledger, today, own } = useSales();
  const [query, setQuery] = useQuery({ q: "", cat: "all", page: "1", nouveau: "" });
  const [q, setQ] = useQueryText(query.q, (v) => setQuery({ q: v, page: "1" }));
  const cur = config.sales.currency.label;

  const rows = useMemo(
    () => customersIn(data.customers, centreId).map((c) => customerPosition({ cfg: config, data, ledger, today, own }, c)),
    [data, ledger, centreId, config, today, own],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows
      .filter((p) => query.cat === "all" || p.customer.categoryId === query.cat)
      .filter((p) => !term || [p.customer.name, p.customer.code, p.customer.zone, p.customer.contact.name, p.customer.rep].join(" ").toLowerCase().includes(term))
      .sort((a, b) => Number(b.customer.active) - Number(a.customer.active) || a.customer.name.localeCompare(b.customer.name));
  }, [rows, q, query.cat]);

  const pages = Math.max(Math.ceil(filtered.length / PAGE), 1);
  const page = Math.min(Math.max(Number(query.page) || 1, 1), pages) - 1;
  const slice = filtered.slice(page * PAGE, page * PAGE + PAGE);

  const totals = useMemo(() => {
    const t = { total: 0, notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, ok: 0, warn: 0, alert: 0 };
    for (const p of rows) {
      t.total += p.ageing.total;
      t.notDue += p.ageing.notDue;
      t.d1_30 += p.ageing.d1_30;
      t.d31_60 += p.ageing.d31_60;
      t.d61_90 += p.ageing.d61_90;
      t.d90 += p.ageing.d90;
      t[p.solvency.tone]++;
    }
    return t;
  }, [rows]);

  const buckets = [
    { label: "Non échu", v: totals.notDue, cls: "bg-brand-600" },
    { label: "1 à 30 j", v: totals.d1_30, cls: "bg-warn/70" },
    { label: "31 à 60 j", v: totals.d31_60, cls: "bg-warn" },
    { label: "61 à 90 j", v: totals.d61_90, cls: "bg-alert/75" },
    { label: "Plus de 90 j", v: totals.d90, cls: "bg-alert" },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-semibold tracking-[-0.03em] sm:text-[40px]">Clients</h1>
          <p className="mt-1 text-[15px] text-muted">Contrats, encours et solvabilité, {centreId === "all" ? "tous les centres" : centre(centreId).name}.</p>
        </div>
        <Button onClick={() => setQuery({ nouveau: "1" })}>
          <Plus className="size-4" />
          Nouveau client
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex w-full max-w-xl flex-wrap gap-2 sm:flex-nowrap">
              <div className="relative w-full">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, code, zone, contact" aria-label="Filtrer les clients" className={cn(inputCls, "pl-9")} />
              </div>
              <Select
                className="sm:w-[230px] sm:shrink-0"
                ariaLabel="Catégorie"
                value={query.cat}
                onChange={(v) => setQuery({ cat: v, page: "1" })}
                options={[{ value: "all", label: "Toutes les catégories" }, ...config.sales.categories.map((c) => ({ value: c.id, label: c.label }))]}
              />
            </div>
            <p className="tnum text-[13px] text-muted">
              <b className="font-semibold text-ink">{filtered.length}</b> client{filtered.length > 1 ? "s" : ""}
            </p>
          </div>

          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-[14px]">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th className="py-2.5 pr-3 font-medium">Client</th>
                  <th className="py-2.5 pr-3 font-medium">Encours / plafond</th>
                  <th className="py-2.5 pr-3 font-medium">Solvabilité</th>
                  <th className="py-2.5 font-medium">
                    <span className="sr-only">Ouvrir</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {slice.map((p) => {
                  const util = p.terms.creditLimit ? (p.exposure.total / p.terms.creditLimit) * 100 : 0;
                  return (
                    <tr key={p.customer.id} className={cn("group border-b border-line last:border-0", !p.customer.active && "opacity-60")}>
                      <td className="py-3 pr-3">
                        <p className="font-medium">{p.customer.name}</p>
                        <p className="text-[12px] text-muted">
                          {p.customer.code}, {p.category?.label ?? "sans catégorie"}, {termLabel(p.terms.payment).toLowerCase()}
                          {!p.customer.active && ", inactif"}
                        </p>
                      </td>
                      <td className="w-60 py-3 pr-3">
                        <p className="tnum text-[13px] whitespace-nowrap">
                          {fmtMoneyShort(p.exposure.total, "")} <span className="text-muted">/ {fmtMoneyShort(p.terms.creditLimit, cur)}</span>
                        </p>
                        <div className="mt-1.5">
                          <Meter pct={util} tone={util > 100 ? "alert" : util > 85 ? "warn" : undefined} label={`Utilisation du plafond, ${fmt(util)} %`} />
                        </div>
                        {p.ageing.overdue > 0 && (
                          <p className={cn("tnum mt-1 text-[12px]", p.ageing.maxDaysLate > (p.category?.credit.overdueDays ?? 0) ? "text-alert" : "text-warn")}>
                            {fmtMoneyShort(p.ageing.overdue, cur)} échus, jusqu&apos;à {p.ageing.maxDaysLate} j
                          </p>
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        <TonePill tone={p.solvency.tone}>
                          {p.solvency.label} · {p.solvency.score}
                        </TonePill>
                      </td>
                      <td className="py-3 text-right">
                        <Link
                          href={`/ventes/clients/${p.customer.id}`}
                          className="inline-flex h-8 items-center rounded-full border border-line px-3 text-[13px] font-medium group-hover:border-brand-800 group-hover:bg-brand-50"
                          aria-label={`Voir la fiche de ${p.customer.name}`}
                        >
                          Voir
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {slice.length === 0 && (
              <p className="py-10 text-center text-muted">
                {rows.length ? "Aucun client ne correspond. Essayez un code comme « CL-004 » ou une zone." : "Aucun client pour ce centre. Créez le premier avec « Nouveau client »."}
              </p>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="tnum text-[13px] text-muted">
              Page {page + 1} sur {pages}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setQuery({ page: String(page) })} aria-label="Page précédente">
                <ChevronLeft className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setQuery({ page: String(page + 2) })} aria-label="Page suivante">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Créances clients</CardTitle>
            <p className="mt-1 text-[13px] text-muted">Ce qui reste à encaisser, par ancienneté de l&apos;échéance.</p>
            <p className="tnum mt-4 text-[26px] font-semibold tracking-[-0.02em]">
              {fmtMoneyShort(totals.total, "")}
              <span className="text-[14px] font-medium text-muted"> {cur}</span>
            </p>
            <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-line" aria-hidden>
              {buckets.map((b) => (
                <span key={b.label} className={b.cls} style={{ flex: b.v }} />
              ))}
            </div>
            <dl className="tnum mt-4 space-y-2 text-[13px]">
              {buckets.map((b) => (
                <div key={b.label} className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-2 text-muted">
                    <span className={cn("size-2.5 rounded-full", b.cls)} aria-hidden />
                    {b.label}
                  </dt>
                  <dd className="font-medium" title={fmtMoney(b.v, cur)}>
                    {fmtMoneyShort(b.v, cur)}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardTitle>Solvabilité</CardTitle>
            <dl className="mt-4 grid grid-cols-3 gap-3">
              {(["ok", "warn", "alert"] as const).map((t) => (
                <div key={t}>
                  <dt>
                    <TonePill tone={t}>{t === "ok" ? "Solvables" : t === "warn" ? "À surveiller" : "À justifier"}</TonePill>
                  </dt>
                  <dd className="tnum mt-2 text-[26px] font-semibold tracking-[-0.02em]">{totals[t]}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[12px] text-faint">Note par règles, détaillée sur chaque fiche. Seuils dans Paramètres, Clients et contrats.</p>
          </Card>
        </div>
      </div>

      <CustomerDialog open={query.nouveau === "1"} onClose={() => setQuery({ nouveau: "" })} />
    </div>
  );
}

export default function ClientsPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
