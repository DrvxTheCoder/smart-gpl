import { fmtMoney } from "../format";
import { mulberry32 } from "../seed";
import type { Inventory, TenantConfig } from "../types";
import { adjustmentsFor, centreSite, clientSite, ownBrand, siteBalance } from "./bottle-ledger";
import { passage } from "./consignment";
import { at, daysBetween, isoWeek, shiftDate, weekRange, ymd } from "./dates";
import { closeId, reportRows } from "./day-close";
import { dueDate } from "./exposure";
import { applyEvents, formatNumber, type SalesEvent } from "./lifecycle";
import { linesAmount, priceFor } from "./pricing";
import { openingMovements, producedBottles, productionMovements, LEDGER_DAYS } from "./stock";
import {
  BULK,
  UNKNOWN_BRAND,
  type AccountEntry,
  type BottleMovement,
  type BrandGrid,
  type CallLog,
  type Confirmation,
  type Contract,
  type ContractTerms,
  type CountSheet,
  type Customer,
  type DayClose,
  type Declaration,
  type Dispatch,
  type Forecast,
  type Incident,
  type ForecastLine,
  type Order,
  type OrderLine,
  type PaymentMethod,
  type SalesData,
  type Settlement,
} from "./types";

/* ------------------------------------------------------------------
   Demo sales for the fictional tenant, deterministic for a given day and
   driven by the production inventories: what customers take each day
   tracks the previous production day, so fulls reconcile. A few cases
   are deliberately imperfect, to exercise the screens.
   ------------------------------------------------------------------ */

type Qty = Record<string, number>;

interface SeedCustomer {
  id: string;
  name: string;
  cat: string;
  centre: string;
  zone: string;
  contact: [string, string];
  rep: string;
  share: number; // of the centre's daily sales
  every: number; // days between orders or passages
  own: number; // share of own-brand empties returned
  formats?: string[];
  term?: ContractTerms["payment"];
  limit: number;
  payDelay: number | null; // days after the due date it pays; null: it stopped paying
  mode: "ENLEVEMENT" | "LIVRAISON";
  bulk?: boolean;
  patch?: Partial<ContractTerms>;
}

const SMALL = ["b27", "b6", "b125"];
const HEAVY = ["b125", "b38"];

const CUSTOMERS: SeedCustomer[] = [
  { id: "c01", name: "Comptoir Ndiaye & Fils", cat: "distributeur", centre: "ruf", zone: "Rufisque", contact: ["Mamadou Ndiaye", "77 412 33 18"], rep: "Fatou Diop", share: 0.3, every: 2, own: 0.8, limit: 900_000_000, payDelay: 2, mode: "LIVRAISON" },
  { id: "c02", name: "Distrigaz Thiès", cat: "distributeur", centre: "ruf", zone: "Thiès", contact: ["Aminata Faye", "77 530 18 44"], rep: "Fatou Diop", share: 0.22, every: 3, own: 0.76, term: { kind: "DIFFERE", days: 60 }, limit: 1_400_000_000, payDelay: -4, mode: "LIVRAISON" },
  { id: "c03", name: "Saloum Distribution", cat: "distributeur", centre: "kao", zone: "Kaolack", contact: ["Babacar Sène", "76 281 09 73"], rep: "Pape Gueye", share: 0.4, every: 2, own: 0.78, limit: 450_000_000, payDelay: 12, mode: "LIVRAISON" },
  { id: "c04", name: "Station Corniche Ouest", cat: "station", centre: "ruf", zone: "Dakar", contact: ["Khady Diallo", "78 102 55 61"], rep: "Fatou Diop", share: 0.06, every: 1, own: 0.82, formats: SMALL, term: { kind: "COMPTANT", days: 0 }, limit: 20_000_000, payDelay: 0, mode: "ENLEVEMENT", patch: { methods: ["ESPECES", "MOBILE_MONEY"] } },
  { id: "c05", name: "Relais de Mbour", cat: "station", centre: "ruf", zone: "Mbour", contact: ["Ibou Thiam", "77 640 72 20"], rep: "Fatou Diop", share: 0.08, every: 2, own: 0.35, formats: SMALL, limit: 220_000_000, payDelay: 4, mode: "ENLEVEMENT" },
  { id: "c06", name: "Station Kaffrine Nord", cat: "station", centre: "kao", zone: "Kaffrine", contact: ["Seynabou Ka", "76 455 31 08"], rep: "Pape Gueye", share: 0.2, every: 3, own: 0.74, formats: SMALL, limit: 200_000_000, payDelay: 20, mode: "LIVRAISON" },
  { id: "c07", name: "Boulangeries Réunies du Cap-Vert", cat: "industriel", centre: "ruf", zone: "Dakar", contact: ["Jean-Pierre Mendy", "33 821 40 12"], rep: "Cheikh Mbaye", share: 0.06, every: 3, own: 0.85, formats: HEAVY, limit: 900_000_000, payDelay: 0, mode: "LIVRAISON", bulk: true },
  { id: "c08", name: "Huilerie du Sine", cat: "industriel", centre: "kao", zone: "Kaolack", contact: ["Modou Ndour", "33 941 22 87"], rep: "Pape Gueye", share: 0.1, every: 4, own: 0.8, formats: HEAVY, term: { kind: "DIFFERE", days: 90 }, limit: 150_000_000, payDelay: null, mode: "LIVRAISON", bulk: true },
  { id: "g01", name: "Ets Mame Diarra Gaz", cat: "grossiste", centre: "ruf", zone: "Pikine", contact: ["Mame Diarra Sow", "77 208 64 90"], rep: "Fatou Diop", share: 0.12, every: 3, own: 0.7, formats: ["b27", "b6", "b9", "b125"], limit: 120_000_000, payDelay: 0, mode: "ENLEVEMENT" },
  { id: "g02", name: "Dépôt Keur Massar", cat: "grossiste", centre: "ruf", zone: "Keur Massar", contact: ["Alioune Badiane", "76 917 43 15"], rep: "Fatou Diop", share: 0.08, every: 4, own: 0.72, formats: ["b27", "b6", "b9", "b125"], limit: 90_000_000, payDelay: 0, mode: "ENLEVEMENT" },
  { id: "g03", name: "Alimentation Touba Gaz", cat: "grossiste", centre: "kao", zone: "Kaolack", contact: ["Serigne Mbacké", "77 361 80 27"], rep: "Pape Gueye", share: 0.3, every: 3, own: 0.68, formats: ["b27", "b6", "b9", "b125"], limit: 80_000_000, payDelay: 0, mode: "ENLEVEMENT" },
  {
    id: "g04",
    name: "Quincaillerie Ngor",
    cat: "grossiste",
    centre: "ruf",
    zone: "Ngor",
    contact: ["Ndèye Fatou Samb", "78 330 26 51"],
    rep: "Fatou Diop",
    share: 0.08,
    every: 4,
    own: 0.75,
    formats: ["b27", "b6", "b9", "b125"],
    term: { kind: "DIFFERE", days: 15 },
    limit: 240_000_000,
    payDelay: 3,
    mode: "ENLEVEMENT",
    patch: { invoicing: "RELEVE_PERIODIQUE", paymentTrigger: "PERIODIQUE", inactivityDays: 4 },
  },
];

