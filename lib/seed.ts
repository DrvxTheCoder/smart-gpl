import { ambientDensity, bottleTonnes, buildClosing } from "./calc";
import { BUILTIN_PROFILE_ID, builtinProfile, linearExampleProfile, profileFor } from "./correction";
import { DEFAULT_SALES } from "./sales/defaults";
import type { Centre, CorrectionConfig, CorrectionProfile, Inventory, TankReading, TenantConfig } from "./types";

/* The demo ships the built-in standard table (default) and a linear example, so switching can be shown. */
const DEMO_CORRECTION: CorrectionConfig = {
  profiles: [builtinProfile(), linearExampleProfile()],
  defaultProfileId: BUILTIN_PROFILE_ID,
};

/* A fictional company used for demos. Nothing here belongs to a real operator. */
export const DEFAULT_CONFIG: TenantConfig = {
  branding: { companyName: "Baobab Énergie SA", shortName: "BE", brand: "#17603b" },
  rules: {
    ecartOk: 2,
    ecartWarn: 5,
    lunchBreakMin: 60,
    stopTypes: [
      "Problème de bascules",
      "Changement de format",
      "Sensibilisation",
      "Véhicule manquant",
      "Véhicule en panne",
      "Bouteilles manquantes",
      "Incident technique",
      "Panne équipement",
      "Maintenance",
      "Autre",
    ],
  },
  bottleTypes: [
    { id: "b27", label: "B2,7", kg: 2.7 },
    { id: "b6", label: "B6", kg: 6 },
    { id: "b9", label: "B9", kg: 9 },
    { id: "b125", label: "B12,5", kg: 12.5 },
    { id: "b38", label: "B38", kg: 38 },
  ],
  centres: [
    {
      id: "ruf",
      code: "RUF",
      name: "Centre de Rufisque",
      address: "Zone industrielle, Rufisque",
      managers: ["Awa Ndiaye", "Moussa Fall"],
      lines: [
        { id: "l1", name: "Carrousel 1", capacityTph: 9 },
        { id: "l2", name: "Carrousel 2", capacityTph: 9 },
        { id: "l3", name: "Ligne B38", capacityTph: 4 },
      ],
      reservoirs: [
        { id: "s1", name: "Sphère S1", type: "SPHERE", capacityM3: 1000, capacityT: 570, heightMm: 12400, calcMode: "AUTOMATIC" },
        { id: "s2", name: "Sphère S2", type: "SPHERE", capacityM3: 1000, capacityT: 570, heightMm: 12400, calcMode: "AUTOMATIC" },
        { id: "c1", name: "Cigare C1", type: "CIGARE", capacityM3: 250, capacityT: 142.5, heightMm: 3600, calcMode: "AUTOMATIC" },
      ],
      approFields: [
        { id: "butanier", label: "Butanier" },
        { id: "raffinerie", label: "Appro raffinerie" },
        { id: "recup", label: "Récupération" },
      ],
      sortieFields: [
        { id: "vrac", label: "Vrac clients" },
        { id: "transfert", label: "Transferts dépôts" },
        { id: "divers", label: "Divers" },
      ],
    },
    {
      id: "kao",
      code: "KAO",
      name: "Centre de Kaolack",
      address: "Route de Fatick, Kaolack",
      managers: ["Ibrahima Sarr"],
      lines: [{ id: "k1", name: "Carrousel K1", capacityTph: 6 }],
      reservoirs: [
        { id: "k-c1", name: "Cigare K1", type: "CIGARE", capacityM3: 300, capacityT: 171, heightMm: 3800, calcMode: "AUTOMATIC" },
        { id: "k-c2", name: "Cigare K2", type: "CIGARE", capacityM3: 300, capacityT: 171, heightMm: 3800, calcMode: "AUTOMATIC" },
      ],
      approFields: [
        { id: "transfertIn", label: "Transfert Rufisque" },
        { id: "recup", label: "Récupération" },
      ],
      sortieFields: [
        { id: "vrac", label: "Vrac clients" },
        { id: "divers", label: "Divers" },
      ],
    },
  ],
  correction: DEMO_CORRECTION,
  sales: {
    ...DEFAULT_SALES,
    // About two days of production in stock when the sales ledger starts.
    openingStock: {
      ruf: { b27: 6400, b6: 12200, b9: 2600, b125: 14400, b38: 420 },
      kao: { b27: 2800, b6: 5200, b9: 600, b125: 3000, b38: 80 },
    },
  },
};

export const OPERATORS: Record<string, string[]> = {
  ruf: ["Awa Ndiaye", "Moussa Fall"],
  kao: ["Ibrahima Sarr"],
};

