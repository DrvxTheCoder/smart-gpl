"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, FileDown, Lock, Moon, Pencil, Plus, Trash2 } from "@/components/ui/icons";
import { useNow, useStore } from "@/lib/store";
import { buildClosing, ecartBand, nowHHMM, profileFor, summarize, tankOutcomes, tankResult, type Band, type TankOutcome } from "@/lib/calc";
import { pressureOffset } from "@/lib/correction";
import { cap, cn, fmt, fmtDate, fmtDuration, invCode } from "@/lib/format";
import type { CorrectionProfile, Inventory, Reservoir, TankReading } from "@/lib/types";
import { Button, Card, CardTitle, Dialog, EcartPill, Field, NumberInput, StatusBadge, Switch, glide, inputCls, useIndicator } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { TimePicker } from "@/components/ui/time-picker";
import { DateTimePicker } from "@/components/ui/calendar";
import { iso } from "@/lib/seed";
import { LiveTimerCard, TankLevel } from "@/components/production/production";
import { BulkShipments } from "@/components/sales/bulk-shipments";

type Tab = "appro" | "bouteilles" | "nuit" | "sorties" | "reservoirs" | "arrets" | "vehicules";

const EMPTY_READING: TankReading = { heightMm: 0, tLiq: 25, tVap: 26, volLiqM3: 0, pressureBar: 0, d15: 0.57 };

const bandText: Record<Band, string> = { ok: "text-ok", warn: "text-warn", alert: "text-alert" };

