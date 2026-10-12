/* ------------------------------------------------------------------
   Sales and delivery domain. Plain data only: money is integer F CFA,
   bulk is integer kg, dates are yyyy-mm-dd and instants ISO strings.
   Type names in English, enum values in French uppercase.
   ------------------------------------------------------------------ */

/** Integer amount in the tenant's currency (F CFA by default). Never a float. */
export type Money = number;

/** Pseudo format id for bulk lines: quantities in kg, prices per kg. */
export const BULK = "vrac";

/** Pseudo brand for empties whose brand cannot be identified at the gate. Never fillable. */
export const UNKNOWN_BRAND = "inconnue";

/* ---------------- tenant configuration ---------------- */

export interface Brand {
  id: string;
  name: string;
  own: boolean; // exactly one brand is the tenant's own
  deposit: Record<string, Money>; // consigne per bottle and format, may differ by brand
}

export type PaymentTermKind = "COMPTANT" | "DIFFERE";
export interface PaymentTerm {
  kind: PaymentTermKind;
  days: number; // 0 when COMPTANT
}
export type PaymentMethod = "ESPECES" | "VIREMENT" | "CHEQUE" | "MOBILE_MONEY" | "EFFET";
export type BillingTrigger = "A_L_EXPEDITION" | "A_LA_VENTE";
export type PaymentTrigger = "A_CHAQUE_PASSAGE" | "PERIODIQUE" | "A_L_ECHEANCE";
export type Invoicing = "PAR_PASSAGE" | "RELEVE_PERIODIQUE";

export interface ContractTerms {
  payment: PaymentTerm;
  methods: PaymentMethod[];
  creditLimit: Money;
  guarantees: Money; // caution or deposit held
  priceListId: string;
  billing: BillingTrigger;
  paymentTrigger: PaymentTrigger;
  invoicing: Invoicing;
  floatCap: Record<string, number>; // consignment: max fulls held per format, empty = no cap
  inactivityDays: number | null; // overrides the category and tenant defaults
}

export type Decision = "ALLOW" | "WARN" | "APPROVAL" | "BLOCK";

/** What happens when a customer of the category exceeds its limit or pays late. */
export interface CreditRule {
  onLimit: Exclude<Decision, "ALLOW">;
  overdueDays: number; // tolerated lateness before onOverdue applies
  onOverdue: Exclude<Decision, "ALLOW">;
}

export type CategoryKind = "STANDARD" | "GROSSISTE";
export interface CustomerCategory {
  id: string;
  label: string;
  kind: CategoryKind;
  defaults: ContractTerms;
  credit: CreditRule;
  inactivityDays: number | null; // wholesalers: overrides the tenant default
}

export interface PriceLine {
  formatId: string; // a bottle format id, or BULK
  from: string; // yyyy-mm-dd, effective from
  price: Money; // per bottle, or per kg for BULK
}
export interface PriceList {
  id: string;
  label: string;
  lines: PriceLine[];
}

export type WorkflowStep = "creditCheck" | "prepayment" | "approval" | "reserveOnConfirm" | "gateInspection" | "weighbridge" | "proofOfDelivery" | "accountingExport";

export interface WorkflowConfig {
  version: number; // bumped on every change, stored on each order
  steps: Record<WorkflowStep, boolean>;
  approvalThreshold: Money; // order amount above which a manager approves
  numbering: { order: string; dispatch: string; settlement: string };
}

export interface SolvencyConfig {
  weights: { delay: number; overdue: number; utilization: number; incidents: number };
  okFrom: number; // score 0–100, at or above: solvable
  warnFrom: number; // at or above: à surveiller; below: à justifier
  lookbackDays: number;
}

export type LadderAction = "TACHE" | "NOTIFIER" | "BLOQUER";
export interface LadderStep {
  day: number;
  action: LadderAction;
}

export interface ConsignmentConfig {
  inactivityDays: number;
  ladder: LadderStep[];
  priceBasis: "SETTLEMENT" | "PLACEMENT";
  varianceTolerancePct: number;
  countEveryDays: number;
  balanceBasis: "FORMAT" | "BRAND";
}

/** Service targets behind the ok / warn / alert tones of the dashboards. */
export interface Targets {
  fillRate: [number, number]; // % at or above: ok, at or above: warn
  otif: [number, number];
  mape: [number, number]; // % at or below: ok, at or below: warn
  capacityWarnPct: number; // fill plan: line load above this is "à surveiller"
}

export interface StockConfig {
  backorder: "RELIQUAT" | "BLOQUER";
  safetyDays: number;
  atpHorizonDays: number;
}

export interface ReasonCode {
  code: string;
  label: string;
}