/* ---------------- deterministic PRNG ---------------- */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Builds tank readings whose liquid masses sum to `targetT`. Temperatures stay
 * inside the table (tLiq 24–30 °C, tVap 1–3 °C above) and d15 in a commercial
 * butane range (0.565–0.577), so no demo reading raises a warning.
 */
function readingsFor(centre: Centre, targetT: number, rnd: () => number, profile: CorrectionProfile): Record<string, TankReading> {
  const cap = centre.reservoirs.reduce((a, r) => a + r.capacityT, 0);
  const out: Record<string, TankReading> = {};
  for (const res of centre.reservoirs) {
    const share = targetT * (res.capacityT / cap);
    const tLiq = r1(24 + rnd() * 6);
    const d15 = r3(0.565 + rnd() * 0.012);
    const vol = share / ambientDensity(profile, d15, tLiq);
    out[res.id] = {
      heightMm: Math.round((vol / res.capacityM3) * res.heightMm),
      tLiq,
      tVap: r1(tLiq + 1 + rnd() * 2),
      volLiqM3: r1(vol),
      pressureBar: r1(2.4 + rnd() * 1.4),
      d15,
    };
  }
  return out;
}

/** Re-solves tank volumes so the physical stock lands exactly on target (keeps rounding honest). */
function liquidSum(centre: Centre, tanks: Record<string, TankReading>, profile: CorrectionProfile) {
  return centre.reservoirs.reduce((a, res) => {
    const t = tanks[res.id];
    return a + t.volLiqM3 * ambientDensity(profile, t.d15, t.tLiq);
  }, 0);
}

const PROFILE: Record<string, { bottles: Record<string, number>; scale: number }> = {
  ruf: { bottles: { b27: 3200, b6: 6100, b9: 1300, b125: 7200, b38: 210 }, scale: 1 },
  kao: { bottles: { b27: 1400, b6: 2600, b9: 300, b125: 1500, b38: 40 }, scale: 1 },
};