const COMPETITOR_SPLIT = [0.5, 0.3, 0.2];
const DRIVERS = ["Lamine Diatta", "Samba Ndiaye", "Moustapha Cissé", "Daouda Faye", "Abdou Sarr", "Youssou Gaye"];
const STOREKEEPER: Record<string, string> = { ruf: "Ousmane Ba", kao: "Malick Diouf" };
const OPERATORS_BY_CENTRE: Record<string, string> = { ruf: "Awa Ndiaye", kao: "Ibrahima Sarr" };

const r10 = (n: number) => Math.max(Math.round(n / 10) * 10, 0);
const hash = (s: string) => s.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
const dow = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(y, m - 1, dd).getDay();
};
const sum = (q: Qty) => Object.values(q).reduce((a, b) => a + b, 0);

export function generateSales(cfg: TenantConfig, inventories: Inventory[], today = new Date()): SalesData {
  const sc = cfg.sales;
  const T = ymd(today);
  const start = shiftDate(T, -LEDGER_DAYS);
  const own = ownBrand(sc.brands);
  const competitors = sc.brands.filter((b) => !b.own).map((b) => b.id);
  const formats = cfg.bottleTypes.map((b) => b.id);
  const centreCode = (id: string) => cfg.centres.find((c) => c.id === id)?.code ?? id.toUpperCase();
  const rnd = mulberry32(hash(T) ^ 0x5ca1e);
  const seeds = CUSTOMERS.filter((c) => cfg.centres.some((x) => x.id === c.centre) && sc.categories.some((k) => k.id === c.cat));
  const category = (id: string) => sc.categories.find((k) => k.id === id)!;

  /* ---------- production by centre and day ---------- */
  const prod = new Map<string, Qty>(); // `${centre}|${date}`
  const vracKg = new Map<string, number>();
  for (const inv of inventories) {
    if (inv.status !== "TERMINE") continue;
    prod.set(`${inv.centreId}|${inv.date}`, producedBottles(inv));
    const field = cfg.centres.find((c) => c.id === inv.centreId)?.sortieFields[0]?.id;
    if (field) vracKg.set(`${inv.centreId}|${inv.date}`, Math.round((inv.sorties[field] ?? 0) * 1000));
  }
  const prevProduction = (centre: string, d: string): Qty => {
    for (let k = 1; k <= 7; k++) {
      const p = prod.get(`${centre}|${shiftDate(d, -k)}`);
      if (p) return p;
    }
    return {};
  };


  // Each format is shared among the customers allowed to buy it.
  const shareOf = (s: SeedCustomer, f: string) => {
    if (s.formats && !s.formats.includes(f)) return 0;
    const peers = seeds.filter((x) => x.centre === s.centre && (!x.formats || x.formats.includes(f)));
    return s.share / peers.reduce((a, x) => a + x.share, 0);
  };
  const isWholesaler = (s: SeedCustomer) => category(s.cat).kind === "GROSSISTE";

  /* ---------- customers and contracts ---------- */
  const customers: Customer[] = seeds.map((s, i) => ({
    id: s.id,
    code: `CL-${String(i + 1).padStart(3, "0")}`,
    name: s.name,
    categoryId: s.cat,
    contact: { name: s.contact[0], phone: s.contact[1] },
    zone: s.zone,
    centreIds: [s.centre],
    active: true,
    rep: s.rep,
  }));
  // A wholesaler's float covers about three and a half days of its sales; its cap leaves a quarter more.
  const floatOf = new Map<string, Qty>();
  for (const s of seeds.filter(isWholesaler)) {
    const p = prevProduction(s.centre, start);
    floatOf.set(s.id, Object.fromEntries(formats.map((f) => [f, r10((p[f] ?? 0) * shareOf(s, f) * 3.5)]).filter(([, n]) => (n as number) > 0)));
  }
  const termsOf = new Map<string, ContractTerms>();
  const contracts: Contract[] = [];
  for (const s of seeds) {
    const base = category(s.cat).defaults;
    const float = floatOf.get(s.id);
    const floatCap = float ? Object.fromEntries(Object.entries(float).map(([f, n]) => [f, Math.ceil((n * 1.25) / 100) * 100])) : base.floatCap;
    const terms: ContractTerms = { ...base, ...s.patch, payment: s.term ?? base.payment, creditLimit: s.limit, floatCap };
    termsOf.set(s.id, terms);
    const createdAt = at(shiftDate(start, -200), 9);
    if (s.id === "c01") {
      // Limit raised mid-period: two versions, each order keeps its own.
      const raisedOn = shiftDate(T, -45);
      contracts.push({ id: `k-${s.id}-1`, customerId: s.id, version: 1, validFrom: shiftDate(start, -200), validTo: shiftDate(raisedOn, -1), terms: { ...terms, creditLimit: 700_000_000 }, createdBy: "Cheikh Mbaye", createdAt });
      contracts.push({ id: `k-${s.id}-2`, customerId: s.id, version: 2, validFrom: raisedOn, validTo: null, terms, createdBy: "Cheikh Mbaye", createdAt: at(raisedOn, 10) });
    } else contracts.push({ id: `k-${s.id}-1`, customerId: s.id, version: 1, validFrom: shiftDate(start, -200), validTo: null, terms, createdBy: "Cheikh Mbaye", createdAt });
  }
  const versionAt = (id: string, d: string) => contracts.filter((k) => k.customerId === id && k.validFrom <= d && (k.validTo == null || k.validTo >= d)).sort((a, b) => b.version - a.version)[0]?.version ?? 1;
  const price = (id: string, f: string, d: string) => priceFor(sc.priceLists, termsOf.get(id)!.priceListId, f, d) ?? 0;

  /* ---------- simulation ---------- */
  const orders: Order[] = [];
  const dispatches: Dispatch[] = [];
  const settlements: Settlement[] = [];
  const counts: CountSheet[] = [];
  const events: SalesEvent[] = [];
  const movements: BottleMovement[] = [];
  const need = new Map<string, Qty>(seeds.map((s) => [s.id, {}]));
  const last = new Map<string, string>();
  const competitorStock: Record<string, BrandGrid> = {};
  // Own fulls on hand, so no truck leaves with bottles the centre does not have.
  const avail: Record<string, Qty> = Object.fromEntries(cfg.centres.map((c) => [c.id, { ...(sc.openingStock[c.id] ?? {}) }]));
  const take = (centre: string, want: Qty): Qty => {
    const got: Qty = {};
    for (const [f, n] of Object.entries(want)) {
      if (f === BULK) {
        got[f] = n;
        continue;
      }
      got[f] = Math.min(n, Math.max(Math.floor((avail[centre][f] ?? 0) / 10) * 10, 0));
      avail[centre][f] = (avail[centre][f] ?? 0) - got[f];
    }
    return got;
  };

  const conf = (name: string, role: string, ts: string): Confirmation => ({ name, role, code: `${role.slice(0, 3).toUpperCase()}-${String(Math.abs(hash(name)) % 90 + 10)}`, at: ts });

  /** n empties split by brand: own share, competitors 50/30/20, a few unidentifiable. */
  const split = (n: number, ownShare: number): [string, number][] => {
    const unknown = Math.round(n * 0.003);
    const ownN = Math.round((n - unknown) * ownShare);
    let rest = n - unknown - ownN;
    const out: [string, number][] = [[own, ownN]];
    competitors.forEach((b, i) => {
      const q = i === competitors.length - 1 ? rest : Math.round((n - unknown - ownN) * (COMPETITOR_SPLIT[i] ?? 0));
      rest -= q;
      out.push([b, q]);
    });
    if (unknown) out.push([UNKNOWN_BRAND, unknown]);
    return out.filter(([, q]) => q > 0);
  };
  const gridFor = (byFmt: Qty, ownShare: number): BrandGrid => {
    const g: BrandGrid = {};
    for (const [f, n] of Object.entries(byFmt)) if (n && f !== BULK) for (const [b, q] of split(n, ownShare)) (g[b] ??= {})[f] = q;
    return g;
  };
  // Competitor empties pile up at the gate until the Saturday exchange.
  const received = (centre: string, g: BrandGrid) => {
    for (const [b, row] of Object.entries(g)) {
      if (!competitors.includes(b)) continue;
      for (const [f, n] of Object.entries(row)) ((competitorStock[centre] ??= {})[b] ??= {})[f] = (competitorStock[centre]?.[b]?.[f] ?? 0) + n;
    }
  };

  const addOrder = (o: Omit<Order, "number" | "workflowVersion" | "contractVersion" | "approval" | "reliquats" | "filled" | "history" | "replaces" | "replacedBy" | "exported"> & Partial<Order>): Order => {
    const order: Order = {
      number: "",
      workflowVersion: sc.workflow.version,
      contractVersion: versionAt(o.customerId, o.date),
      approval: { required: false, reasons: [], by: null, at: null, note: null },
      reliquats: [],
      filled: {},
      history: [{ at: o.createdAt, by: o.createdBy, label: "Commande créée" }],
      replaces: null,
      replacedBy: null,
      exported: false,
      ...o,
    };
    orders.push(order);
    return order;
  };

  const linesFor = (s: SeedCustomer, qty: Qty, d: string): OrderLine[] =>
    formats.filter((f) => (qty[f] ?? 0) > 0).map((f) => ({ formatId: f, qty: qty[f], price: price(s.id, f, d) }));

  /** A truck for an order: gate, loading, expedition and (past days) delivery. */
  const ship = (s: SeedCustomer, order: Order, wanted: Qty, d: string, hour: number, upTo: "PLANIFIE" | "EN_CHARGEMENT" | "CHARGE" | "LIVRE", suffix = "d1") => {
    const id = `${order.id}-${suffix}`;
    // Only an expedited truck takes stock; what the centre lacks becomes a reliquat.
    const loaded = upTo === "LIVRE" ? take(s.centre, wanted) : wanted;
    for (const [f, n] of Object.entries(wanted)) {
      const short = n - (loaded[f] ?? 0);
      if (short > 0) {
        order.reliquats.push({ formatId: f, qty: short, reason: "STOCK", at: at(d, hour), by: STOREKEEPER[s.centre] ?? "Magasinier" });
        order.history.push({ at: at(d, hour), by: STOREKEEPER[s.centre] ?? "Magasinier", label: "Reliquat déclaré", note: "Stock insuffisant" });
      }
    }
    const slot = at(d, hour, rnd() > 0.5 ? 30 : 0);
    const driver = DRIVERS[Math.floor(rnd() * DRIVERS.length)];
    const bulk = !!loaded[BULK];
    const returned: Qty = {};
    for (const [f, n] of Object.entries(loaded)) if (f !== BULK) returned[f] = Math.round(n * (0.97 + rnd() * 0.03));
    const empties = bulk ? {} : gridFor(returned, s.own);
    const damaged: BrandGrid = {};
    if (!bulk) for (const [f, n] of Object.entries(returned)) if (n > 300 && rnd() > 0.6) (damaged[own] ??= {})[f] = Math.max(Math.round(n * 0.002), 1);
    const tare = 14_200 + Math.round(rnd() * 900);
    const disp: Dispatch = {
      id,
      number: "",
      orderId: order.id,
      centreId: s.centre,
      customerId: s.id,
      truck: `${s.centre === "kao" ? "KL" : "DK"}-${1000 + (Math.abs(hash(s.id + suffix)) % 8999)}-${String.fromCharCode(65 + (hash(s.id) & 15))}${String.fromCharCode(65 + (hash(driver) & 15))}`,
      driver,
      slot,
      status: upTo,
      empties: upTo === "PLANIFIE" ? {} : empties,
      damaged: upTo === "PLANIFIE" ? {} : damaged,
      loaded,
      weighing: bulk && (upTo === "CHARGE" || upTo === "LIVRE") ? { tareKg: tare, grossKg: tare + loaded[BULK] } : null,
      gateIn: upTo === "PLANIFIE" || bulk ? [] : [conf(STOREKEEPER[s.centre] ?? "Magasinier", "Magasinier", slot), conf(driver, "Chauffeur", slot)],
      loading: upTo === "CHARGE" || upTo === "LIVRE" ? [conf(STOREKEEPER[s.centre] ?? "Magasinier", "Magasinier", at(d, hour + 1))] : [],
      delivery: upTo === "LIVRE" && order.mode === "LIVRAISON" ? [conf(s.contact[0], "Client", at(d, hour + 3))] : [],
      dispute: null,
      history: [{ at: at(d, hour - 1), by: "Cheikh Mbaye", label: "Expédition planifiée" }],
    };
    dispatches.push(disp);
    const refs = { orderId: order.id, dispatchId: id };
    const by = STOREKEEPER[s.centre] ?? "Magasinier";
    if (upTo !== "PLANIFIE" && !bulk) received(s.centre, empties);
    if (upTo !== "PLANIFIE" && !bulk) events.push({ type: "EMPTIES_IN", docId: id, customerId: s.id, centreId: s.centre, ts: slot, by, refs, empties, damaged, confirmedBy: disp.gateIn.map((g) => g.name).join(", ") });
    if (upTo === "LIVRE") {
      const ts = at(d, hour + 1, 30);
      events.push({ type: "FULLS_OUT", docId: id, customerId: s.id, centreId: s.centre, own, ts, by, refs, qty: loaded, consignment: isWholesaler(s) });
      const terms = termsOf.get(s.id)!;
      if (terms.billing === "A_L_EXPEDITION") {
        const amount = linesAmount(order.lines.map((l) => ({ qty: loaded[l.formatId] ?? 0, price: l.price })));
        events.push({ type: "BILL", docId: id, customerId: s.id, ts, by, refs, amount, dueDate: dueDate(d, terms.payment), label: `BL ${id}` });
      }
      disp.history.push({ at: ts, by, label: "BL émis, camion expédié" });
      if (disp.delivery.length) disp.history.push({ at: at(d, hour + 3), by: s.contact[0], label: "Livraison confirmée par le client" });
    }
    return disp;
  };

  // Opening stock beyond configured fulls: own empties to fill, a few competitor empties.
  for (const c of cfg.centres) {
    const p = prevProduction(c.id, start);
    for (const f of formats) {
      const ownEmpty = Math.round((p[f] ?? 0) * 5);
      if (ownEmpty) movements.push({ id: `open:${c.id}:${f}:v`, ts: at(start, 0), site: centreSite(c.id), state: "VIDE", brand: own, formatId: f, kind: "OUVERTURE", qty: ownEmpty, refs: {}, by: "Reprise du stock" });
      competitors.forEach((b, i) => {
        const n = Math.round((p[f] ?? 0) * 0.12 * (COMPETITOR_SPLIT[i] ?? 0.1));
        if (n) {
          movements.push({ id: `open:${c.id}:${f}:${b}`, ts: at(start, 0), site: centreSite(c.id), state: "VIDE", brand: b, formatId: f, kind: "OUVERTURE", qty: n, refs: {}, by: "Reprise du stock" });
          ((competitorStock[c.id] ??= {})[b] ??= {})[f] = n;
        }
      });
    }
  }

  // Wholesalers start with a float placed on the first day.
  for (const s of seeds.filter(isWholesaler)) {
    const qty = floatOf.get(s.id) ?? {};
    const o = addOrder({ id: `o-${s.id}-float`, centreId: s.centre, customerId: s.id, mode: "ENLEVEMENT", date: start, createdAt: at(start, 7, 30), createdBy: s.rep, lines: linesFor(s, qty, start), status: "CLOTUREE", exported: true });
    ship(s, o, qty, start, 8, "LIVRE");
    last.set(s.id, start);
  }

  const lateWholesaler = "g02";
  const planted = new Set<string>(); // the one-off imperfect cases, placed once
  for (let d = start; d <= T; d = shiftDate(d, 1)) {
    if (dow(d) === 0) continue;
    const age = daysBetween(d, T); // 0 today
    for (const c of cfg.centres) {
      const p = prevProduction(c.id, d);
      const factor = 0.94 + rnd() * 0.1;
      for (const s of seeds) {
        if (s.centre !== c.id) continue;
        const q = need.get(s.id)!;
        for (const f of formats) q[f] = (q[f] ?? 0) + (p[f] ?? 0) * factor * shareOf(s, f);
      }

      // Every Saturday the storekeeper settles competitor empties against our own.
      if (dow(d) === 6 && age > 0) {
        const stock = competitorStock[c.id] ?? {};
        for (const [b, row] of Object.entries(stock))
          for (const [f, n] of Object.entries(row)) {
            const back = n;
            if (back <= 0) continue;
            const ts = at(d, 12);
            movements.push({ id: `ech:${c.id}:${d}:${b}:${f}:out`, ts, site: centreSite(c.id), state: "VIDE", brand: b, formatId: f, kind: "ECHANGE", qty: -back, refs: {}, by: STOREKEEPER[c.id] ?? "Magasinier", reason: `Échange avec ${sc.brands.find((x) => x.id === b)?.name ?? b}` });
            movements.push({ id: `ech:${c.id}:${d}:${b}:${f}:in`, ts, site: centreSite(c.id), state: "VIDE", brand: own, formatId: f, kind: "ECHANGE", qty: back, refs: {}, by: STOREKEEPER[c.id] ?? "Magasinier", reason: `Échange avec ${sc.brands.find((x) => x.id === b)?.name ?? b}` });
            row[f] = n - back;
          }
      }
    }

    for (const s of seeds) {
      const q = need.get(s.id)!;
      const since = daysBetween(last.get(s.id) ?? shiftDate(start, -s.every), d);
      const due = since >= s.every + (rnd() > 0.8 ? 1 : 0);
      const terms = termsOf.get(s.id)!;

      if (isWholesaler(s)) {
        if (!due || (s.id === lateWholesaler && age < 9) || (age === 0 && s.id !== "g01")) continue;
        // A passage: everything sold since the last visit comes back as empties.
        const sold: Qty = {};
        for (const f of formats) {
          sold[f] = r10(q[f] ?? 0);
          q[f] = (q[f] ?? 0) - sold[f];
        }
        if (!sum(sold)) continue;
        const empties = gridFor(sold, s.own);
        received(s.centre, empties);
        const id = `s-${s.id}-${d}`;
        const ts = at(d, 9 + Math.floor(rnd() * 6), 15);
        const amount = Object.entries(sold).reduce((a, [f, n]) => a + n * price(s.id, f, d), 0);
        const periodic = terms.invoicing === "RELEVE_PERIODIQUE";
        const given = take(s.centre, sold);
        const r = passage({
          given,
          id,
          number: "",
          customerId: s.id,
          centreId: s.centre,
          ts,
          by: s.rep,
          own,
          empties,
          price: (f) => price(s.id, f, d),
          terms,
          dueDate: dueDate(d, terms.payment),
          paid: periodic ? null : { amount, method: (rnd() > 0.5 ? "ESPECES" : "MOBILE_MONEY") as PaymentMethod },
          confirmations: [conf(s.rep, "Commerciale", ts), conf(s.contact[0], "Client", ts)],
        });
        settlements.push(r.settlement);
        events.push(...r.events);
        last.set(s.id, d);
        continue;
      }

      if (!due) continue;
      const qty: Qty = {};
      for (const f of formats) {
        const n = f === "b38" ? Math.round(q[f] ?? 0) : r10(q[f] ?? 0);
        if (n > 0) qty[f] = n;
        q[f] = (q[f] ?? 0) - n;
      }
      if (!sum(qty)) continue;
      last.set(s.id, d);
      const lines = linesFor(s, qty, d);
      const id = `o-${s.id}-${d}`;
      const hour = 8 + Math.floor(rnd() * 7);
      const createdAt = at(d, Math.max(hour - 1, 7), 10);
      const exported = age > 3;
      const closed = age > 7;

      // Today: live trucks in every state, and the deliberate open cases.
      if (age === 0) {
        if (s.id === "c02") {
          // An exceptional order above the approval threshold, waiting for a manager.
          const big = Object.fromEntries(Object.entries(qty).map(([f, n]) => [f, f === "b38" ? n * 3 : r10(n * 2.6)]));
          const bl = linesFor(s, big, d);
          const o = addOrder({ id, centreId: s.centre, customerId: s.id, mode: s.mode, date: d, createdAt, createdBy: s.rep, lines: bl, status: "CONFIRMEE" });
          o.approval = { required: true, reasons: [`Montant de ${fmtMoney(linesAmount(bl), sc.currency.label)} au-delà du seuil de validation (${fmtMoney(sc.workflow.approvalThreshold, sc.currency.label)}).`], by: null, at: null, note: null };
          o.history.push({ at: at(d, hour), by: s.rep, label: "Commande confirmée, en attente de validation" });
          ship(s, o, big, d, hour + 2, "PLANIFIE");
          continue;
        }
        const o = addOrder({ id, centreId: s.centre, customerId: s.id, mode: s.mode, date: d, createdAt, createdBy: s.rep, lines, status: "CONFIRMEE" });
        o.history.push({ at: createdAt, by: s.rep, label: "Commande confirmée" });
        const stage = s.id === "c01" ? "EN_CHARGEMENT" : s.id === "c03" ? "CHARGE" : "PLANIFIE";
        ship(s, o, qty, d, hour, stage);
        continue;
      }

      const o = addOrder({ id, centreId: s.centre, customerId: s.id, mode: s.mode, date: d, createdAt, createdBy: s.rep, lines, status: closed ? "CLOTUREE" : "LIVREE", exported });
      o.history.push({ at: createdAt, by: s.rep, label: "Commande confirmée" });
      if (terms.payment.kind === "COMPTANT") {
        // Cash customers pay before the truck loads.
        events.push({ type: "PAYMENT", docId: `pay-${id}`, customerId: s.id, ts: at(d, Math.max(hour - 1, 7), 40), by: s.rep, refs: { orderId: id }, amount: linesAmount(lines), method: rnd() > 0.5 ? "ESPECES" : "MOBILE_MONEY", label: `Règlement ${s.name}` });
      }
      if (s.id === "c05" && !planted.has("reliquat") && age >= 3 && age <= 5) {
        planted.add("reliquat");
        // The truck could not take everything: the rest becomes a reliquat.
        const sent = Object.fromEntries(Object.entries(qty).map(([f, n]) => [f, f === "b125" ? r10(n * 0.7) : n]));
        ship(s, o, sent, d, hour, "LIVRE");
        o.reliquats.push({ formatId: "b125", qty: qty.b125 - sent.b125, reason: "CAMION", at: at(d, hour + 1), by: STOREKEEPER.ruf });
        o.history.push({ at: at(d, hour + 1), by: STOREKEEPER.ruf, label: "Reliquat déclaré", note: "Capacité du camion" });
        o.status = "LIVREE";
        o.exported = true;
        continue;
      }
      if (s.id === "c06" && !planted.has("partial") && age >= 1 && age <= 4) {
        planted.add("partial");
        // Partially served, the rest still to load.
        const sent = Object.fromEntries(Object.entries(qty).map(([f, n]) => [f, r10(n * 0.6)]));
        ship(s, o, sent, d, hour, "LIVRE");
        o.status = "EXPEDIEE";
        o.exported = false;
        continue;
      }
      ship(s, o, qty, d, hour, "LIVRE");
    }

    // Bulk: industrial customers take the day's bulk outflow, by weighbridge.
    for (const s of seeds.filter((x) => x.bulk)) {
      if (s.id === "c08" && age < 6 && age > 0) continue;
      const kg = age === 0 ? 12_000 + Math.round(rnd() * 6) * 1000 : vracKg.get(`${s.centre}|${d}`) ?? 0;
      if (kg <= 0) continue;
      const id = `o-${s.id}-${d}-vrac`;
      const lines: OrderLine[] = [{ formatId: BULK, qty: kg, price: price(s.id, BULK, d) }];
      const createdAt = at(d, 7, 20);
      if (age === 0) {
        if (s.id === "c08") {
          // Over its limit with a long-overdue balance: the draft cannot be confirmed.
          addOrder({ id, centreId: s.centre, customerId: s.id, mode: "LIVRAISON", date: d, createdAt, createdBy: s.rep, lines, status: "BROUILLON" });
          continue;
        }
        const o = addOrder({ id, centreId: s.centre, customerId: s.id, mode: "LIVRAISON", date: d, createdAt, createdBy: s.rep, lines, status: "CONFIRMEE" });
        o.history.push({ at: createdAt, by: s.rep, label: "Commande confirmée" });
        ship(s, o, { [BULK]: kg }, d, 10, "PLANIFIE");
        continue;
      }
      const o = addOrder({ id, centreId: s.centre, customerId: s.id, mode: "LIVRAISON", date: d, createdAt, createdBy: s.rep, lines, status: age > 7 ? "CLOTUREE" : "LIVREE", exported: age > 3 });
      o.history.push({ at: createdAt, by: s.rep, label: "Commande confirmée" });
      ship(s, o, { [BULK]: kg }, d, 7, "LIVRE", "v1");
    }

    // The evening's production joins the fulls on hand.
    for (const c of cfg.centres) for (const [f, n] of Object.entries(prod.get(`${c.id}|${d}`) ?? {})) avail[c.id][f] = (avail[c.id][f] ?? 0) + n;
  }

  /* ---------- fill confirmations by production ---------- */
  // Past orders were filled for what actually left; today, the trucks at the
  // gate were filled, the rest waits in the production's queue.
  const filledToday = new Set(["c01", "c03", "c04"]);
  for (const o of orders) {
    if (o.status === "BROUILLON" || o.status === "ANNULEE") continue;
    const bottles = o.lines.filter((l) => l.formatId !== BULK);
    if (!bottles.length) continue;
    const sent: Qty = {};
    for (const d of dispatches) if (d.orderId === o.id && d.status === "LIVRE") for (const [f, n] of Object.entries(d.loaded)) sent[f] = (sent[f] ?? 0) + n;
    if (o.date < T) o.filled = Object.fromEntries(bottles.map((l) => [l.formatId, sent[l.formatId] ?? 0]));
    else if (filledToday.has(o.customerId)) o.filled = Object.fromEntries(bottles.map((l) => [l.formatId, l.qty]));
    if (Object.values(o.filled).some((n) => n > 0)) o.history.push({ at: at(o.date < T ? o.date : T, 6, 30), by: OPERATORS_BY_CENTRE[o.centreId] ?? "Production", label: "Remplissage confirmé" });
  }

  // Ledger rows from every event, then competitor stock follows the gate.
  const derived = applyEvents(events);
  movements.push(...derived.movements);
  const entries: AccountEntry[] = [...derived.entries];

  /* ---------- payments of deferred customers ---------- */
  for (const s of seeds) {
    const terms = termsOf.get(s.id)!;
    if (terms.payment.kind === "COMPTANT" || isWholesaler(s)) continue;
    // An opening balance, so ageing has history from day one.
    const daily = entries.filter((e) => e.customerId === s.id && e.kind === "DEBIT").reduce((a, e) => a + e.amount, 0) / LEDGER_DAYS;
    const openAmount = s.id === "c08" ? 160_000_000 : Math.round((daily * terms.payment.days * 0.5) / 1000) * 1000;
    if (openAmount > 0)
      entries.push({ id: `ob-${s.id}`, customerId: s.id, ts: at(start, 0), kind: "DEBIT", amount: openAmount, dueDate: s.id === "c08" ? shiftDate(start, -25) : shiftDate(start, Math.round(terms.payment.days / 3)), label: "Solde d'ouverture", refs: {}, by: "Reprise des soldes" });
  }

  // Periodic statements for wholesalers invoiced by statement: one per month.
  for (const s of seeds.filter((x) => termsOf.get(x.id)!.invoicing === "RELEVE_PERIODIQUE")) {
    const terms = termsOf.get(s.id)!;
    for (let d = start; d <= T; d = shiftDate(d, 1)) {
      if (!d.endsWith("-01")) continue;
      const mine = settlements.filter((x) => x.customerId === s.id && x.ts < at(d, 0) && !x.statementId);
      if (!mine.length) continue;
      const id = `rel-${s.id}-${d}`;
      for (const x of mine) x.statementId = id;
      entries.push({ id: `${id}:db`, customerId: s.id, ts: at(d, 8), kind: "DEBIT", amount: mine.reduce((a, x) => a + x.amount, 0), dueDate: dueDate(d, terms.payment), label: `Relevé ${mine.length} passages`, refs: {}, by: s.rep });
    }
  }

  for (const s of seeds) {
    if (s.payDelay == null) continue;
    const terms = termsOf.get(s.id)!;
    if (terms.payment.kind === "COMPTANT") continue;
    const open = entries.filter((e) => e.customerId === s.id && e.kind === "DEBIT").sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
    const paidIds = new Set<string>();
    for (let d = start; d <= T; d = shiftDate(d, 1)) {
      if (dow(d) !== 5) continue; // payments go out on Fridays
      const batch = open.filter((e) => !paidIds.has(e.id) && e.dueDate && shiftDate(e.dueDate, s.payDelay!) <= d);
      if (!batch.length) continue;
      for (const e of batch) paidIds.add(e.id);
      const method: PaymentMethod = terms.methods.includes("VIREMENT") ? "VIREMENT" : terms.methods[0];
      entries.push({ id: `pay-${s.id}-${d}`, customerId: s.id, ts: at(d, 11), kind: "CREDIT", amount: batch.reduce((a, e) => a + e.amount, 0), dueDate: null, method, label: `Règlement ${method === "VIREMENT" ? "par virement" : ""}`.trim(), refs: {}, by: "Mariama Sow" });
    }
  }

  /* ---------- incidents ---------- */
  const incidents: Incident[] = [];
  if (seeds.some((s) => s.id === "c06")) {
    const d = shiftDate(T, -20);
    incidents.push({ id: "inc-c06-cheque", customerId: "c06", ts: at(d, 15), kind: "CHEQUE_IMPAYE" as const, note: "Chèque de 9 500 000 F CFA rejeté pour défaut de provision.", by: "Mariama Sow" });
    entries.push({ id: "inc-c06-cheque:db", customerId: "c06", ts: at(d, 15), kind: "DEBIT", amount: 9_500_000, dueDate: d, label: "Rejet de chèque", refs: {}, by: "Mariama Sow" });
  }
  if (seeds.some((s) => s.id === "c03"))
    incidents.push({ id: "inc-c03-litige", customerId: "c03", ts: at(shiftDate(T, -12), 10), kind: "LITIGE" as const, note: "Conteste 40 B12,5 manquantes sur une livraison.", by: "Pape Gueye" });

  /* ---------- wholesaler counts ---------- */
  const ledgerSoFar = () => [...openingMovements(cfg, own, start), ...productionMovements(inventories, own, start), ...movements];
  for (const s of seeds.filter(isWholesaler)) {
    for (const back of [32, 2]) {
      const d = shiftDate(T, -back);
      if (d < start) continue;
      const ts = at(d, 16);
      const expected = siteBalance(ledgerSoFar(), clientSite(s.id), { until: ts }).PLEIN;
      const pending = back === 2 && s.id === "g03";
      const counted: BrandGrid = {};
      for (const [b, row] of Object.entries(expected))
        for (const [f, n] of Object.entries(row)) (counted[b] ??= {})[f] = pending && (f === "b6" || f === "b125") ? Math.round(n * 0.955) : back === 32 && f === "b6" ? n - 3 : n;
      const id = `cnt-${s.id}-${d}`;
      const sheet: CountSheet = {
        id,
        site: clientSite(s.id),
        ts,
        by: s.rep,
        state: "PLEIN",
        counted,
        expected,
        reason: pending ? "NON_RENDU" : back === 32 ? "PERTE" : null,
        note: pending ? "Le grossiste dit avoir prêté des bouteilles à un voisin." : "",
        status: pending ? "A_VALIDER" : "VALIDE",
        decidedBy: pending ? null : "Cheikh Mbaye",
        decidedAt: pending ? null : at(d, 18),
      };
      counts.push(sheet);
      if (!pending) movements.push(...adjustmentsFor({ site: clientSite(s.id), state: "PLEIN", counted, expected, ts: at(d, 18), by: "Cheikh Mbaye", reason: sheet.reason ?? "COMPTAGE", countId: id }));
    }
  }

  /* ---------- calls and declarations for the late wholesaler ---------- */
  const calls: CallLog[] = [];
  const declarations: Declaration[] = [];
  if (seeds.some((s) => s.id === lateWholesaler)) {
    calls.push({ id: "call-g02-1", customerId: lateWholesaler, ts: at(shiftDate(T, -3), 10, 20), by: "Fatou Diop", outcome: "INJOIGNABLE" as const, promised: null, note: "Répondeur." });
    calls.push({ id: "call-g02-2", customerId: lateWholesaler, ts: at(shiftDate(T, -1), 9, 5), by: "Fatou Diop", outcome: "PASSAGE_PROMIS" as const, promised: shiftDate(T, 1), note: "Camion en panne, passage promis demain." });
    declarations.push({ id: "dec-g02-1", customerId: lateWholesaler, ts: at(shiftDate(T, -1), 9, 10), by: "Fatou Diop", sold: { b6: 900, b125: 1100 }, note: "Déclaré au téléphone : stock presque épuisé." });
  }

  /* ---------- numbering, in order of creation ---------- */
  const number = <D extends { centreId: string; number: string }>(docs: D[], when: (d: D) => string, pattern: string) => {
    const seq = new Map<string, number>();
    for (const d of [...docs].sort((a, b) => when(a).localeCompare(when(b)))) {
      const day = ymd(new Date(when(d)));
      const k = `${d.centreId}|${day.slice(0, 4)}`;
      const n = (seq.get(k) ?? 0) + 1;
      seq.set(k, n);
      d.number = formatNumber(pattern, { centre: centreCode(d.centreId), date: day, seq: n });
    }
  };
  number(orders, (o) => o.createdAt, sc.workflow.numbering.order);
  number(dispatches, (d) => d.slot, sc.workflow.numbering.dispatch);
  number(settlements, (s) => s.ts, sc.workflow.numbering.settlement);
  // Labels written before numbering referred to ids.
  const dispNo = new Map(dispatches.map((d) => [d.id, d.number]));
  const setNo = new Map(settlements.map((s) => [s.id, s.number]));
  for (const e of entries) {
    if (e.refs.dispatchId && e.kind === "DEBIT") e.label = `BL ${dispNo.get(e.refs.dispatchId)}`;
    if (e.refs.settlementId) e.label = `${e.kind === "DEBIT" ? "Passage" : "Règlement"} ${setNo.get(e.refs.settlementId)}`;
  }

  /* ---------- day closes ---------- */
  const ledger = ledgerSoFar();
  const closes: DayClose[] = [];
  for (const c of cfg.centres)
    for (let d = start; d < T; d = shiftDate(d, 1)) {
      if (dow(d) === 0 || (c.id === "kao" && d === shiftDate(T, dow(T) === 1 ? -2 : -1))) continue;
      closes.push({ id: closeId(c.id, d), centreId: c.id, date: d, at: at(d, 19), by: STOREKEEPER[c.id] ?? "Magasinier", rows: reportRows(ledger, c.id, d, sc.brands, formats) });
    }

  return {
    customers,
    contracts,
    forecasts: forecastsFor(cfg, seeds, orders, settlements, start, T, rnd),
    orders,
    dispatches,
    movements,
    entries,
    incidents,
    settlements,
    counts,
    declarations,
    calls,
    closes,
  };
}

