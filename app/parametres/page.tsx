"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Cylinder, Factory, Palette, Plus, RotateCcw, SlidersHorizontal, Trash2, ArrowLeftRight, Container, Monitor, Download, FileUp, Users, Workflow, Store, FileText, ShieldUser } from "@/components/ui/icons";
import { useStore, type Density } from "@/lib/store";
import { cn, fmt } from "@/lib/format";
import type { Centre, FlowField, TankType, TenantConfig } from "@/lib/types";
import { Button, Card, CardTitle, Dialog, Field, NumberInput, glide, inputCls, useIndicator } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { Logo, PRODUCT } from "@/components/shell/app-shell";
import { CorrectionCard } from "@/components/settings/correction-card";
import { downloadText, takeFile } from "@/components/settings/files";
import { exportTenantJson, parseTenantJson } from "@/lib/tenant-io";
import { useSales } from "@/lib/sales/store";
import { useAuth } from "@/lib/auth";
import { canSeeSetting } from "@/lib/settings-access";
import { BrandsCard, ConsignmentPanel, CustomersPanel, ReportsPanel, RolesPanel, WorkflowPanel } from "@/components/settings/sales-settings";

type Tab = "marque" | "centres" | "reservoirs" | "flux" | "bouteilles" | "regles" | "clients" | "ventes" | "consignation" | "rapports" | "roles" | "affichage";
const TABS: { id: Tab; label: string; icon: typeof Palette; sub: string }[] = [
  { id: "marque", label: "Entreprise et marque", icon: Palette, sub: "Nom, couleur, en-têtes de rapports" },
  { id: "centres", label: "Centres et lignes", icon: Factory, sub: "Sites, responsables, capacités" },
  { id: "reservoirs", label: "Réservoirs", icon: Container, sub: "Sphères, cigares, capacités" },
  { id: "flux", label: "Entrées et sorties", icon: ArrowLeftRight, sub: "Champs propres à chaque centre" },
  { id: "bouteilles", label: "Marques et bouteilles", icon: Cylinder, sub: "Formats, poids, marques, consignes" },
  { id: "regles", label: "Règles de calcul", icon: SlidersHorizontal, sub: "Seuils, arrêts, correction" },
  { id: "clients", label: "Clients et contrats", icon: Users, sub: "Catégories, tarifs, solvabilité" },
  { id: "ventes", label: "Ventes et flux", icon: Workflow, sub: "Étapes, numérotation, motifs" },
  { id: "consignation", label: "Consignation", icon: Store, sub: "Grossistes, relances, comptages" },
  { id: "rapports", label: "Rapports", icon: FileText, sub: "État journalier, export Sage" },
  { id: "roles", label: "Rôles", icon: ShieldUser, sub: "Comptes et permissions" },
  { id: "affichage", label: "Affichage", icon: Monitor, sub: "Largeur de l'interface" },
];