export function generateInventories(cfg: TenantConfig, today = new Date(), days = 150): Inventory[] {
  // Demo history was "closed" with the demo's built-in table, whatever the tenant
  // has configured since: readings and snapshots both use it, for every tank.
  const demoCfg: TenantConfig = { ...cfg, correction: DEMO_CORRECTION };
  const profile = profileFor(demoCfg, {});
  const all: Inventory[] = [];
  for (const cfgCentre of cfg.centres) {
    const centre: Centre = { ...cfgCentre, reservoirs: cfgCentre.reservoirs.map((r) => ({ ...r, profileId: undefined })) };
    const rnd = mulberry32(centre.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) * 9973);
    const cap = centre.reservoirs.reduce((a, r) => a + r.capacityT, 0);
    let stock = cap * 0.55;
    const prof = PROFILE[centre.id] ?? PROFILE.kao;
    const ops = OPERATORS[centre.id] ?? centre.managers;

    for (let i = days; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const isToday = i === 0;
      const dow = d.getDay();
      // Draw the same number of randoms every day so data is stable as days pass.
      const rr = Array.from({ length: 40 }, rnd);
      if (dow === 0) continue; // Sundays: no production

      const busy = dow === 6 ? 0.55 : 1;
      const bottles: Record<string, number> = {};
      for (const b of cfg.bottleTypes) {
        const base = prof.bottles[b.id] ?? 0;
        bottles[b.id] = Math.round(base * busy * (0.78 + rr[0 + (b.id.length % 5)] * 0.4) * (0.9 + rr[1] * 0.2));
      }

      const nightOn = centre.id === "ruf" && dow >= 2 && dow <= 4 && rr[2] > 0.55;
      const nightBottles: Record<string, number> = {};
      if (nightOn) for (const b of cfg.bottleTypes) nightBottles[b.id] = Math.round((bottles[b.id] ?? 0) * (0.25 + rr[3] * 0.1));

      const appro: Record<string, number> = {};
      for (const f of centre.approFields) appro[f.id] = 0;
      const sorties: Record<string, number> = {};
      for (const f of centre.sortieFields) sorties[f.id] = 0;

      const dayT = bottleTonnes(bottles, cfg).t;
      const nightT = bottleTonnes(nightBottles, cfg).t;

      // Supply: big delivery when the stock runs low, small top-ups otherwise,
      // never more than the room left below ~82 % of capacity (safe filling limit).
      const low = stock < cap * 0.32;
      let room = Math.max(cap * 0.82 - stock, 0);
      const supply = (want: number) => {
        const t = r1(Math.min(want, room));
        room -= t;
        return t;
      };
      const main = centre.approFields[0]?.id;
      if (main) appro[main] = low ? supply(cap * (0.42 + rr[4] * 0.12)) : rr[5] > 0.82 ? supply(40 + rr[6] * 60) : 0;
      if (centre.approFields[1]) appro[centre.approFields[1].id] = rr[7] > 0.6 ? supply(10 + rr[8] * 35) : 0;
      if (centre.approFields[2]) appro[centre.approFields[2].id] = rr[9] > 0.7 ? supply(0.5 + rr[10] * 2.5) : 0;

      sorties[centre.sortieFields[0].id] = r1((centre.id === "ruf" ? 8 : 3) + rr[11] * (centre.id === "ruf" ? 18 : 6));
      if (centre.sortieFields[1]) sorties[centre.sortieFields[1].id] = rr[12] > 0.75 ? r1(10 + rr[13] * 20) : 0;
      if (centre.sortieFields[2]) sorties[centre.sortieFields[2].id] = rr[14] > 0.8 ? r1(rr[15] * 2) : 0;

      const approT = Object.values(appro).reduce((a, b) => a + b, 0);
      const vracT = Object.values(sorties).reduce((a, b) => a + b, 0);
      const stockInitial = r1(stock);
      const theo = stockInitial - nightT + approT - vracT - dayT;

      // Mostly tight balance, a few warn days, rare alert days
      const roll = rr[16];
      const ecartPct = roll > 0.985 ? (rr[17] > 0.5 ? 1 : -1) * (5.2 + rr[18] * 1.5) : roll > 0.9 ? (rr[17] > 0.5 ? 1 : -1) * (2.1 + rr[18] * 2.2) : (rr[18] - 0.52) * 2.4;
      const phys = Math.max(theo * (1 + ecartPct / 100), cap * 0.08);

      const tanks = readingsFor(centre, phys, () => rnd(), profile);
      stock = liquidSum(centre, tanks, profile);

      const stopsCount = Math.floor(rr[19] * 3.2);
      const stops = Array.from({ length: stopsCount }, (_, k) => ({
        id: `${iso(d)}-${k}`,
        type: cfg.rules.stopTypes[Math.floor(rr[20 + k] * cfg.rules.stopTypes.length)],
        minutes: 10 + Math.round(rr[23 + k] * 50),
        note: "",
        author: ops[k % ops.length],
        at: d.toISOString(),
      }));

      const endH = dow === 6 ? 13 : 17 + Math.round(rr[26] * 2);
      const inv: Inventory = {
        id: `${centre.id}_${iso(d)}`,
        centreId: centre.id,
        date: iso(d),
        status: isToday ? "EN_COURS" : "TERMINE",
        startedBy: ops[Math.floor(rr[27] * ops.length)],
        stockInitial,
        heureDebut: "08:00",
        heureFin: isToday ? "" : `${String(endH).padStart(2, "0")}:${rr[28] > 0.5 ? "30" : "00"}`,
        appro,
        sorties,
        bottles,
        night: {
          enabled: nightOn,
          thtMin: nightOn ? 360 + Math.round(rr[29] * 60) : 0,
          taMin: nightOn ? Math.round(rr[30] * 40) : 0,
          lineIds: nightOn ? centre.lines.slice(0, 2).map((l) => l.id) : [],
          bottles: nightBottles,
        },
        tanks,
        stops,
        vehicles: {
          decharges: [Math.round(4 + rr[31] * 8), Math.round(3 + rr[32] * 6)],
          charges: [Math.round(5 + rr[33] * 9), Math.round(3 + rr[34] * 6)],
          nonDecharges: [Math.round(rr[35] * 2), Math.round(rr[36] * 2)],
          dechargesNonCharges: [Math.round(rr[37] * 2), 0],
          notes: "",
        },
        notes: "",
      };

      if (isToday) {
        // A day in progress: partial bottles, no closing tank readings yet beyond carried values
        const frac = 0.55;
        for (const k of Object.keys(inv.bottles)) inv.bottles[k] = Math.round(inv.bottles[k] * frac);
        inv.stops = inv.stops.slice(0, 1);
        for (const k of Object.keys(inv.sorties)) inv.sorties[k] = r1(inv.sorties[k] * frac);
        // readings reflect "now"
        const t2 = inv.stockInitial + approT - bottleTonnes(inv.bottles, cfg).t - Object.values(inv.sorties).reduce((a, b) => a + b, 0) - nightT;
        inv.tanks = readingsFor(centre, t2 * 1.004, () => rnd(), profile);
      } else {
        inv.closing = buildClosing(inv, centre, demoCfg);
      }
      all.push(inv);
    }
  }
  return all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.centreId.localeCompare(b.centreId)));
}
