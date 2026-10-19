import { Checker, isObj, isStr, isStrList, type Obj } from "./checker";
import { checkCorrection } from "./correction";
import { checkSalesConfig } from "./sales/config";
import { DEFAULT_CONFIG } from "./seed";
import { BULK } from "./sales/types";
import type { BottleType, Branding, CalcMode, Centre, FlowField, ProductionLine, Reservoir, Rules, SalesConfig, TankType, TenantConfig } from "./types";

/* Tenant configuration as untrusted data: the JSON "template" files and what
   localStorage hands back. Everything is checked before it reaches the store. */

export const STORAGE_VERSION = 3;
export const TEMPLATE_FORMAT = "jauge-tenant-config";

const TANK_TYPES: readonly TankType[] = ["SPHERE", "CIGARE", "AUTRE"];
const CALC_MODES: readonly CalcMode[] = ["AUTOMATIC", "PERCENTAGE"];

/** Full structural check. Returns the typed config only when there is no error. */
export function checkTenantConfig(raw: unknown): { value: TenantConfig | null; errors: string[] } {
  const c = new Checker();
  if (!isObj(raw)) return { value: null, errors: ["La configuration doit être un objet JSON."] };

  const b = isObj(raw.branding) ? raw.branding : (c.fail("Marque", "objet attendu."), {});
  const branding: Branding = { companyName: c.str(b, "companyName", "Marque"), shortName: c.str(b, "shortName", "Marque"), brand: c.str(b, "brand", "Marque") };
  if (branding.brand && !/^#[0-9a-f]{6}$/i.test(branding.brand)) c.fail("Marque", "couleur hexadécimale #rrggbb attendue.");

  const r = isObj(raw.rules) ? raw.rules : (c.fail("Règles", "objet attendu."), {});
  const rules: Rules = {
    ecartOk: c.num(r, "ecartOk", "Règles"),
    ecartWarn: c.num(r, "ecartWarn", "Règles"),
    lunchBreakMin: c.num(r, "lunchBreakMin", "Règles"),
    stopTypes: isStrList(r.stopTypes) ? r.stopTypes : (c.fail("Règles", "« stopTypes » liste de textes attendue."), []),
  };

  const bottleTypes = c.list<BottleType>(raw.bottleTypes, "Bouteille", (x, at) => ({ id: c.str(x, "id", at), label: c.str(x, "label", at), kg: c.num(x, "kg", at) }));
  if (!bottleTypes.length) c.fail("Bouteilles", "au moins un format est requis.");

  const correction = checkCorrection(raw.correction);
  c.errors.push(...correction.errors);
  const profileIds = correction.value?.profiles.map((p) => p.id) ?? [];

  const field = (x: Obj, at: string): FlowField => ({ id: c.str(x, "id", at), label: c.str(x, "label", at) });
  const centres = c.list<Centre>(raw.centres, "Centre", (x, at) => {
    const name = isStr(x.name) ? `${at} « ${x.name} »` : at;
    return {
      id: c.str(x, "id", name),
      code: c.str(x, "code", name),
      name: c.str(x, "name", name),
      address: c.str(x, "address", name),
      managers: isStrList(x.managers) ? x.managers : (c.fail(name, "« managers » liste de textes attendue."), []),
      lines: c.list<ProductionLine>(x.lines, `${name}, ligne`, (l, a) => ({ id: c.str(l, "id", a), name: c.str(l, "name", a), capacityTph: c.num(l, "capacityTph", a) })),
      reservoirs: c.list<Reservoir>(x.reservoirs, `${name}, réservoir`, (t, a) => {
        const res: Reservoir = {
          id: c.str(t, "id", a),
          name: c.str(t, "name", a),
          type: c.oneOf(t, "type", TANK_TYPES, a),
          capacityM3: c.num(t, "capacityM3", a),
          capacityT: c.num(t, "capacityT", a),
          heightMm: c.num(t, "heightMm", a),
          calcMode: c.oneOf(t, "calcMode", CALC_MODES, a),
        };
        if (t.profileId !== undefined) {
          if (isStr(t.profileId) && profileIds.includes(t.profileId)) res.profileId = t.profileId;
          else if (correction.value) c.fail(a, `profil de correction « ${String(t.profileId)} » inconnu.`);
        }
        return res;
      }),
      approFields: c.list(x.approFields, `${name}, entrée`, field),
      sortieFields: c.list(x.sortieFields, `${name}, sortie`, field),
    };
  });
  if (!centres.length) c.fail("Centres", "au moins un centre est requis.");

  const sales = checkSalesConfig(raw.sales, c);
  if (sales) crossCheckSales(c, sales, bottleTypes, centres);

  if (c.errors.length || !correction.value || !sales) return { value: null, errors: c.errors };
  return { value: { branding, rules, bottleTypes, centres, correction: correction.value, sales }, errors: [] };
}

/** Sales settings may only name formats and centres the tenant has. */
function crossCheckSales(c: Checker, sales: SalesConfig, bottleTypes: BottleType[], centres: Centre[]) {
  const formats = new Set([...bottleTypes.map((b) => b.id), BULK]);
  for (const pl of sales.priceLists)
    for (const l of pl.lines) if (!formats.has(l.formatId)) c.fail(`Tarif « ${pl.label} »`, `format « ${l.formatId} » inconnu.`);
  for (const id of Object.keys(sales.openingStock)) if (!centres.some((x) => x.id === id)) c.fail("Stock d'ouverture", `centre « ${id} » inconnu.`);
}

/**
 * Sales defaults fitted to a tenant that predates the sales module: only its
 * own formats and centres are kept, so the result passes the cross-check.
 */
export function salesDefaultsFor(raw: Obj): SalesConfig {
  const d = DEFAULT_CONFIG.sales;
  const formats = new Set([...(Array.isArray(raw.bottleTypes) ? raw.bottleTypes.filter(isObj).map((b) => b.id) : []), BULK]);
  const centreIds = new Set(Array.isArray(raw.centres) ? raw.centres.filter(isObj).map((x) => x.id) : []);
  return {
    ...d,
    priceLists: d.priceLists.map((pl) => ({ ...pl, lines: pl.lines.filter((l) => formats.has(l.formatId)) })),
    openingStock: Object.fromEntries(Object.entries(d.openingStock).filter(([id]) => centreIds.has(id))),
  };
}

/* ---------------- template files ---------------- */

export function exportTenantJson(cfg: TenantConfig): string {
  return JSON.stringify({ format: TEMPLATE_FORMAT, version: STORAGE_VERSION, exportedAt: new Date().toISOString(), config: cfg }, null, 2);
}

export function parseTenantJson(text: string): { value: TenantConfig | null; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { value: null, errors: ["Le fichier n'est pas un JSON valide."] };
  }
  if (!isObj(raw) || raw.format !== TEMPLATE_FORMAT) return { value: null, errors: [`Format inconnu : un modèle exporté par l'application est attendu (« format »: « ${TEMPLATE_FORMAT} »).`] };
  // A v2 template predates the sales module: it gets the default sales settings.
  if (raw.version === 2 && isObj(raw.config)) return checkTenantConfig(fromV2(raw.config));
  if (raw.version !== STORAGE_VERSION) return { value: null, errors: [`Version de modèle ${String(raw.version)} non prise en charge (attendue : ${STORAGE_VERSION}).`] };
  return checkTenantConfig(raw.config);
}

