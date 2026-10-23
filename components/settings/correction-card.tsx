"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Download, FileUp, Pencil, Trash2 } from "@/components/ui/icons";
import { Button, Card, CardTitle, Dialog, Field, NumberInput, Segmented, Switch, inputCls } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { fmt } from "@/lib/format";
import { editProfile, parseCorrectionCsv, tableRange, toCorrectionCsv, uniqueProfileId, validateTable } from "@/lib/correction";
import type { CorrectionConfig, CorrectionProfile, CorrectionRow, GasMethod, LiquidMethod, OutOfRangePolicy, StockBasis, TenantConfig } from "@/lib/types";
import type { NoticeKind } from "@/lib/store";
import { downloadText, takeFile } from "./files";

type SetConfig = (fn: (c: TenantConfig) => TenantConfig) => void;
type Patch = Partial<Omit<CorrectionProfile, "id" | "version">>;

/** A CSV picked for import, already parsed and checked. */
interface PendingCsv {
  fileName: string;
  rows: CorrectionRow[];
  errors: string[]; // "Ligne N : …", against the file's own line numbers
}

const LIQUID_METHODS: { value: LiquidMethod["method"]; label: string }[] = [
  { value: "ADDITIVE_TABLE", label: "Table additive" },
  { value: "LINEAR", label: "Linéaire" },
];
const GAS_METHODS: { value: GasMethod["method"]; label: string }[] = [
  { value: "COEFFICIENT_TABLE", label: "Table de coefficients" },
  { value: "IDEAL_GAS", label: "Gaz parfait" },
];
const RANGE_POLICIES: { value: OutOfRangePolicy; label: string }[] = [
  { value: "WARN", label: "Avertir" },
  { value: "BLOCK", label: "Bloquer" },
];
const STOCK_BASES: { value: StockBasis; label: string }[] = [
  { value: "LIQUID", label: "Liquide" },
  { value: "TOTAL", label: "Liquide + gaz" },
];