const PRESETS = [
  { name: "Forêt", hex: "#17603b" },
  { name: "Océan", hex: "#1f4fa8" },
  { name: "Pétrole", hex: "#0f5f66" },
  { name: "Prune", hex: "#6a3fb0" },
  { name: "Braise", hex: "#b1491d" },
  { name: "Ardoise", hex: "#36424f" },
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || `champ-${Date.now()}`;

function Inner() {
  const { config, setConfig, resetConfig, toast, centre } = useStore();
  const { resetSales } = useSales();
  const { account } = useAuth();
  const tabs = TABS.filter((t) => canSeeSetting(account, t.id));
  const params = useSearchParams();
  const router = useRouter();
  const [picked, setTab] = useState<Tab>((params.get("tab") as Tab) || tabs[0].id);
  const tab = tabs.some((t) => t.id === picked) ? picked : tabs[0].id;
  const [cid, setCid] = useState(config.centres[0].id);
  const [template, setTemplate] = useState<{ name: string; config: TenantConfig | null; errors: string[] } | null>(null);
  const templateRef = useRef<HTMLInputElement>(null);
  const navRef = useRef<HTMLUListElement>(null);
  const navPill = useIndicator(navRef, '[aria-current="page"]', [tab]);
  const centresRef = useRef<HTMLDivElement>(null);
  const centrePill = useIndicator(centresRef, '[aria-pressed="true"]', [cid, tab, config.centres.length]);
  useEffect(() => {
    const t = params.get("tab") as Tab | null;
    if (t && TABS.some((x) => x.id === t)) setTab(t);
  }, [params]);

  const c = centre(cid);
  const setCentre = (fn: (c: Centre) => Centre) => setConfig((cfg) => ({ ...cfg, centres: cfg.centres.map((x) => (x.id === cid ? fn(x) : x)) }));
  const go = (t: Tab) => {
    setTab(t);
    router.replace(`/parametres?tab=${t}`, { scroll: false });
  };

  const CentrePicker = (
    <div ref={centresRef} className="relative flex flex-wrap gap-2" role="group" aria-label="Centre">
      <span
        aria-hidden
        className={cn("absolute top-0 left-0 rounded-full bg-brand-800", centrePill.ready && glide)}
        style={{ transform: `translate(${centrePill.x}px, ${centrePill.y}px)`, width: centrePill.w, height: centrePill.h }}
      />
      {config.centres.map((x) => (
        <button
          key={x.id}
          type="button"
          aria-pressed={x.id === cid}
          onClick={() => setCid(x.id)}
          className={cn(
            "relative h-9 rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-300",
            x.id === cid ? "border-transparent text-white" : "border-line bg-white hover:border-brand-600",
          )}
        >
          {x.name}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-semibold tracking-[-0.03em] sm:text-[40px]">Paramètres</h1>
          <p className="mt-1 text-[15px] text-muted">Adaptez {PRODUCT} aux installations et aux habitudes de {config.branding.companyName}.</p>
        </div>
        {account?.admin && (
          <div className="flex flex-wrap gap-2.5">
            <Button variant="ghost" onClick={() => downloadText(`modele-${slug(config.branding.companyName)}.json`, exportTenantJson(config), "application/json")}>
              <Download className="size-4" />
              Exporter le modèle
            </Button>
            <Button variant="ghost" onClick={() => templateRef.current?.click()}>
              <FileUp className="size-4" />
              Importer un modèle
            </Button>
            <input
              ref={templateRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={async (e) => {
                const f = await takeFile(e);
                if (!f) return;
                const parsed = parseTenantJson(f.text);
                setTemplate({ name: f.name, config: parsed.value, errors: parsed.errors });
              }}
            />
            <Button
              variant="ghost"
              onClick={() => {
                resetConfig();
                resetSales();
                toast("Démo restaurée", "success");
              }}
            >
              <RotateCcw className="size-4" />
              Restaurer la démo
            </Button>
          </div>
        )}
      </div>

      <Dialog open={template !== null} onClose={() => setTemplate(null)} title={template?.config ? "Appliquer ce modèle ?" : "Modèle refusé"} width="max-w-xl">
        {template?.config ? (
          <>
            <p className="text-[14px] text-muted">
              <b className="text-ink">{template.name}</b> remplace toute la configuration : {template.config.branding.companyName}, {template.config.centres.length} centre
              {template.config.centres.length > 1 ? "s" : ""}, {template.config.correction.profiles.length} profil{template.config.correction.profiles.length > 1 ? "s" : ""} de correction,{" "}
              {template.config.sales.categories.length} catégorie{template.config.sales.categories.length > 1 ? "s" : ""} de clients. Les inventaires et les documents de vente validés gardent leurs valeurs.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setTemplate(null)}>
                Annuler
              </Button>
              <Button
                onClick={() => {
                  const next = template.config;
                  if (next) {
                    setConfig(() => next);
                    setCid(next.centres[0].id);
                    toast("Modèle appliqué", "success");
                  }
                  setTemplate(null);
                }}
              >
                Appliquer
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[14px] text-muted">
              <b className="text-ink">{template?.name}</b> n&apos;a pas été appliqué. Rien n&apos;a changé.
            </p>
            <ul className="scroll-area mt-4 max-h-64 space-y-1 overflow-y-auto rounded-2xl border border-alert/40 bg-alert/6 p-3 text-[13px] text-alert">
              {template?.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            <div className="mt-6 flex justify-end">
              <Button variant="ghost" onClick={() => setTemplate(null)}>
                Fermer
              </Button>
            </div>
          </>
        )}
      </Dialog>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="h-fit min-w-0 p-2.5 lg:sticky lg:top-27">
          <nav aria-label="Sections des paramètres">
            <ul ref={navRef} className="no-scrollbar relative flex gap-1 overflow-x-auto lg:flex-col">
              <li
                aria-hidden
                className={cn("pointer-events-none absolute top-0 left-0 rounded-2xl bg-brand-800 cursor-pointer", navPill.ready && glide)}
                style={{ transform: `translate(${navPill.x}px, ${navPill.y}px)`, width: navPill.w, height: navPill.h }}
              />
              {tabs.map(({ id, label, sub, icon: Icon }) => (
                <li key={id} className="shrink-0 ">
                  <button
                    type="button"
                    aria-current={tab === id ? "page" : undefined}
                    onClick={() => go(id)}
                    className={cn("relative flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-colors duration-300", tab === id ? "text-white" : "hover:bg-board")}
                  >
                    <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg transition-colors duration-300", tab === id ? "bg-white/15" : "bg-board")}>
                      <Icon className="size-4.5" />
                    </span>
                    <span>
                      <span className="block text-[14px] font-medium">{label}</span>
                      {/* <span className={cn("hidden text-[12px] transition-colors duration-300 lg:block", tab === id ? "text-white/70" : "text-muted")}>{sub}</span> */}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </Card>

        {/* On desktop a long section scrolls inside its own column, so the
            section list stays beside it. `relative` makes it the containing
            block of absolute children (sr-only labels…): otherwise they are
            not clipped by it and stretch the page below the shell. */}
        <div key={tab} className="panel-in scroll-area relative min-w-0 lg:-mr-2.5 lg:max-h-[calc(100dvh-140px)] lg:overflow-y-auto lg:[scrollbar-gutter:stable]">
          {tab === "marque" && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
              <Card>
                <CardTitle>Entreprise</CardTitle>
                <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_140px]">
                  <Field label="Raison sociale">
                    <input className={inputCls} value={config.branding.companyName} onChange={(e) => setConfig((cfg) => ({ ...cfg, branding: { ...cfg.branding, companyName: e.target.value } }))} />
                  </Field>
                  <Field label="Sigle" hint="2 à 3 lettres">
                    <input
                      className={inputCls}
                      maxLength={3}
                      value={config.branding.shortName}
                      onChange={(e) => setConfig((cfg) => ({ ...cfg, branding: { ...cfg.branding, shortName: e.target.value.toUpperCase() } }))}
                    />
                  </Field>
                </div>

                <h3 className="mt-8 text-[15px] font-medium">Couleur de marque</h3>
                <p className="text-[13px] text-muted">Une seule couleur suffit : toutes les nuances de l&apos;interface et des rapports en découlent.</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {PRESETS.map((p) => {
                    const on = config.branding.brand.toLowerCase() === p.hex;
                    return (
                      <button
                        key={p.hex}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setConfig((cfg) => ({ ...cfg, branding: { ...cfg.branding, brand: p.hex } }))}
                        className={cn("flex items-center gap-2 rounded-full border py-1.5 pr-3.5 pl-1.5 text-[13px] transition-colors", on ? "border-ink" : "border-line hover:border-faint")}
                      >
                        <span className="size-7 rounded-full" style={{ background: p.hex }} />
                        {p.name}
                      </button>
                    );
                  })}
                  <label className="flex items-center gap-2 rounded-full border border-line py-1.5 pr-3.5 pl-1.5 text-[13px]">
                    <input
                      type="color"
                      value={config.branding.brand}
                      onChange={(e) => setConfig((cfg) => ({ ...cfg, branding: { ...cfg.branding, brand: e.target.value } }))}
                      className="size-7 cursor-pointer rounded-full border-0 bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
                      aria-label="Couleur personnalisée"
                    />
                    <span className="tnum uppercase">{config.branding.brand}</span>
                  </label>
                </div>
              </Card>

              <Card>
                <CardTitle>Aperçu de l&apos;en-tête de rapport</CardTitle>
                <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-white">
                  <div className="flex items-center gap-3 border-b-4 border-brand-800 p-4">
                    <span className="grid size-11 place-items-center rounded-xl bg-brand-800 text-[15px] font-bold text-white">{config.branding.shortName || "—"}</span>
                    <div>
                      <p className="text-[14px] font-semibold">{config.branding.companyName}</p>
                      <p className="text-[11px] text-muted">Fiche d&apos;inventaire de production journalière</p>
                    </div>
                  </div>
                  <div className="space-y-2 p-4">
                    {[0.9, 0.7, 0.8].map((w, k) => (
                      <div key={k} className="flex gap-2">
                        <span className="h-2 rounded-full bg-brand-100" style={{ width: `${w * 60}%` }} />
                        <span className="h-2 flex-1 rounded-full bg-board" />
                      </div>
                    ))}
                    <div className="mt-3 flex gap-2">
                      <span className="rounded-md bg-brand-800 px-2 py-1 text-[10px] font-semibold text-white">Stock théorique</span>
                      <span className="rounded-md bg-brand-100 px-2 py-1 text-[10px] font-semibold text-brand-950">Stock physique</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-[12px] text-muted">
                  <Logo className="size-4" /> Propulsé par {PRODUCT}, mention discrète en pied de page.
                </div>
              </Card>
            </div>
          )}

          {tab === "centres" && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                {CentrePicker}
                <Button
                  size="sm"
                  variant="soft"
                  onClick={() => {
                    const id = `c${Date.now().toString(36)}`;
                    setConfig((cfg) => ({
                      ...cfg,
                      centres: [
                        ...cfg.centres,
                        { id, code: "NEW", name: "Nouveau centre", address: "", managers: [], lines: [{ id: `${id}-l1`, name: "Ligne 1", capacityTph: 6 }], reservoirs: [], approFields: [{ id: "appro", label: "Approvisionnement" }], sortieFields: [{ id: "vrac", label: "Vrac clients" }] },
                      ],
                    }));
                    setCid(id);
                    toast("Centre ajouté", "success");
                  }}
                >
                  <Plus className="size-4" />
                  Ajouter un centre
                </Button>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_120px]">
                <Field label="Nom du centre">
                  <input className={inputCls} value={c.name} onChange={(e) => setCentre((x) => ({ ...x, name: e.target.value }))} />
                </Field>
                <Field label="Code" hint="Sur les rapports">
                  <input className={inputCls} maxLength={4} value={c.code} onChange={(e) => setCentre((x) => ({ ...x, code: e.target.value.toUpperCase() }))} />
                </Field>
                <Field label="Adresse" className="sm:col-span-2">
                  <input className={inputCls} value={c.address} onChange={(e) => setCentre((x) => ({ ...x, address: e.target.value }))} />
                </Field>
                <Field label="Chefs de production" hint="Séparés par des virgules" className="sm:col-span-2">
                  <input
                    className={inputCls}
                    value={c.managers.join(", ")}
                    onChange={(e) => setCentre((x) => ({ ...x, managers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }))}
                  />
                </Field>
              </div>

              <div className="mt-8 flex items-baseline justify-between">
                <h3 className="text-[16px] font-medium">Lignes de production</h3>
                <p className="tnum text-[13px] text-muted">
                  Capacité installée : <b className="text-ink">{fmt(c.lines.reduce((a, l) => a + l.capacityTph, 0), 1)} T/h</b>
                </p>
              </div>
              <ul className="mt-3 space-y-2">
                {c.lines.map((l) => (
                  <li key={l.id} className="grid grid-cols-[1fr_140px_auto] items-end gap-3 rounded-2xl bg-board p-3">
                      <div className="flex items-center gap-2">
                        {/* <small>Designation</small> */}
                        <input className={cn(inputCls, "mt-1")} placeholder="Nom de la ligne" value={l.name} onChange={(e) => setCentre((x) => ({ ...x, lines: x.lines.map((y) => (y.id === l.id ? { ...y, name: e.target.value } : y)) }))} />
                      </div>
                      <div className="flex items-center gap-2">
                        <small>Capacité</small>
                        <NumberInput value={l.capacityTph} onChange={(v) => setCentre((x) => ({ ...x, lines: x.lines.map((y) => (y.id === l.id ? { ...y, capacityTph: v } : y)) }))} />
                      </div>
                    <RemoveBtn label={`Supprimer ${l.name}`} disabled={c.lines.length <= 1} onClick={() => setCentre((x) => ({ ...x, lines: x.lines.filter((y) => y.id !== l.id) }))} />
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                variant="ghost"
                className="mt-3"
                onClick={() => setCentre((x) => ({ ...x, lines: [...x.lines, { id: `l${Date.now().toString(36)}`, name: `Ligne ${x.lines.length + 1}`, capacityTph: 6 }] }))}
              >
                <Plus className="size-4" />
                Ajouter une ligne
              </Button>
            </Card>
          )}

          {tab === "reservoirs" && (
            <Card>
              {CentrePicker}
              <div className="mt-6 overflow-x-auto">
                <table className="w-full min-w-[960px] text-[14px]">
                  <thead>
                    <tr className="text-left text-[12px] text-muted">
                      <th className="pb-2 font-medium">Nom</th>
                      <th className="pb-2 font-medium">Type</th>
                      <th className="pb-2 font-medium">Capacité m³</th>
                      <th className="pb-2 font-medium">Capacité T</th>
                      <th className="pb-2 font-medium">Hauteur mm</th>
                      <th className="pb-2 font-medium">Calcul</th>
                      <th className="pb-2 font-medium">Table de correction</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {c.reservoirs.map((r) => {
                      const upd = (patch: Partial<typeof r>) => setCentre((x) => ({ ...x, reservoirs: x.reservoirs.map((y) => (y.id === r.id ? { ...y, ...patch } : y)) }));
                      return (
                        <tr key={r.id} className="border-t border-line">
                          <td className="py-2 pr-2">
                            <input aria-label="Nom" className={inputCls} value={r.name} onChange={(e) => upd({ name: e.target.value })} />
                          </td>
                          <td className="py-2 pr-2">
                            <Select<TankType>
                              ariaLabel="Type"
                              value={r.type}
                              onChange={(v) => upd({ type: v })}
                              options={[
                                { value: "SPHERE", label: "Sphère" },
                                { value: "CIGARE", label: "Cigare" },
                                { value: "CITERNE", label: "Citerne" },
                                { value: "AUTRE", label: "Autre" },
                              ]}
                            />
                          </td>
                          <td className="py-2 pr-2">
                            <NumberInput ariaLabel="Capacité m³" value={r.capacityM3} onChange={(v) => upd({ capacityM3: v })} />
                          </td>
                          <td className="py-2 pr-2">
                            <NumberInput ariaLabel="Capacité tonnes" value={r.capacityT} onChange={(v) => upd({ capacityT: v })} />
                          </td>
                          <td className="py-2 pr-2">
                            <NumberInput ariaLabel="Hauteur" value={r.heightMm} step={1} onChange={(v) => upd({ heightMm: v })} />
                          </td>
                          <td className="py-2 pr-2">
                            <Select<"AUTOMATIC" | "PERCENTAGE">
                              ariaLabel="Mode de calcul"
                              value={r.calcMode}
                              onChange={(v) => upd({ calcMode: v })}
                              options={[
                                { value: "AUTOMATIC", label: "Formule physique" },
                                { value: "PERCENTAGE", label: "% de remplissage" },
                              ]}
                            />
                          </td>
                          <td className="py-2 pr-2">
                            <Select<string>
                              ariaLabel="Table de correction"
                              value={r.profileId ?? ""}
                              onChange={(v) => upd({ profileId: v || undefined })}
                              options={[{ value: "", label: "Profil par défaut" }, ...config.correction.profiles.map((p) => ({ value: p.id, label: p.name }))]}
                            />
                          </td>
                          <td className="py-2">
                            <RemoveBtn label={`Supprimer ${r.name}`} onClick={() => setCentre((x) => ({ ...x, reservoirs: x.reservoirs.filter((y) => y.id !== r.id) }))} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setCentre((x) => ({
                      ...x,
                      reservoirs: [...x.reservoirs, { id: `r${Date.now().toString(36)}`, name: `Réservoir ${x.reservoirs.length + 1}`, type: "CIGARE", capacityM3: 100, capacityT: 57, heightMm: 3000, calcMode: "AUTOMATIC" }],
                    }))
                  }
                >
                  <Plus className="size-4" />
                  Ajouter un réservoir
                </Button>
                <p className="tnum text-[13px] text-muted">
                  Capacité de stockage <b className="text-ink">{fmt(c.reservoirs.reduce((a, r) => a + r.capacityT, 0), 0)} T</b>
                </p>
              </div>
              <div className="mt-6 rounded-2xl bg-board p-4 text-[13px] text-muted">
                <p className="font-medium text-ink">Barèmes de jaugeage</p>
                <p className="mt-1">
                  Dans la version complète, chaque réservoir reçoit son barème (hauteur vers volume). L&apos;opérateur saisit la hauteur, le volume se calcule.
                </p>
              </div>
            </Card>
          )}

          {tab === "flux" && (
            <Card>
              {CentrePicker}
              <div className="mt-6 grid gap-6 md:grid-cols-2">
                <FieldList
                  title="Approvisionnements"
                  sub="Ajoutés au stock théorique"
                  fields={c.approFields}
                  onChange={(f) => setCentre((x) => ({ ...x, approFields: f }))}
                />
                <FieldList title="Sorties vrac" sub="Retirées du stock théorique" fields={c.sortieFields} onChange={(f) => setCentre((x) => ({ ...x, sortieFields: f }))} />
              </div>
              <p className="mt-6 text-[13px] text-muted">Les nouveaux champs apparaissent dans la fiche d&apos;inventaire et dans les colonnes du rapport mensuel de ce centre.</p>
            </Card>
          )}

          {tab === "bouteilles" && (
            <div className="grid grid-cols-1 gap-4">
              <Card>
                <CardTitle>Formats de bouteilles</CardTitle>
                <p className="mt-1 text-[13px] text-muted">Le tonnage conditionné est calculé à partir du poids unitaire. Communs à tous les centres.</p>
                <ul className="mt-5 space-y-2">
                  {config.bottleTypes.map((b) => (
                    <li key={b.id} className="grid grid-cols-[1fr_140px_auto] items-end gap-3 rounded-2xl bg-board p-3">
                      <Field label="Libellé">
                        <input className={inputCls} value={b.label} onChange={(e) => setConfig((cfg) => ({ ...cfg, bottleTypes: cfg.bottleTypes.map((x) => (x.id === b.id ? { ...x, label: e.target.value } : x)) }))} />
                      </Field>
                      <Field label="Poids" unit="kg">
                        <NumberInput value={b.kg} onChange={(v) => setConfig((cfg) => ({ ...cfg, bottleTypes: cfg.bottleTypes.map((x) => (x.id === b.id ? { ...x, kg: v } : x)) }))} />
                      </Field>
                      <RemoveBtn
                        label={`Supprimer ${b.label}`}
                        disabled={config.bottleTypes.length <= 1}
                        onClick={() => setConfig((cfg) => ({ ...cfg, bottleTypes: cfg.bottleTypes.filter((x) => x.id !== b.id) }))}
                      />
                    </li>
                  ))}
                </ul>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-3"
                  onClick={() => setConfig((cfg) => ({ ...cfg, bottleTypes: [...cfg.bottleTypes, { id: `b${Date.now().toString(36)}`, label: "Nouveau format", kg: 10 }] }))}
                >
                  <Plus className="size-4" />
                  Ajouter un format
                </Button>
              </Card>
              <BrandsCard />
            </div>
          )}

          {tab === "regles" && <RulesPanel config={config} setConfig={setConfig} />}

          {tab === "clients" && <CustomersPanel />}
          {tab === "ventes" && <WorkflowPanel />}
          {tab === "consignation" && <ConsignmentPanel />}
          {tab === "rapports" && <ReportsPanel />}
          {tab === "roles" && <RolesPanel />}

          {tab === "affichage" && <DisplayPanel />}
        </div>
      </div>
    </div>
  );
}

function RemoveBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-alert/10 hover:text-alert disabled:pointer-events-none disabled:opacity-30"
    >
      <Trash2 className="size-4" />
    </button>
  );
}

function FieldList({ title, sub, fields, onChange }: { title: string; sub: string; fields: FlowField[]; onChange: (f: FlowField[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const label = draft.trim();
    if (!label) return;
    let id = slug(label);
    if (fields.some((f) => f.id === id)) id = `${id}-${fields.length + 1}`;
    onChange([...fields, { id, label }]);
    setDraft("");
  };
  return (
    <div>
      <h3 className="text-[16px] font-medium">{title}</h3>
      <p className="text-[13px] text-muted">{sub}</p>
      <ul className="mt-3 space-y-2">
        {fields.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            <input aria-label="Libellé" className={inputCls} value={f.label} onChange={(e) => onChange(fields.map((x) => (x.id === f.id ? { ...x, label: e.target.value } : x)))} />
            <span className="w-8 shrink-0 text-[12px] text-faint">T</span>
            <RemoveBtn label={`Supprimer ${f.label}`} disabled={fields.length <= 1} onClick={() => onChange(fields.filter((x) => x.id !== f.id))} />
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input aria-label={`Nouveau champ ${title}`} className={inputCls} placeholder="Ex. Transfert entrant" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button size="sm" variant="soft" type="submit" className="h-10 shrink-0">
          <Plus className="size-4" />
          Ajouter
        </Button>
      </form>
    </div>
  );
}

function RulesPanel({ config, setConfig }: { config: TenantConfig; setConfig: (fn: (c: TenantConfig) => TenantConfig) => void }) {
  const { toast } = useStore();
  const [draft, setDraft] = useState("");
  const r = config.rules;
  const setR = (patch: Partial<TenantConfig["rules"]>) => setConfig((cfg) => ({ ...cfg, rules: { ...cfg.rules, ...patch } }));
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardTitle>Tolérance d&apos;écart</CardTitle>
        <p className="mt-1 text-[13px] text-muted">Au-delà du second seuil, la clôture demande une confirmation explicite.</p>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <Field label="Écart maîtrisé jusqu'à" unit="%">
            <NumberInput value={r.ecartOk} onChange={(v) => setR({ ecartOk: Math.max(v, 0) })} />
          </Field>
          <Field label="À surveiller jusqu'à" unit="%">
            <NumberInput value={r.ecartWarn} onChange={(v) => setR({ ecartWarn: Math.max(v, r.ecartOk) })} />
          </Field>
        </div>
        <div className="mt-5 flex h-3 overflow-hidden rounded-full" aria-hidden>
          <span className="bg-ok/70" style={{ flex: r.ecartOk }} />
          <span className="bg-warn/70" style={{ flex: Math.max(r.ecartWarn - r.ecartOk, 0.1) }} />
          <span className="bg-alert/80" style={{ flex: r.ecartWarn * 0.6 }} />
        </div>

        <h3 className="mt-8 text-[16px] font-medium">Temps de production</h3>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <Field label="Pause déjeuner déduite" unit="min">
            <NumberInput value={r.lunchBreakMin} step={5} onChange={(v) => setR({ lunchBreakMin: Math.max(Math.round(v), 0) })} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardTitle>Types d&apos;arrêt</CardTitle>
        <p className="mt-1 text-[13px] text-muted">Proposés dans la fiche et regroupés dans les analyses.</p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {r.stopTypes.map((t) => (
            <li key={t} className="flex h-9 items-center gap-1 rounded-full bg-board pr-1 pl-3.5 text-[13px]">
              {t}
              <button
                type="button"
                aria-label={`Retirer ${t}`}
                disabled={r.stopTypes.length <= 1}
                onClick={() => setR({ stopTypes: r.stopTypes.filter((x) => x !== t) })}
                className="grid size-7 place-items-center rounded-full text-muted hover:bg-alert/10 hover:text-alert"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = draft.trim();
            if (v && !r.stopTypes.includes(v)) setR({ stopTypes: [...r.stopTypes, v] });
            setDraft("");
          }}
        >
          <input className={inputCls} placeholder="Ex. Coupure électrique" aria-label="Nouveau type d'arrêt" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <Button size="sm" variant="soft" type="submit" className="h-10 shrink-0">
            <Plus className="size-4" />
            Ajouter
          </Button>
        </form>
      </Card>

      <CorrectionCard config={config} setConfig={setConfig} toast={toast} />
    </div>
  );
}

const DENSITIES: { id: Density; label: string; sub: string }[] = [
  { id: "compact", label: "Compacte", sub: "Contenu centré, largeur limitée. Confortable sur les grands écrans." },
  { id: "expanded", label: "Étendue", sub: "Occupe toute la largeur de la fenêtre, avec une marge égale sur chaque bord." },
];

function DisplayPanel() {
  const { density, setDensity } = useStore();
  return (
    <Card>
      <CardTitle>Largeur de l&apos;interface</CardTitle>
      <p className="mt-1 text-[13px] text-muted">Préférence propre à cet appareil.</p>
      <div className="mt-5 grid grid-cols-3 gap-3" role="radiogroup" aria-label="Largeur de l'interface">
        {DENSITIES.map((d) => {
          const on = density === d.id;
          return (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setDensity(d.id)}
              className={cn("rounded-2xl border p-3 text-left transition-colors", on ? "border-brand-800 border-3" : "border-line hover:border-faint")}
            >
              <span aria-hidden className="flex h-24 justify-center rounded-xl bg-board p-1.5">
                <span className={cn("flex gap-1 transition-[width] duration-300", d.id === "compact" ? "w-[64%]" : "w-full")}>
                  <span className="w-3 rounded-md bg-white" />
                  <span className="flex flex-1 flex-col gap-1">
                    <span className="h-3 rounded-md bg-white" />
                    <span className="flex-1 rounded-md bg-white" />
                  </span>
                </span>
              </span>
              <span className="mt-3 flex justify-between items-center gap-2 text-[14px] font-medium">

                {d.label}
                <span className={cn("grid size-4 place-items-center rounded-full border", on ? "border-brand-800" : "border-line")}>
                  {on && <span className="size-2 rounded-full bg-brand-800" />}
                </span>
              </span>
              {/* <span className="mt-1 block text-[12px] text-muted">{d.sub}</span> */}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

export default function ParametresPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