export default function FichePage() {
  const { id } = useParams<{ id: string }>();
  const { inventories, updateInventory, config, centre, toast, user } = useStore();
  const inv = inventories.find((i) => i.id === decodeURIComponent(id));
  const now = useNow(15000);
  const [tab, setTab] = useState<Tab>("bouteilles");
  const [editMode, setEditMode] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmEcart, setConfirmEcart] = useState(false);
  const [confirmWarnings, setConfirmWarnings] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [newStop, setNewStop] = useState({ type: config.rules.stopTypes[0], minutes: 15, note: "", at: "" });
  const tabsRef = useRef<HTMLDivElement>(null);
  const underline = useIndicator(tabsRef, '[role="tab"][aria-selected="true"]', [tab, inv?.night.enabled, inv?.stops.length]);

  useEffect(() => setEditMode(false), [id]);

  // Keep the active tab in view when the strip scrolls sideways.
  useEffect(() => {
    const list = tabsRef.current;
    const el = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !el) return;
    if (el.offsetLeft < list.scrollLeft || el.offsetLeft + el.offsetWidth > list.scrollLeft + list.clientWidth)
      list.scrollTo({ left: el.offsetLeft - 16, behavior: "smooth" });
  }, [tab]);

  const c = inv ? centre(inv.centreId) : null;
  const s = useMemo(() => (inv && c ? summarize(inv, c, config, now) : null), [inv, c, config, now]);

  if (!inv || !c || !s) {
    return (
      <div className="grid min-h-[50vh] place-items-center text-center">
        <div>
          <p className="text-[18px] font-medium">Cet inventaire n&apos;existe pas.</p>
          <Link href="/inventaires" className="mt-3 inline-block text-brand-ink underline">
            Revenir à la liste des inventaires
          </Link>
        </div>
      </div>
    );
  }

  const editable = inv.status === "EN_COURS" || editMode;
  const band = ecartBand(s.ecartPct, config.rules);

  // Editing a closed inventory rewrites its snapshot, so it always matches its readings.
  const set = (fn: (i: Inventory) => Inventory) => {
    if (!editable) return;
    updateInventory(inv.id, (i) => {
      const next = fn(i);
      return next.status === "TERMINE" ? { ...next, closing: buildClosing(next, c, config) } : next;
    });
    setSavedAt(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  };
  const setTank = (rid: string, k: keyof TankReading, v: number) => set((i) => ({ ...i, tanks: { ...i.tanks, [rid]: { ...(i.tanks[rid] ?? EMPTY_READING), [k]: v } } }));

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "appro", label: "Approvisionnement" },
    { id: "bouteilles", label: "Bouteilles" },
    ...(inv.night.enabled ? [{ id: "nuit" as Tab, label: "Bouteilles de nuit" }] : []),
    { id: "sorties", label: "Sorties vrac" },
    { id: "reservoirs", label: "Réservoirs" },
    { id: "arrets", label: "Arrêts", count: inv.stops.length },
    { id: "vehicules", label: "Véhicules" },
  ];
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "bouteilles";

  const onTabKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === activeTab);
    const next = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length : null;
    if (next == null) return;
    e.preventDefault();
    setTab(tabs[next].id);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  const close = () => {
    const fin = inv.heureFin || nowHHMM();
    updateInventory(inv.id, (i) => {
      const stops = [...i.stops];
      if (i.pausedAt) {
        const m = Math.max(Math.round((Date.now() - new Date(i.pausedAt).getTime()) / 60000), 1);
        stops.push({ id: crypto.randomUUID(), type: "Autre", minutes: m, note: "Arrêt en cours à la clôture", author: user.name, at: new Date().toISOString() });
      }
      const next: Inventory = { ...i, heureFin: fin, status: "TERMINE", pausedAt: undefined, stops };
      return { ...next, closing: buildClosing(next, c, config) };
    });
    setClosing(false);
    setConfirmEcart(false);
    setConfirmWarnings(false);
    setEditMode(false);
    toast(editMode ? "Modifications enregistrées" : "Inventaire clôturé", "success");
  };

  const needsConfirm = band === "alert";
  const closeBlocked = s.blockedTanks.length > 0;
  const needsWarningConfirm = s.tankWarnings.length > 0;

  // Results shown per tank: the snapshot once closed, live otherwise.
  const outcomes = tankOutcomes(inv, c, config);
  const outcomeOf = (res: Reservoir, r: TankReading): TankOutcome => {
    const o = outcomes[res.id];
    if (o) return o;
    if (inv.closing && inv.tanks[res.id]) {
      // Had a reading but no result when the snapshot was written.
      const prefix = `${res.name} : `;
      const warnings = inv.closing.warnings.filter((w) => w.startsWith(prefix)).map((w) => w.slice(prefix.length));
      return { blocked: true, profileId: "", profileVersion: 0, warnings };
    }
    return tankResult(r, res, profileFor(config, res));
  };

  // An arrêt starts on the inventory day, or the next one for a night shift.
  const nowLocal = `${iso(now)}T${nowHHMM(now)}`;
  const nextDay = (() => {
    const d = new Date(`${inv.date}T00:00`);
    d.setDate(d.getDate() + 1);
    return iso(d);
  })();
  const quarter = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return `${String(h).padStart(2, "0")}:${String(Math.floor(m / 15) * 15).padStart(2, "0")}`;
  };
  const stopDefault = `${inv.date}T${quarter(inv.date === iso(now) ? nowHHMM(now) : inv.heureDebut || "08:00")}`;

  return (
    <div>
      <Link href="/inventaires" className="mb-3 inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-ink">
        <ArrowLeft className="size-4" />
        Inventaires
      </Link>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[30px] font-semibold tracking-[-0.03em] sm:text-[36px]">{cap(fmtDate(inv.date, { weekday: "long", day: "numeric", month: "long" }))}</h1>
            <StatusBadge status={inv.status} />
          </div>
          <p className="mt-1 text-[15px] text-muted">
            {invCode(inv.date)}, {c.name}, démarré par {inv.startedBy}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {editable && savedAt && (
            <span className="flex items-center gap-1.5 text-[13px] text-muted" aria-live="polite">
              <Check className="size-4 text-ok" />
              Enregistré à {savedAt}
            </span>
          )}
          <Button variant="ghost" onClick={() => toast("Fiche PDF à venir")}>
            <FileDown className="size-4" />
            Fiche PDF
          </Button>
          {inv.status === "EN_COURS" ? (
            <Button onClick={() => setClosing(true)}>Clôturer l&apos;inventaire</Button>
          ) : editMode ? (
            <>
              <Button variant="ghost" onClick={() => setEditMode(false)}>
                Annuler
              </Button>
              <Button onClick={() => setClosing(true)}>Enregistrer les modifications</Button>
            </>
          ) : (
            <Button variant="soft" onClick={() => setEditMode(true)}>
              <Pencil className="size-4" />
              Modifier
            </Button>
          )}
        </div>
      </div>

      {inv.status === "TERMINE" && (
        <div
          className={cn(
            "mb-4 flex items-center gap-3 rounded-2xl px-4 py-3 text-[14px]",
            editMode ? "bg-warn/12 text-warn-ink" : "bg-brand-100 text-brand-deep",
          )}
        >
          {editMode ? <Pencil className="size-4 shrink-0" /> : <Lock className="size-4 shrink-0" />}
          {editMode
            ? "Mode édition administrateur. Chaque modification sera inscrite dans l'historique de l'inventaire."
            : `Inventaire clôturé à ${inv.heureFin}. Les valeurs sont en lecture seule.`}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Time + timer */}
          <div className={cn("grid gap-4", inv.status === "EN_COURS" && "lg:grid-cols-[minmax(0,1fr)_300px]")}>
            <Card>
              <CardTitle>Temps de production</CardTitle>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:max-w-md">
                <Field label="Heure de début">
                  <TimePicker value={inv.heureDebut} disabled={!editable} onChange={(v) => set((i) => ({ ...i, heureDebut: v }))} />
                </Field>
                <Field label="Heure de fin" hint={inv.status === "EN_COURS" && !inv.heureFin ? "Renseignée à la clôture" : undefined}>
                  <TimePicker value={inv.heureFin} disabled={!editable} onChange={(v) => set((i) => ({ ...i, heureFin: v }))} />
                </Field>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-4 md:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
                {[
                  ["Temps total", fmtDuration(s.totalMin), `pause de ${config.rules.lunchBreakMin} min déduite`],
                  ["Arrêts", fmtDuration(s.stopMin), `${inv.stops.length} arrêt${inv.stops.length > 1 ? "s" : ""}`],
                  ["Temps utile", fmtDuration(s.utileMin), `${fmt(s.rendementPct, 0)} % du temps total`],
                  ["Rendement horaire", `${fmt(s.rendementTph, 1)} T/h`, `${fmt(s.capacityPct, 0)} % de ${fmt(s.capacityTph, 0)} T/h`],
                ].map(([k, v, sub]) => (
                  <div key={k}>
                    <dt className="text-[12px] text-muted">{k}</dt>
                    <dd className="tnum mt-0.5 text-[22px] font-semibold tracking-[-0.02em]">{v}</dd>
                    <dd className="text-[12px] text-faint">{sub}</dd>
                  </div>
                ))}
              </dl>
            </Card>
            {inv.status === "EN_COURS" && <LiveTimerCard inv={inv} compact />}
          </div>

          {/* Night shift */}
          <Card>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-brand-100 text-brand-ink">
                  <Moon className="size-5" />
                </span>
                <div>
                  <CardTitle>Quart de nuit</CardTitle>
                  <p className="text-[13px] text-muted">Production de l&apos;équipe de nuit, rattachée à cette journée.</p>
                </div>
              </div>
              <Switch
                checked={inv.night.enabled}
                disabled={!editable}
                label="Activer le quart de nuit"
                onChange={(v) => {
                  set((i) => ({ ...i, night: { ...i.night, enabled: v, thtMin: v && !i.night.thtMin ? 360 : i.night.thtMin, lineIds: v && !i.night.lineIds.length ? c.lines.slice(0, 1).map((l) => l.id) : i.night.lineIds } }));
                  if (v) setTab("nuit");
                }}
              />
            </div>
            {inv.night.enabled && (
              <div className="mt-5 grid gap-5 border-t border-line pt-5 lg:grid-cols-[1fr_1fr_1.2fr]">
                <div className="grid grid-cols-2 gap-3 lg:col-span-1">
                  <Field label="Heures travaillées" unit="min">
                    <NumberInput value={inv.night.thtMin} step={5} disabled={!editable} onChange={(v) => set((i) => ({ ...i, night: { ...i.night, thtMin: v } }))} />
                  </Field>
                  <Field label="Arrêts" unit="min">
                    <NumberInput value={inv.night.taMin} step={5} disabled={!editable} onChange={(v) => set((i) => ({ ...i, night: { ...i.night, taMin: v } }))} />
                  </Field>
                </div>
                <fieldset>
                  <legend className="mb-1.5 text-[13px] text-muted">Lignes utilisées</legend>
                  <div className="flex flex-wrap gap-2">
                    {c.lines.map((l) => {
                      const on = inv.night.lineIds.includes(l.id);
                      return (
                        <button
                          key={l.id}
                          type="button"
                          aria-pressed={on}
                          disabled={!editable}
                          onClick={() =>
                            set((i) => ({
                              ...i,
                              night: { ...i.night, lineIds: on ? i.night.lineIds.filter((x) => x !== l.id) : [...i.night.lineIds, l.id] },
                            }))
                          }
                          className={cn(
                            "h-9 rounded-full border px-3 text-[13px] transition-colors disabled:opacity-60",
                            on ? "border-brand-800 bg-brand-800 text-white" : "border-line bg-field text-ink hover:border-brand-600",
                          )}
                        >
                          {l.name} <span className="tnum opacity-70">{l.capacityTph} T/h</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <dl className="grid grid-cols-3 gap-3 rounded-2xl bg-board p-3">
                  <div>
                    <dt className="text-[11px] text-muted">Conditionné</dt>
                    <dd className="tnum text-[17px] font-semibold">{fmt(s.bottlesNightT, 1)} T</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted">Temps utile</dt>
                    <dd className="tnum text-[17px] font-semibold">{fmtDuration(s.nightUtileMin)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted">Rendement</dt>
                    <dd className="tnum text-[17px] font-semibold">{fmt(s.nightTph, 1)} T/h</dd>
                    <dd className="tnum text-[11px] text-faint">{fmt(s.nightCapacityPct, 0)} % capacité</dd>
                  </div>
                </dl>
              </div>
            )}
          </Card>

          {/* Tabs */}
          <Card className="p-0">
            <div ref={tabsRef} role="tablist" aria-label="Sections de la fiche" onKeyDown={onTabKey} className="no-scrollbar relative flex gap-1 overflow-x-auto border-b border-line px-3 pt-3">
              <span
                aria-hidden
                className={cn("absolute bottom-0 left-0 h-[3px] rounded-full bg-brand-800", underline.ready && glide)}
                style={{ transform: `translateX(${underline.x + 12}px)`, width: Math.max(underline.w - 24, 0) }}
              />
              {tabs.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  id={`tab-${t.id}`}
                  aria-selected={activeTab === t.id}
                  aria-controls={`panel-${t.id}`}
                  tabIndex={activeTab === t.id ? 0 : -1}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "relative shrink-0 rounded-t-xl px-3.5 pt-2 pb-3 text-[14px] whitespace-nowrap transition-colors duration-300",
                    activeTab === t.id ? "font-semibold text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  {t.label}
                  {t.count ? <span className="tnum ml-1.5 rounded-md bg-board px-1.5 text-[11px]">{t.count}</span> : null}
                </button>
              ))}
            </div>

            <div key={activeTab} role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} className="panel-in p-5">
              {activeTab === "appro" && (
                <div>
                  <div className="mb-5 flex items-center justify-between rounded-2xl bg-board px-4 py-3">
                    <span className="text-[14px] text-muted">Stock initial physique, repris de la veille</span>
                    <span className="tnum text-[18px] font-semibold">{fmt(inv.stockInitial, 1)} T</span>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {c.approFields.map((f) => (
                      <Field key={f.id} label={f.label} unit="tonnes">
                        <NumberInput value={inv.appro[f.id] ?? 0} disabled={!editable} onChange={(v) => set((i) => ({ ...i, appro: { ...i.appro, [f.id]: v } }))} />
                      </Field>
                    ))}
                  </div>
                  <p className="tnum mt-5 text-right text-[14px] text-muted">
                    Total approvisionnement <b className="ml-2 text-[16px] text-ink">{fmt(s.approT, 1)} T</b>
                  </p>
                  <p className="mt-4 text-[12px] text-faint">Les champs d&apos;approvisionnement se configurent par centre dans Paramètres, Flux.</p>
                </div>
              )}

              {(activeTab === "bouteilles" || activeTab === "nuit") && (
                <BottleTable
                  values={activeTab === "nuit" ? inv.night.bottles : inv.bottles}
                  disabled={!editable}
                  onChange={(bid, v) =>
                    set((i) =>
                      activeTab === "nuit"
                        ? { ...i, night: { ...i.night, bottles: { ...i.night.bottles, [bid]: v } } }
                        : { ...i, bottles: { ...i.bottles, [bid]: v } },
                    )
                  }
                />
              )}

              {activeTab === "sorties" && (
                <div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {c.sortieFields.map((f) => (
                      <Field key={f.id} label={f.label} unit="tonnes">
                        <NumberInput value={inv.sorties[f.id] ?? 0} disabled={!editable} onChange={(v) => set((i) => ({ ...i, sorties: { ...i.sorties, [f.id]: v } }))} />
                      </Field>
                    ))}
                  </div>
                  <p className="tnum mt-5 text-right text-[14px] text-muted">
                    Total sorties vrac <b className="ml-2 text-[16px] text-ink">{fmt(s.vracT, 1)} T</b>
                  </p>
                  <BulkShipments
                    centreId={inv.centreId}
                    date={inv.date}
                    field={c.sortieFields[0]}
                    entered={c.sortieFields[0] ? inv.sorties[c.sortieFields[0].id] ?? 0 : 0}
                    editable={editable}
                    onTake={(t) => c.sortieFields[0] && set((i) => ({ ...i, sorties: { ...i.sorties, [c.sortieFields[0].id]: t } }))}
                  />
                </div>
              )}

              {activeTab === "reservoirs" && (
                <div className="flex flex-col gap-4">
                  {c.reservoirs.map((res) => {
                    const r = inv.tanks[res.id] ?? EMPTY_READING;
                    const tr = outcomeOf(res, r);
                    return (
                      <div key={res.id} className="rounded-2xl border border-line p-4">
                        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-[16px] font-semibold">
                            {res.name}{" "}
                            <span className="text-[13px] font-normal text-muted">
                              {res.type === "SPHERE" ? "Sphère" : res.type === "CIGARE" ? "Cigare" : res.type === "CITERNE" ? "Citerne" : "Autre"}, {fmt(res.capacityM3)} m³
                            </span>
                          </p>
                          {!tr.blocked && (
                            <div className="w-full sm:w-64">
                              <TankLevel name="Remplissage" pct={tr.fillPct} tonnes={tr.liquidT} capT={res.capacityT} />
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
                          {(
                            [
                              ["heightMm", "Hauteur", "mm", 1],
                              ["tLiq", "Temp. liquide", "°C", 0.1],
                              ["tVap", "Temp. vapeur", "°C", 0.1],
                              ["volLiqM3", "Volume liquide", "m³", 0.1],
                              ["pressureBar", "Pression", "bar", 0.1],
                              ["d15", "Densité à 15 °C", "", 0.001],
                            ] as [keyof TankReading, string, string, number][]
                          ).map(([k, label, unit, step]) => (
                            <Field key={k} label={label} unit={unit}>
                              <NumberInput value={r[k]} step={step} disabled={!editable} onChange={(v) => setTank(res.id, k, v)} />
                            </Field>
                          ))}
                        </div>
                        {tr.blocked ? (
                          <p className="mt-4 rounded-xl bg-alert/8 p-3 text-[13px] text-alert">
                            Résultat indisponible : la mesure sort de la table et le profil bloque les valeurs hors table. Ce réservoir n&apos;entre pas dans le stock physique.
                          </p>
                        ) : (
                          <dl className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-board p-3 sm:grid-cols-6">
                            {[
                              ["Correction liquide", fmt(tr.liquidFactor, 4)],
                              ["Coefficient gaz", fmt(tr.gasCoefficient, 6)],
                              ["Densité ambiante", fmt(tr.densAmb, 4)],
                              ["Poids liquide", `${fmt(tr.liquidT, 3)} T`],
                              ["Poids gaz", `${fmt(tr.gasT, 3)} T`],
                              ["Poids total", `${fmt(tr.totalT, 3)} T`],
                            ].map(([k, v]) => (
                              <div key={k}>
                                <dt className="text-[11px] text-muted">{k}</dt>
                                <dd className="tnum text-[14px] font-semibold">{v}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        {tr.warnings.length > 0 && (
                          <ul className="mt-3 space-y-1 rounded-xl bg-warn/12 px-3 py-2 text-[13px] text-warn-ink">
                            {tr.warnings.map((w) => (
                              <li key={w}>{w}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                  <CorrectionNote inv={inv} reservoirs={c.reservoirs} outcomes={outcomes} profiles={config.correction.profiles} fallback={profileFor(config, {})} />
                </div>
              )}

              {activeTab === "arrets" && (
                <div>
                  {editable && (
                    <div className="mb-5 grid gap-3 rounded-2xl bg-board p-4 sm:grid-cols-2 sm:items-end 2xl:grid-cols-[1.3fr_1.25fr_0.6fr_1.2fr_auto]">
                      <Field label="Type d'arrêt">
                        <Select
                          searchable
                          ariaLabel="Type d'arrêt"
                          value={newStop.type}
                          onChange={(v) => setNewStop((n) => ({ ...n, type: v }))}
                          options={config.rules.stopTypes.map((t) => ({ value: t, label: t }))}
                        />
                      </Field>
                      <Field label="Début">
                        <DateTimePicker
                          ariaLabel="Début de l'arrêt"
                          value={newStop.at || stopDefault}
                          min={inv.date}
                          max={nextDay}
                          isSlotDisabled={(d, t) => `${d}T${t}` > nowLocal}
                          onChange={(v) => setNewStop((n) => ({ ...n, at: v }))}
                        />
                      </Field>
                      <Field label="Durée" unit="min">
                        <NumberInput value={newStop.minutes} step={5} onChange={(v) => setNewStop((n) => ({ ...n, minutes: v }))} />
                      </Field>
                      <Field label="Remarque">
                        <input className={inputCls} value={newStop.note} placeholder="Facultatif" onChange={(e) => setNewStop((n) => ({ ...n, note: e.target.value }))} />
                      </Field>
                      <Button
                        className="sm:col-span-2 2xl:col-span-1"
                        disabled={newStop.minutes <= 0}
                        onClick={() => {
                          set((i) => ({
                            ...i,
                            stops: [
                              ...i.stops,
                              { id: crypto.randomUUID(), type: newStop.type, minutes: newStop.minutes, note: newStop.note, author: user.name, at: new Date(newStop.at || stopDefault).toISOString() },
                            ],
                          }));
                          setNewStop((n) => ({ ...n, minutes: 15, note: "", at: "" }));
                          toast(`Arrêt ajouté · ${newStop.minutes} min`, "success");
                        }}
                      >
                        <Plus className="size-4" />
                        Ajouter l&apos;arrêt
                      </Button>
                    </div>
                  )}
                  {inv.stops.length === 0 ? (
                    <p className="py-8 text-center text-muted">Aucun arrêt sur cette journée.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {inv.stops.map((st) => (
                        <li key={st.id} className="flex items-center gap-4 py-3">
                          <span className="tnum grid h-11 w-16 shrink-0 place-items-center rounded-xl bg-warn/10 text-[14px] font-semibold text-warn">{st.minutes} min</span>
                          <div className="min-w-0 flex-1">
                            {editable ? (
                              <Select
                                variant="bare"
                                searchable
                                ariaLabel="Type d'arrêt"
                                value={st.type}
                                onChange={(v) => set((i) => ({ ...i, stops: i.stops.map((x) => (x.id === st.id ? { ...x, type: v } : x)) }))}
                                options={config.rules.stopTypes.map((t) => ({ value: t, label: t }))}
                              />
                            ) : (
                              <p className="text-[15px] font-medium">{st.type}</p>
                            )}
                            <p className="text-[12px] text-muted">
                              {st.author}, {new Date(st.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                              {st.note ? `, ${st.note}` : ""}
                            </p>
                          </div>
                          {editable && (
                            <button
                              aria-label={`Supprimer l'arrêt ${st.type}`}
                              onClick={() => set((i) => ({ ...i, stops: i.stops.filter((x) => x.id !== st.id) }))}
                              className="grid size-9 place-items-center rounded-full text-muted hover:bg-alert/10 hover:text-alert"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {activeTab === "vehicules" && (
                <div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[460px] text-[14px]">
                      <thead>
                        <tr className="text-left text-[12px] text-muted">
                          <th className="pb-2 font-medium">Mouvement</th>
                          <th className="pb-2 font-medium">Commerciaux</th>
                          <th className="pb-2 font-medium">Livraison</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          [
                            ["decharges", "Déchargés"],
                            ["charges", "Chargés"],
                            ["nonDecharges", "Non déchargés"],
                            ["dechargesNonCharges", "Déchargés non chargés"],
                          ] as const
                        ).map(([k, label]) => (
                          <tr key={k} className="border-t border-line">
                            <td className="py-2.5 pr-3">{label}</td>
                            {[0, 1].map((col) => (
                              <td key={col} className="py-2 pr-3">
                                <NumberInput
                                  ariaLabel={`${label}, ${col ? "livraison" : "commerciaux"}`}
                                  value={inv.vehicles[k][col]}
                                  step={1}
                                  disabled={!editable}
                                  onChange={(v) =>
                                    set((i) => {
                                      const pair = [...i.vehicles[k]] as [number, number];
                                      pair[col] = Math.max(Math.round(v), 0);
                                      return { ...i, vehicles: { ...i.vehicles, [k]: pair } };
                                    })
                                  }
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Field label="Observations" className="mt-4">
                    <textarea
                      rows={3}
                      disabled={!editable}
                      value={inv.vehicles.notes}
                      onChange={(e) => set((i) => ({ ...i, vehicles: { ...i.vehicles, notes: e.target.value } }))}
                      className={cn(inputCls, "h-auto py-2")}
                    />
                  </Field>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Mass balance */}
        <aside className="xl:sticky xl:top-[100px] xl:self-start">
          <Card className="overflow-hidden p-0">
            <div className="p-5">
              <CardTitle>Bilan de stock</CardTitle>
              <p className="mt-0.5 text-[13px] text-muted">Recalculé à chaque saisie.</p>
              <dl className="tnum mt-4 space-y-2.5 text-[14px]">
                {[
                  ["Stock initial", inv.stockInitial, ""],
                  ["Approvisionnements", s.approT, "+"],
                  ["Sorties vrac", s.vracT, "−"],
                  ["Conditionné jour", s.bottlesDayT, "−"],
                  ...(inv.night.enabled ? [["Conditionné nuit", s.bottlesNightT, "−"] as [string, number, string]] : []),
                ].map(([k, v, sign]) => (
                  <div key={k as string} className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted">{k}</dt>
                    <dd>
                      <span className="mr-1 text-faint">{sign}</span>
                      {fmt(v as number, 2)} T
                    </dd>
                  </div>
                ))}
                <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2.5 font-semibold">
                  <dt>Stock théorique</dt>
                  <dd>{fmt(s.stockTheo, 2)} T</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 font-semibold">
                  <dt>Stock physique</dt>
                  <dd>{fmt(s.stockPhys, 2)} T</dd>
                </div>
                {(closeBlocked || needsWarningConfirm) && (
                  <p className={cn("text-[12px]", closeBlocked ? "text-alert" : "text-warn")}>
                    {closeBlocked
                      ? `Incomplet : ${s.blockedTanks.join(", ")} sans résultat (hors table).`
                      : `${s.tankWarnings.length} avertissement${s.tankWarnings.length > 1 ? "s" : ""} de correction, voir l'onglet Réservoirs.`}
                  </p>
                )}
              </dl>
            </div>
            <div className={cn("border-t border-line p-5", band === "ok" ? "bg-ok/6" : band === "warn" ? "bg-warn/8" : "bg-alert/8")}>
              <p className="text-[13px] text-muted">Écart physique − théorique</p>
              <p className={cn("tnum mt-1 text-[40px] leading-none font-semibold tracking-[-0.04em]", bandText[band])}>
                {s.ecart >= 0 ? "+" : "−"}
                {fmt(Math.abs(s.ecart), 2)}
                <span className="ml-1 text-[18px]">T</span>
              </p>
              <div className="mt-3 flex items-center gap-2">
                <EcartPill pct={s.ecartPct} band={band} />
                <span className="text-[13px] text-muted">{band === "ok" ? "Écart maîtrisé" : band === "warn" ? "À surveiller" : "À justifier avant clôture"}</span>
              </div>
              <EcartScale pct={s.ecartPct} ok={config.rules.ecartOk} warn={config.rules.ecartWarn} />
            </div>
            <dl className="tnum grid grid-cols-2 gap-3 border-t border-line p-5 text-[13px]">
              <div>
                <dt className="text-muted">Bouteilles</dt>
                <dd className="text-[18px] font-semibold">{fmt(s.bottlesDayN + s.bottlesNightN)}</dd>
              </div>
              <div>
                <dt className="text-muted">Cumul sortie</dt>
                <dd className="text-[18px] font-semibold">{fmt(s.cumulSortieT, 1)} T</dd>
              </div>
            </dl>
          </Card>
        </aside>
      </div>

      <Dialog open={closing} onClose={() => setClosing(false)} title={editMode ? "Enregistrer les modifications ?" : "Clôturer l'inventaire ?"}>
        <p className="text-[14px] text-muted">
          {editMode
            ? "Les nouvelles valeurs remplacent les anciennes et sont inscrites dans l'historique."
            : `L'heure de fin sera fixée à ${inv.heureFin || nowHHMM()}. La fiche passera en lecture seule.`}
        </p>
        <dl className="tnum mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-board p-4 text-[14px]">
          <dt className="text-muted">Temps utile</dt>
          <dd className="text-right font-semibold">{fmtDuration(s.utileMin)}</dd>
          <dt className="text-muted">Conditionné</dt>
          <dd className="text-right font-semibold">{fmt(s.conditionneT, 1)} T</dd>
          <dt className="text-muted">Écart</dt>
          <dd className={cn("text-right font-semibold", bandText[band])}>
            {s.ecart >= 0 ? "+" : "−"}
            {fmt(Math.abs(s.ecart), 2)} T ({fmt(s.ecartPct, 2)} %)
          </dd>
        </dl>
        {closeBlocked && (
          <p className="mt-4 rounded-2xl border border-alert/40 bg-alert/6 p-3 text-[14px] text-alert">
            Clôture impossible : {s.blockedTanks.join(", ")} sans résultat. La mesure sort de la table et le profil bloque les valeurs hors table. Corrigez la mesure ou changez de profil.
          </p>
        )}
        {!closeBlocked && needsWarningConfirm && (
          <div className="mt-4 rounded-2xl border border-warn/45 bg-warn/8 p-3 text-[14px]">
            <ul className="space-y-1 text-[13px] text-warn-ink">
              {s.tankWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <label className="mt-3 flex items-start gap-3">
              <input type="checkbox" className="mt-1 size-4 accent-[var(--warn)]" checked={confirmWarnings} onChange={(e) => setConfirmWarnings(e.target.checked)} />
              <span>J&apos;ai pris connaissance de ces avertissements et je confirme les valeurs retenues.</span>
            </label>
          </div>
        )}
        {needsConfirm && (
          <label className="mt-4 flex items-start gap-3 rounded-2xl border border-alert/40 bg-alert/6 p-3 text-[14px]">
            <input type="checkbox" className="mt-1 size-4 accent-[var(--alert)]" checked={confirmEcart} onChange={(e) => setConfirmEcart(e.target.checked)} />
            <span>
              L&apos;écart dépasse {config.rules.ecartWarn} %. J&apos;ai vérifié les mesures des réservoirs et je confirme la clôture.
            </span>
          </label>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setClosing(false)}>
            Continuer la saisie
          </Button>
          <Button disabled={closeBlocked || (needsConfirm && !confirmEcart) || (needsWarningConfirm && !confirmWarnings)} onClick={close}>
            {editMode ? "Enregistrer" : "Clôturer"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

const describe = (p: CorrectionProfile) =>
  [
    p.liquid.method === "ADDITIVE_TABLE" ? "liquide : table additive (d15 − correction)" : `liquide : linéaire, α = ${fmt(p.liquid.alpha, 4)} /°C`,
    p.gas.method === "COEFFICIENT_TABLE" ? `gaz : table de coefficients, pression + ${fmt(pressureOffset(p), 2)} bar` : `gaz : gaz parfait, M = ${fmt(p.gas.molarMassKgMol, 4)} kg/mol`,
    p.stockBasis === "TOTAL" ? "stock physique : liquide + gaz" : "stock physique : liquide",
  ].join(" ; ");

/* Which profile(s) produced the tank results, and whether they were frozen at closing. */
function CorrectionNote({
  inv,
  reservoirs,
  outcomes,
  profiles,
  fallback,
}: {
  inv: Inventory;
  reservoirs: Reservoir[];
  outcomes: Record<string, TankOutcome>;
  profiles: CorrectionProfile[];
  fallback: CorrectionProfile;
}) {
  const used = new Map<string, number>();
  for (const res of reservoirs) {
    const o = outcomes[res.id];
    if (o && o.profileId) used.set(o.profileId, o.profileVersion);
  }
  if (!used.size) used.set(fallback.id, fallback.version);
  return (
    <div className="space-y-1.5 text-[12px] text-faint">
      {[...used].map(([id, version]) => {
        const p = profiles.find((x) => x.id === id);
        if (!p) return <p key={id}>Correction de température : profil « {id} » v{version}, supprimé depuis la clôture.</p>;
        return (
          <p key={id}>
            Correction de température : profil « {p.name} » v{version}
            {inv.closing && p.version !== version ? ` (v${p.version} aujourd'hui)` : ""}, {p.product}. Source : {p.source}. {cap(describe(p))}. Températures
            arrondies au dixième, lecture de la ligne exacte.
          </p>
        );
      })}
      {inv.closing && <p>Valeurs figées à la clôture : modifier un profil ne change pas cet inventaire.</p>}
    </div>
  );
}

function BottleTable({ values, disabled, onChange }: { values: Record<string, number>; disabled: boolean; onChange: (id: string, v: number) => void }) {
  const { config } = useStore();
  let totalN = 0;
  let totalT = 0;
  for (const b of config.bottleTypes) {
    const q = values[b.id] ?? 0;
    totalN += q;
    totalT += (q * b.kg) / 1000;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-[14px]">
        <thead>
          <tr className="text-left text-[12px] text-muted">
            <th className="pb-2 font-medium">Type</th>
            <th className="pb-2 text-right font-medium">Poids unitaire</th>
            <th className="w-44 pb-2 pl-4 font-medium">Quantité</th>
            <th className="pb-2 text-right font-medium">Tonnage</th>
          </tr>
        </thead>
        <tbody>
          {config.bottleTypes.map((b) => {
            const q = values[b.id] ?? 0;
            return (
              <tr key={b.id} className="border-t border-line">
                <td className="py-2 font-medium">{b.label}</td>
                <td className="tnum py-2 text-right text-muted">{fmt(b.kg, 1)} kg</td>
                <td className="py-2 pl-4">
                  <NumberInput ariaLabel={`Quantité ${b.label}`} value={q} step={1} disabled={disabled} onChange={(v) => onChange(b.id, Math.max(Math.round(v), 0))} />
                </td>
                <td className="tnum py-2 text-right">{fmt((q * b.kg) / 1000, 3)} T</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-ink/80 font-semibold">
            <td className="pt-3">Total</td>
            <td />
            <td className="tnum pt-3 pl-4">{fmt(totalN)} bouteilles</td>
            <td className="tnum pt-3 text-right">{fmt(totalT, 3)} T</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* Scale from −2×warn to +2×warn showing where the écart sits against the tenant's thresholds. */
function EcartScale({ pct, ok, warn }: { pct: number; ok: number; warn: number }) {
  const range = warn * 2;
  const pos = (v: number) => ((Math.max(Math.min(v, range), -range) + range) / (range * 2)) * 100;
  return (
    <div className="mt-5" aria-hidden>
      <div className="relative h-2 rounded-full bg-alert/25">
        <span className="absolute inset-y-0 rounded-full bg-warn/45" style={{ left: `${pos(-warn)}%`, right: `${100 - pos(warn)}%` }} />
        <span className="absolute inset-y-0 rounded-full bg-ok/70" style={{ left: `${pos(-ok)}%`, right: `${100 - pos(ok)}%` }} />
        <span className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-card bg-ink shadow transition-[left] duration-500" style={{ left: `${pos(pct)}%` }} />
      </div>
      <div className="tnum mt-1.5 flex justify-between text-[11px] text-faint">
        <span>−{range} %</span>
        <span>0</span>
        <span>+{range} %</span>
      </div>
    </div>
  );
}