export interface ReasonLists {
  variance: ReasonCode[];
  reliquat: ReasonCode[];
  adjustment: ReasonCode[];
}

export interface ReportTemplate {
  placeholder: boolean; // true until the real specification is supplied
  title: string;
  header: string;
  filename: string; // pattern: {CENTRE} {DATE} {AAAA} {MM} {JJ}
  columns: string[];
  separator: string;
}

export type Action = "credit.override" | "order.approve" | "order.cancel" | "day.close" | "settlement.validate" | "variance.approve" | "forecast.edit" | "price.edit";

export interface Role {
  id: string;
  label: string;
  person: string; // demo user shown when the role is picked
}

export interface SalesConfig {
  currency: { code: string; label: string };
  brands: Brand[];
  categories: CustomerCategory[];
  priceLists: PriceList[];
  workflow: WorkflowConfig;
  solvency: SolvencyConfig;
  consignment: ConsignmentConfig;
  stock: StockConfig;
  targets: Targets;
  reasons: ReasonLists;
  reports: { authority: ReportTemplate; sage: ReportTemplate };
  roles: Role[];
  permissions: Record<Action, string[]>; // role ids allowed
  openingStock: Record<string, Record<string, number>>; // centre → format → own fulls at the start of the ledger
}

/* ---------------- master data ---------------- */

export interface Customer {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  contact: { name: string; phone: string };
  zone: string;
  centreIds: string[];
  active: boolean;
  rep: string; // sales rep following the account
}

export interface Contract {
  id: string;
  customerId: string;
  version: number;
  validFrom: string; // yyyy-mm-dd
  validTo: string | null;
  terms: ContractTerms;
  createdBy: string;
  createdAt: string;
}

/* ---------------- forecasts ---------------- */

export type ForecastScope = "CLIENT" | "CATEGORIE" | "ZONE";
export interface ForecastLine {
  period: string; // yyyy-Www or yyyy-mm
  formatId: string;
  scope: ForecastScope;
  key: string; // customer id, category id or zone name
  qty: number;
}
export interface Forecast {
  id: string;
  centreId: string;
  granularity: "SEMAINE" | "MOIS";
  version: number;
  basis: "INITIALE" | "REVISION";
  createdBy: string;
  createdAt: string;
  lines: ForecastLine[];
}

/* ---------------- orders and dispatches ---------------- */

export type OrderStatus = "BROUILLON" | "CONFIRMEE" | "EXPEDIEE" | "LIVREE" | "CLOTUREE" | "ANNULEE";
export type DeliveryMode = "ENLEVEMENT" | "LIVRAISON";

export interface OrderLine {
  formatId: string; // bottle format or BULK
  qty: number; // bottles, or kg for BULK
  price: Money; // unit price locked when the line was priced
}

export interface Reliquat {
  formatId: string;
  qty: number;
  reason: string; // reliquat reason code
  at: string;
  by: string;
}

export interface Approval {
  required: boolean;
  reasons: string[];
  by: string | null;
  at: string | null;
  note: string | null; // the approver's or overrider's justification
}

export interface DocEvent {
  at: string;
  by: string;
  label: string;
  note?: string;
}

export interface Order {
  id: string;
  number: string;
  centreId: string;
  customerId: string;
  contractVersion: number;
  workflowVersion: number;
  mode: DeliveryMode;
  date: string; // requested date
  createdAt: string;
  createdBy: string;
  lines: OrderLine[];
  status: OrderStatus;
  approval: Approval;
  reliquats: Reliquat[];
  history: DocEvent[];
  replaces: string | null; // id of the cancelled order this one rectifies
  replacedBy: string | null;
  exported: boolean; // sent to accounting
}

export type DispatchStatus = "PLANIFIE" | "EN_CHARGEMENT" | "CHARGE" | "EXPEDIE" | "LIVRE";

export interface Confirmation {
  name: string;
  code: string;
  role: string; // "Magasinier", "Chauffeur", "Client"…
  at: string;
}

/** brand id → format id → bottles */
export type BrandGrid = Record<string, Record<string, number>>;

export interface Dispatch {
  id: string;
  number: string;
  orderId: string;
  centreId: string;
  customerId: string;
  truck: string;
  driver: string;
  slot: string; // ISO
  status: DispatchStatus;
  empties: BrandGrid; // received at the gate, brand identified; UNKNOWN_BRAND when it cannot be
  damaged: BrandGrid; // received but condemned on arrival
  loaded: Record<string, number>; // fulls loaded per format; kg for BULK
  weighing: { tareKg: number; grossKg: number } | null;
  gateIn: Confirmation[];
  loading: Confirmation[];
  delivery: Confirmation[];
  dispute: string | null; // disputed gate count, kept with the record
  history: DocEvent[];
}