export function CorrectionCard({ config, setConfig, toast }: { config: TenantConfig; setConfig: SetConfig; toast: (m: string, kind?: NoticeKind) => void }) {
  const { profiles, defaultProfileId } = config.correction;
  const [selId, setSelId] = useState(defaultProfileId);
  const p = profiles.find((x) => x.id === selId) ?? profiles.find((x) => x.id === defaultProfileId) ?? profiles[0];
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState<PendingCsv | null>(null);
  const [meta, setMeta] = useState({ name: "", product: "", source: "" });
  const csvRef = useRef<HTMLInputElement>(null);

  const setCorrection = (fn: (c: CorrectionConfig) => CorrectionConfig) => setConfig((cfg) => ({ ...cfg, correction: fn(cfg.correction) }));
  const update = (patch: Patch) => setCorrection((c) => ({ ...c, profiles: c.profiles.map((x) => (x.id === p.id ? editProfile(x, patch) : x)) }));
  const addProfile = (np: CorrectionProfile) => {
    setCorrection((c) => ({ ...c, profiles: [...c.profiles, np] }));
    setSelId(np.id);
  };

  const range = tableRange(p.rows);
  const usedBy = config.centres.flatMap((c) => c.reservoirs.filter((r) => r.profileId === p.id).map((r) => `${r.name} (${c.code})`));

  const setLiquid = (m: LiquidMethod["method"]) => {
    if (m === p.liquid.method) return;
    if (m === "ADDITIVE_TABLE" && !p.rows.length) return toast("Table requise", "warning");
    update({ liquid: m === "LINEAR" ? { method: "LINEAR", alpha: 0.002 } : { method: "ADDITIVE_TABLE" } });
  };
  const setGas = (m: GasMethod["method"]) => {
    if (m === p.gas.method) return;
    if (m === "COEFFICIENT_TABLE" && !p.rows.length) return toast("Table requise", "warning");
    update({ gas: m === "IDEAL_GAS" ? { method: "IDEAL_GAS", molarMassKgMol: 0.0581 } : { method: "COEFFICIENT_TABLE", pressureOffsetBar: 1 } });
  };

  const onCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = await takeFile(e);
    if (!f) return;
    const parsed = parseCorrectionCsv(f.text);
    const errors = parsed.errors.map((x) => `Ligne ${x.line} : ${x.message}`);
    if (!parsed.errors.length) for (const t of validateTable(parsed.rows)) errors.push(`${t.row ? `Ligne ${parsed.lineOf[t.row - 1]}` : "Table"} : ${t.message}`);
    setPending({ fileName: f.name, rows: parsed.rows, errors });
    setMeta({ name: f.name.replace(/\.[^.]+$/, ""), product: p.product, source: "" });
  };

  const importAs = (mode: "new" | "replace") => {
    if (!pending || pending.errors.length) return;
    const product = meta.product.trim();
    const source = meta.source.trim();
    if (mode === "replace") {
      update({ rows: pending.rows, product, source });
      toast(`Table remplacée · ${pending.rows.length} lignes`, "success");
    } else {
      const name = meta.name.trim() || "Table importée";
      addProfile({
        id: uniqueProfileId(name, profiles.map((x) => x.id)),
        name,
        version: 1,
        product,
        source,
        liquid: { method: "ADDITIVE_TABLE" },
        gas: { method: "COEFFICIENT_TABLE", pressureOffsetBar: 1 },
        rows: pending.rows,
        outOfRange: "WARN",
        stockBasis: "LIQUID",
      });
      toast("Profil créé", "success");
    }
    setPending(null);
  };

  const remove = () => {
    setConfig((cfg) => {
      const rest = cfg.correction.profiles.filter((x) => x.id !== p.id);
      return {
        ...cfg,
        correction: { profiles: rest, defaultProfileId: cfg.correction.defaultProfileId === p.id ? rest[0].id : cfg.correction.defaultProfileId },
        centres: cfg.centres.map((c) => ({ ...c, reservoirs: c.reservoirs.map((r) => (r.profileId === p.id ? { ...r, profileId: undefined } : r)) })),
      };
    });
    setDeleting(false);
    toast("Profil supprimé", "success");
  };

  const pendingRange = pending && !pending.errors.length ? tableRange(pending.rows) : null;

  return (
    <Card className="xl:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <CardTitle>Correction de température</CardTitle>
          <p className="mt-1 text-[13px] text-muted">
            Densité ambiante du liquide et masse du gaz dans chaque réservoir. Un inventaire clôturé garde les facteurs utilisés : modifier un profil ne change pas l&apos;historique.
          </p>
        </div>
        <Field label="Profil par défaut" className="w-full sm:w-80">
          <Select
            ariaLabel="Profil par défaut"
            value={defaultProfileId}
            onChange={(v) => setCorrection((c) => ({ ...c, defaultProfileId: v }))}
            options={profiles.map((x) => ({ value: x.id, label: x.name }))}
          />
        </Field>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Profil affiché"
          value={p.id}
          onChange={setSelId}
          options={profiles.map((x) => ({ value: x.id, label: x.id === defaultProfileId ? `${x.name} · par défaut` : x.name }))}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setRenaming(p.name)}>
            <Pencil className="size-4" />
            Renommer
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const name = `${p.name} (copie)`;
              addProfile({ ...structuredClone(p), id: uniqueProfileId(name, profiles.map((x) => x.id)), name, version: 1 });
              toast("Profil créé", "success");
            }}
          >
            <Copy className="size-4" />
            Dupliquer
          </Button>
          <Button size="sm" variant="ghost" disabled={profiles.length <= 1} onClick={() => setDeleting(true)}>
            <Trash2 className="size-4" />
            Supprimer
          </Button>
        </div>
      </div>
      <p className="mt-2 text-[12px] text-faint">
        Version {p.version}. {usedBy.length ? `Choisi pour : ${usedBy.join(", ")}.` : p.id === defaultProfileId ? "Utilisé par tous les réservoirs sans table propre." : "Utilisé par aucun réservoir."}
      </p>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        {/* Methods */}
        <div className="flex flex-col gap-5">
          <div>
            <h3 className="text-[15px] font-medium">Liquide</h3>
            <p className="text-[13px] text-muted">
              {p.liquid.method === "ADDITIVE_TABLE" ? "Densité ambiante = d15 − correction lue dans la table." : "Densité ambiante = d15 × (1 − α × (t − 15))."}
            </p>
            <Segmented className="mt-2" label="Méthode liquide" value={p.liquid.method} onChange={setLiquid} options={LIQUID_METHODS} />
            {p.liquid.method === "LINEAR" && (
              <Field label="Coefficient α" unit="par °C" className="mt-3 max-w-[200px]">
                <CommitNumber ariaLabel="Coefficient alpha" step={0.0001} value={p.liquid.alpha} valid={(v) => v > 0 && v < 0.01} onCommit={(alpha) => update({ liquid: { method: "LINEAR", alpha } })} onInvalid={() => toast("α hors limites", "error")} />
              </Field>
            )}
          </div>

          <div>
            <h3 className="text-[15px] font-medium">Gaz</h3>
            <p className="text-[13px] text-muted">
              {p.gas.method === "COEFFICIENT_TABLE"
                ? "Masse = volume gazeux × coefficient lu dans la table × (pression + décalage)."
                : "Masse = volume gazeux × densité du gaz parfait à 1 bar × pression absolue."}
            </p>
            <Segmented className="mt-2" label="Méthode gaz" value={p.gas.method} onChange={setGas} options={GAS_METHODS} />
            {p.gas.method === "COEFFICIENT_TABLE" ? (
              <Field label="Décalage de pression" unit="bar" className="mt-3 max-w-[200px]">
                <CommitNumber ariaLabel="Décalage de pression" value={p.gas.pressureOffsetBar} valid={(v) => v >= 0 && v <= 2} onCommit={(pressureOffsetBar) => update({ gas: { method: "COEFFICIENT_TABLE", pressureOffsetBar } })} onInvalid={() => toast("Décalage hors limites", "error")} />
              </Field>
            ) : (
              <Field label="Masse molaire" unit="kg/mol" className="mt-3 max-w-[200px]">
                <CommitNumber ariaLabel="Masse molaire" step={0.0001} value={p.gas.molarMassKgMol} valid={(v) => v > 0 && v < 1} onCommit={(molarMassKgMol) => update({ gas: { method: "IDEAL_GAS", molarMassKgMol } })} onInvalid={() => toast("Masse molaire hors limites", "error")} />
              </Field>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[13px] text-muted">Hors table</p>
              <Segmented label="Hors table" value={p.outOfRange} onChange={(v) => v !== p.outOfRange && update({ outOfRange: v })} options={RANGE_POLICIES} />
              <p className="mt-1.5 text-[12px] text-faint">
                {p.outOfRange === "WARN" ? "Ligne limite utilisée, avertissement affiché, clôture à confirmer." : "Pas de résultat pour le réservoir, clôture impossible."}
              </p>
            </div>
            <div>
              <p className="mb-1.5 text-[13px] text-muted">Stock physique</p>
              <Segmented label="Stock physique" value={p.stockBasis} onChange={(v) => v !== p.stockBasis && update({ stockBasis: v })} options={STOCK_BASES} />
              <p className="mt-1.5 text-[12px] text-faint">Base de l&apos;écart avec le stock théorique.</p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-[15px] font-medium">Plage de densité à 15 °C</h3>
                <p className="text-[13px] text-muted">Une mesure hors plage est signalée.</p>
              </div>
              <Switch label="Limiter la plage de densité" checked={!!p.d15Range} onChange={(on) => update({ d15Range: on ? [0.55, 0.6] : undefined })} />
            </div>
            {p.d15Range && (
              <div className="mt-3 grid max-w-[420px] grid-cols-2 gap-3">
                <Field label="De">
                  <CommitNumber ariaLabel="Densité minimale" step={0.001} value={p.d15Range[0]} valid={(v) => v > 0 && v < (p.d15Range?.[1] ?? 1)} onCommit={(v) => update({ d15Range: [v, p.d15Range?.[1] ?? v] })} onInvalid={() => toast("Minimum invalide", "error")} />
                </Field>
                <Field label="À">
                  <CommitNumber ariaLabel="Densité maximale" step={0.001} value={p.d15Range[1]} valid={(v) => v > (p.d15Range?.[0] ?? 0) && v < 1} onCommit={(v) => update({ d15Range: [p.d15Range?.[0] ?? v, v] })} onInvalid={() => toast("Maximum invalide", "error")} />
                </Field>
              </div>
            )}
          </div>
        </div>

        {/* Table preview, read-only */}
        <div className="rounded-2xl bg-board p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[15px] font-medium">Table</h3>
            <div className="flex gap-2">
              <Button size="sm" variant="soft" onClick={() => csvRef.current?.click()}>
                <FileUp className="size-4" />
                Importer un CSV
              </Button>
              <Button size="sm" variant="ghost" disabled={!p.rows.length} onClick={() => downloadText(`${p.id}.csv`, toCorrectionCsv(p.rows), "text/csv")}>
                <Download className="size-4" />
                Exporter en CSV
              </Button>
              <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onCsv} />
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
            <dt className="text-muted">Produit</dt>
            <dd>{p.product || "—"}</dd>
            <dt className="text-muted">Source</dt>
            <dd className="break-words">{p.source || "—"}</dd>
            <dt className="text-muted">Plage</dt>
            <dd className="tnum">{range ? `${fmt(range[0], 1)} à ${fmt(range[1], 1)} °C` : "Aucune table"}</dd>
            <dt className="text-muted">Lignes</dt>
            <dd className="tnum">{p.rows.length}</dd>
          </dl>
          {p.rows.length > 0 ? (
            <div className="scroll-area mt-3 max-h-64 overflow-y-auto rounded-xl border border-line bg-field">
              <table className="tnum w-full text-[13px]">
                <thead className="sticky top-0 bg-field text-left text-[12px] text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">°C</th>
                    <th className="px-3 py-2 text-right font-medium">Correction liquide</th>
                    <th className="px-3 py-2 text-right font-medium">Coefficient gaz</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={r.t} className="border-t border-line">
                      <td className="px-3 py-1">{fmt(r.t, 1)}</td>
                      <td className="px-3 py-1 text-right">{fmt(r.liquid, 4)}</td>
                      <td className="px-3 py-1 text-right">{fmt(r.gas, 6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 rounded-xl border border-dashed border-line p-4 text-[13px] text-muted">
              Ce profil n&apos;a pas de table : il utilise des méthodes de calcul. Importez un CSV pour passer aux méthodes par table.
            </p>
          )}
          <p className="mt-3 text-[12px] text-faint">CSV : colonnes temperature,liquid_correction,gas_coefficient, point décimal, pas de 0,1 °C.</p>
        </div>
      </div>

      <Dialog open={renaming !== null} onClose={() => setRenaming(null)} title="Renommer le profil">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = (renaming ?? "").trim();
            if (name && name !== p.name) update({ name });
            setRenaming(null);
          }}
        >
          <Field label="Nom du profil">
            <input className={inputCls} value={renaming ?? ""} onChange={(e) => setRenaming(e.target.value)} autoFocus />
          </Field>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>
              Annuler
            </Button>
            <Button type="submit" disabled={!renaming?.trim()}>
              Renommer
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={deleting} onClose={() => setDeleting(false)} title={`Supprimer « ${p.name} » ?`}>
        <p className="text-[14px] text-muted">
          {usedBy.length ? `${usedBy.join(", ")} repasseront sur le profil par défaut. ` : ""}
          {p.id === defaultProfileId ? `« ${profiles.find((x) => x.id !== p.id)?.name} » deviendra le profil par défaut. ` : ""}
          Les inventaires clôturés gardent leurs valeurs.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(false)}>
            Annuler
          </Button>
          <Button variant="danger" onClick={remove}>
            Supprimer
          </Button>
        </div>
      </Dialog>

      <Dialog open={pending !== null} onClose={() => setPending(null)} title="Importer une table" width="max-w-xl">
        {pending && pending.errors.length > 0 && (
          <>
            <p className="text-[14px] text-muted">
              <b className="text-ink">{pending.fileName}</b> : import refusé, {pending.errors.length} erreur{pending.errors.length > 1 ? "s" : ""}. Corrigez le fichier puis importez-le de nouveau.
            </p>
            <ul className="scroll-area mt-4 max-h-64 space-y-1 overflow-y-auto rounded-2xl border border-alert/40 bg-alert/6 p-3 text-[13px] text-alert">
              {pending.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            <div className="mt-6 flex justify-end">
              <Button variant="ghost" onClick={() => setPending(null)}>
                Fermer
              </Button>
            </div>
          </>
        )}
        {pending && pending.errors.length === 0 && (
          <>
            <p className="rounded-2xl bg-ok/8 p-3 text-[14px] text-ok">
              {pending.fileName} : {pending.rows.length} lignes{pendingRange ? `, de ${fmt(pendingRange[0], 1)} à ${fmt(pendingRange[1], 1)} °C` : ""}. Aucune erreur.
            </p>
            <div className="mt-4 grid gap-3">
              <Field label="Nom du nouveau profil">
                <input className={inputCls} value={meta.name} onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))} />
              </Field>
              <Field label="Produit">
                <input className={inputCls} value={meta.product} onChange={(e) => setMeta((m) => ({ ...m, product: e.target.value }))} />
              </Field>
              <Field label="Source" hint="Référence normative exacte de la table. Obligatoire.">
                <input className={inputCls} value={meta.source} placeholder="Norme, édition, numéro du tableau" onChange={(e) => setMeta((m) => ({ ...m, source: e.target.value }))} />
              </Field>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={!meta.source.trim()} onClick={() => importAs("replace")}>
                Remplacer la table de « {p.name} »
              </Button>
              <Button disabled={!meta.source.trim()} onClick={() => importAs("new")}>
                Créer le profil
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </Card>
  );
}

/* A NumberInput that commits on blur, so one edit is one profile version. */
function CommitNumber({
  value,
  onCommit,
  valid,
  onInvalid,
  step,
  ariaLabel,
}: {
  value: number;
  onCommit: (v: number) => void;
  valid: (v: number) => boolean;
  onInvalid: () => void;
  step?: number;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div
      onBlur={() => {
        if (draft === value) return;
        if (valid(draft)) onCommit(draft);
        else {
          setDraft(value);
          onInvalid();
        }
      }}
    >
      <NumberInput ariaLabel={ariaLabel} step={step} value={draft} onChange={setDraft} />
    </div>
  );
}