/* ---------------- localStorage ---------------- */

/** v1 stored the bare config, with a `rules.correctionTable` label and no profiles. */
function fromV1(raw: Obj): Obj {
  const rules: Obj = { ...DEFAULT_CONFIG.rules, ...(isObj(raw.rules) ? raw.rules : {}) };
  delete rules.correctionTable;
  return fromV2({ ...DEFAULT_CONFIG, ...raw, rules, correction: DEFAULT_CONFIG.correction });
}

/** v2 had no sales module: inject its defaults. */
function fromV2(raw: Obj): Obj {
  return { ...raw, sales: salesDefaultsFor(raw) };
}

/** Default values that changed: a stored config still holding the old default gets the new one. */
const RETIRED_ORDER_NUMBERING = "BC-{CENTRE}-{AAAA}-{N:5}";

function retireOldDefaults(cfg: TenantConfig): TenantConfig {
  const n = cfg.sales.workflow.numbering;
  if (n.order !== RETIRED_ORDER_NUMBERING) return cfg;
  return { ...cfg, sales: { ...cfg.sales, workflow: { ...cfg.sales.workflow, numbering: { ...n, order: DEFAULT_CONFIG.sales.workflow.numbering.order } } } };
}

export const storedConfig = (cfg: TenantConfig) => JSON.stringify({ version: STORAGE_VERSION, config: cfg });

/**
 * Reads whatever was persisted, migrating older versions. Never throws: anything
 * unreadable falls back to the demo configuration, with a notice for the user.
 */
export function migrateStoredConfig(text: string | null): { config: TenantConfig; migrated: boolean; notice: string | null } {
  if (text == null) return { config: DEFAULT_CONFIG, migrated: false, notice: null };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { config: DEFAULT_CONFIG, migrated: true, notice: "Configuration enregistrée illisible : configuration de démonstration restaurée." };
  }
  if (!isObj(raw)) return { config: DEFAULT_CONFIG, migrated: true, notice: "Configuration enregistrée illisible : configuration de démonstration restaurée." };

  const current = raw.version === STORAGE_VERSION;
  const candidate = current ? raw.config : raw.version === 2 ? (isObj(raw.config) ? fromV2(raw.config) : raw.config) : fromV1(raw);
  const checked = checkTenantConfig(candidate);
  if (checked.value) {
    const updated = retireOldDefaults(checked.value);
    return { config: updated, migrated: !current || updated !== checked.value, notice: null };
  }

  // Keep the rest of the tenant's settings if only the sales or correction part is broken.
  if (isObj(candidate)) {
    const withSales = { ...candidate, sales: salesDefaultsFor(candidate) };
    const salesOnly = checkTenantConfig(withSales);
    if (salesOnly.value) return { config: salesOnly.value, migrated: true, notice: "Paramètres de vente enregistrés invalides : valeurs par défaut restaurées." };
    const repaired = checkTenantConfig({
      ...withSales,
      correction: DEFAULT_CONFIG.correction,
      centres: Array.isArray(candidate.centres)
        ? candidate.centres.map((x) => (isObj(x) && Array.isArray(x.reservoirs) ? { ...x, reservoirs: x.reservoirs.map((t) => (isObj(t) ? { ...t, profileId: undefined } : t)) } : x))
        : candidate.centres,
    });
    if (repaired.value)
      return { config: repaired.value, migrated: true, notice: "Profils de correction enregistrés invalides : profils de démonstration restaurés." };
  }
  if (typeof console !== "undefined") console.warn("Stored config rejected", checked.errors);
  return { config: DEFAULT_CONFIG, migrated: true, notice: "Configuration enregistrée invalide : configuration de démonstration restaurée." };
}
