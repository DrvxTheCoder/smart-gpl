import type { SalesConfig } from "./sales/types";

export type * from "./sales/types";

export type TankType = "SPHERE" | "CIGARE" | "CITERNE" | "AUTRE";
export type CalcMode = "AUTOMATIC" | "PERCENTAGE";
export type InventoryStatus = "EN_COURS" | "TERMINE";

export interface FlowField {
  id: string;
  label: string;
}

export interface ProductionLine {
  id: string;
  name: string;
  capacityTph: number;
}

export interface Reservoir {
  id: string;
  name: string;
  type: TankType;
  capacityM3: number;
  capacityT: number;
  heightMm: number;
  calcMode: CalcMode;
  profileId?: string; // correction profile override; falls back to the tenant default
}

export interface Centre {
  id: string;
  code: string;
  name: string;
  address: string;
  managers: string[];
  lines: ProductionLine[];
  reservoirs: Reservoir[];
  approFields: FlowField[];
  sortieFields: FlowField[];
}

export interface BottleType {
  id: string;
  label: string;
  kg: number;
}

export interface Rules {
  ecartOk: number; // % — at or below is "good"
  ecartWarn: number; // % — above this needs confirmation on close
  lunchBreakMin: number;
  stopTypes: string[];
}

export interface Branding {
  companyName: string;
  shortName: string;
  brand: string; // one hex, every shade derives from it
}

/* ---------------- temperature correction ---------------- */

/** One table row. `t` in °C (0.1 steps), `liquid` in t/m³ (subtracted from d15), `gas` in t/m³ at 1 bar absolute. */
export interface CorrectionRow {
  t: number;
  liquid: number;
  gas: number;
}

export type LiquidMethod = { method: "ADDITIVE_TABLE" } | { method: "LINEAR"; alpha: number };
export type GasMethod = { method: "COEFFICIENT_TABLE"; pressureOffsetBar: number } | { method: "IDEAL_GAS"; molarMassKgMol: number };
export type OutOfRangePolicy = "BLOCK" | "WARN";
export type StockBasis = "LIQUID" | "TOTAL";

export interface CorrectionProfile {
  id: string;
  name: string;
  version: number; // incremented on every edit
  product: string;
  source: string; // exact normative reference of the table
  d15Range?: [number, number];
  liquid: LiquidMethod;
  gas: GasMethod;
  rows: CorrectionRow[]; // required by the table methods
  outOfRange: OutOfRangePolicy;
  stockBasis: StockBasis;
}

export interface CorrectionConfig {
  profiles: CorrectionProfile[];
  defaultProfileId: string;
}

export interface TenantConfig {
  branding: Branding;
  rules: Rules;
  bottleTypes: BottleType[];
  centres: Centre[];
  correction: CorrectionConfig;
  sales: SalesConfig;
}

export interface TankReading {
  heightMm: number;
  tLiq: number;
  tVap: number;
  volLiqM3: number;
  pressureBar: number;
  d15: number;
}

export interface TankResult {
  blocked: false;
  profileId: string;
  profileVersion: number;
  liquidFactor: number; // liquid correction, t/m³ (d15 − ambient density)
  gasCoefficient: number; // gas density at 1 bar absolute, t/m³
  vcf: number; // equivalent multiplicative factor: densAmb / d15
  vapFactor: number; // gas density at the reading's pressure, t/m³
  densAmb: number; // t/m³ at ambient
  liquidT: number;
  gasT: number;
  totalT: number;
  stockT: number; // what counts toward the physical stock (profile's stockBasis)
  fillPct: number; // liquid, of capacity in tonnes
  warnings: string[];
}

/** BLOCK policy, reading outside the table: no result for the tank. */
export interface TankBlocked {
  blocked: true;
  profileId: string;
  profileVersion: number;
  warnings: string[];
}

export type TankOutcome = TankResult | TankBlocked;

/** Factors frozen when the inventory is closed, so later profile edits never rewrite history. */
export interface InventoryClosing {
  profileId: string;
  profileVersion: number;
  tanks: Record<string, TankResult>;
  warnings: string[];
}

export interface Stop {
  id: string;
  type: string;
  minutes: number;
  note: string;
  author: string;
  at: string; // ISO
}

export interface VehicleCounts {
  decharges: [number, number]; // [COM, LIV]
  charges: [number, number];
  nonDecharges: [number, number];
  dechargesNonCharges: [number, number];
  notes: string;
}

export interface NightShift {
  enabled: boolean;
  thtMin: number;
  taMin: number;
  lineIds: string[];
  bottles: Record<string, number>;
}

export interface Inventory {
  id: string; // `${centreId}_${yyyy-mm-dd}`
  centreId: string;
  date: string; // yyyy-mm-dd
  status: InventoryStatus;
  startedBy: string;
  stockInitial: number;
  heureDebut: string; // HH:mm
  heureFin: string; // HH:mm or ""
  appro: Record<string, number>;
  sorties: Record<string, number>;
  bottles: Record<string, number>;
  night: NightShift;
  tanks: Record<string, TankReading>;
  stops: Stop[];
  vehicles: VehicleCounts;
  notes: string;
  pausedAt?: string; // ISO — an arrêt is running on the live timer
  closing?: InventoryClosing; // written when status becomes TERMINE
}