/* ---------------- ledgers ---------------- */

export type BottleState = "PLEIN" | "VIDE" | "CASSE";

/** Where bottles sit: a centre, or a customer holding consignment stock. */
export type SiteId = `centre:${string}` | `client:${string}`;

export type MovementKind =
  | "OUVERTURE" // opening balance
  | "PRODUCTION" // derived from closed inventories, never entered
  | "VIDES_ENTREE" // empties received at the gate
  | "PLEINS_SORTIE" // fulls leaving with a customer
  | "PLACEMENT" // fulls placed at a wholesaler (two sites)
  | "VENTE_CONSIGNATION" // fulls sold by a wholesaler, from its site
  | "RETOUR_PLEINS"
  | "CASSE" // damaged or condemned
  | "ECHANGE" // settlement with another company: their empties for ours
  | "AJUSTEMENT"; // count adjustment, always with a reason

export interface BottleMovement {
  id: string;
  ts: string;
  site: SiteId;
  state: BottleState;
  brand: string;
  formatId: string;
  kind: MovementKind;
  qty: number; // signed: + in, − out
  refs: { customerId?: string; orderId?: string; dispatchId?: string; settlementId?: string; countId?: string };
  by: string;
  confirmedBy?: string;
  reason?: string; // required for AJUSTEMENT and reversals
  reverses?: string; // id of the movement this one cancels
}

export type EntryKind = "DEBIT" | "CREDIT";
export interface AccountEntry {
  id: string;
  customerId: string;
  ts: string;
  kind: EntryKind;
  amount: Money; // always positive; kind gives the direction
  dueDate: string | null; // debits only
  method?: PaymentMethod; // credits only
  label: string;
  refs: { orderId?: string; dispatchId?: string; settlementId?: string };
  by: string;
  reason?: string;
  reverses?: string;
}

export type IncidentKind = "CHEQUE_IMPAYE" | "LITIGE";
export interface Incident {
  id: string;
  customerId: string;
  ts: string;
  kind: IncidentKind;
  note: string;
  by: string;
}

/* ---------------- consignment and stock control ---------------- */

export type SettlementStatus = "CONFIRME" | "ANNULE";
export interface Settlement {
  id: string;
  number: string;
  customerId: string;
  centreId: string;
  ts: string;
  empties: BrandGrid; // returned, any brand
  sold: Record<string, number>; // = empties per format, whatever the brand
  given: Record<string, number>; // fulls handed over
  amount: Money;
  paid: { amount: Money; method: PaymentMethod } | null;
  confirmations: Confirmation[];
  status: SettlementStatus;
  statementId: string | null; // periodic invoicing: the statement that billed it
  by: string;
}

export type CountStatus = "A_VALIDER" | "VALIDE" | "REJETE";
export interface CountSheet {
  id: string;
  site: SiteId;
  ts: string;
  by: string;
  state: BottleState; // what was counted (fulls at a wholesaler; any state at a centre)
  counted: BrandGrid;
  expected: BrandGrid; // theoretical, frozen when the count was entered
  reason: string | null;
  note: string;
  status: CountStatus;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface Declaration {
  id: string;
  customerId: string;
  ts: string;
  by: string;
  sold: Record<string, number>;
  note: string;
}

export type CallOutcome = "JOINT" | "INJOIGNABLE" | "RAPPELER" | "PASSAGE_PROMIS";
export interface CallLog {
  id: string;
  customerId: string;
  ts: string;
  by: string;
  outcome: CallOutcome;
  promised: string | null; // yyyy-mm-dd
  note: string;
}

export interface DayClose {
  id: string; // `${centreId}_${date}`
  centreId: string;
  date: string;
  at: string;
  by: string;
  rows: ReportRow[]; // frozen authority-report rows
}

/** One authority-report row: a brand × format at a centre over a day. */
export interface ReportRow {
  brand: string;
  formatId: string;
  opening: number;
  in: number;
  out: number;
  closing: number;
  fulls: number;
  empties: number;
  damaged: number;
}

/* ---------------- the whole sales state ---------------- */

export interface SalesData {
  customers: Customer[];
  contracts: Contract[];
  forecasts: Forecast[];
  orders: Order[];
  dispatches: Dispatch[];
  movements: BottleMovement[];
  entries: AccountEntry[];
  incidents: Incident[];
  settlements: Settlement[];
  counts: CountSheet[];
  declarations: Declaration[];
  calls: CallLog[];
  closes: DayClose[];
}

export type Collection = keyof SalesData;