/** Weekly forecasts per customer: an initial version, then a revision three weeks ago. */
function forecastsFor(cfg: TenantConfig, seeds: SeedCustomer[], orders: Order[], settlements: Settlement[], start: string, T: string, rnd: () => number): Forecast[] {
  const weeks: string[] = [];
  for (let d = start; d <= shiftDate(T, 28); d = shiftDate(d, 7)) if (!weeks.includes(isoWeek(d))) weeks.push(isoWeek(d));
  const actual = new Map<string, number>(); // `${customer}|${week}|${format}`
  const add = (c: string, d: string, f: string, n: number) => {
    const k = `${c}|${isoWeek(d)}|${f}`;
    actual.set(k, (actual.get(k) ?? 0) + n);
  };
  for (const o of orders) if (o.status !== "BROUILLON" && o.status !== "ANNULEE") for (const l of o.lines) if (l.formatId !== BULK) add(o.customerId, o.date, l.formatId, l.qty);
  for (const s of settlements) for (const [f, n] of Object.entries(s.sold)) add(s.customerId, s.ts.slice(0, 10), f, n);
  const revisedAt = shiftDate(T, -21);
  const out: Forecast[] = [];
  for (const c of cfg.centres) {
    const mine = seeds.filter((s) => s.centre === c.id);
    const avg = (s: SeedCustomer, f: string) => {
      const full = weeks.filter((w) => weekRange(w)[0] >= start && weekRange(w)[1] < T);
      return full.length ? full.reduce((a, w) => a + (actual.get(`${s.id}|${w}|${f}`) ?? 0), 0) / full.length : 0;
    };
    const build = (revision: boolean): ForecastLine[] => {
      const lines: ForecastLine[] = [];
      for (const w of weeks)
        for (const s of mine)
          for (const b of cfg.bottleTypes) {
            const base = weekRange(w)[1] < T ? actual.get(`${s.id}|${w}|${b.id}`) ?? 0 : avg(s, b.id);
            if (!base) continue;
            const late = revision && weekRange(w)[1] >= revisedAt;
            const noise = late ? 0.93 + rnd() * 0.14 : 0.82 + rnd() * 0.34;
            lines.push({ period: w, formatId: b.id, scope: "CLIENT", key: s.id, qty: Math.round((base * noise) / 10) * 10 });
          }
      return lines;
    };
    const v1 = build(false);
    out.push({ id: `fc-${c.id}-1`, centreId: c.id, granularity: "SEMAINE", version: 1, basis: "INITIALE", createdBy: "Fatou Diop", createdAt: at(start, 9), lines: v1 });
    const v2 = build(true).map((l) => (weekRange(l.period)[1] < revisedAt ? v1.find((x) => x.period === l.period && x.key === l.key && x.formatId === l.formatId) ?? l : l));
    out.push({ id: `fc-${c.id}-2`, centreId: c.id, granularity: "SEMAINE", version: 2, basis: "REVISION", createdBy: "Cheikh Mbaye", createdAt: at(revisedAt, 9), lines: v2 });
  }
  return out;
}
