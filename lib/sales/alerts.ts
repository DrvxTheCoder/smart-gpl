import type { TenantConfig } from "../types";
import { clientSite, siteBalance } from "./bottle-ledger";
import { categoryOf, contractAt } from "./contracts";
import { daysOfStock, daysSincePassage, inactivityThreshold, ladderStep, sellOut, typicalInterval } from "./consignment";
import { shiftDate } from "./dates";
import { unclosedDays } from "./day-close";
import { ledgerStart } from "./stock";
import type { BottleMovement, CallLog, Customer, LadderStep, SalesData } from "./types";
import type { Tone } from "./solvency";

/* Derived alerts: nothing is stored, everything is read from the data. */

export interface WholesalerStatus {
  customer: Customer;
  threshold: number; // days without a passage before the first step
  daysSince: number | null;
  typical: number | null; // its own median rhythm
  step: LadderStep | null;
  lateForThem: boolean; // later than its own rhythm, even below the threshold
  stock: number; // fulls held
  daysOfStock: number | null;
  lastCall: CallLog | undefined;
}

interface Ctx {
  cfg: TenantConfig;
  data: SalesData;
  ledger: BottleMovement[];
  today: string;
  own: string;
  centreId: string;
}

export function wholesalerStatuses(o: Ctx): WholesalerStatus[] {
  const sc = o.cfg.sales;
  const from = shiftDate(o.today, -28);
  return o.data.customers
    .filter((c) => c.active && categoryOf(sc, c)?.kind === "GROSSISTE" && (o.centreId === "all" || c.centreIds.includes(o.centreId)))
    .map((c) => {
      const threshold = inactivityThreshold(sc.consignment, categoryOf(sc, c), contractAt(o.data.contracts, c.id, o.today)?.terms);
      const daysSince = daysSincePassage(o.data.settlements, c.id, o.today);
      const typical = typicalInterval(o.data.settlements, c.id);
      const stock = Object.values(siteBalance(o.ledger, clientSite(c.id)).PLEIN[o.own] ?? {}).reduce((a, b) => a + b, 0);
      const sold = Object.values(sellOut(o.data.settlements, c.id, from, o.today)).reduce((a, b) => a + b, 0);
      return {
        customer: c,
        threshold,
        daysSince,
        typical,
        step: ladderStep(daysSince, threshold, sc.consignment.ladder),
        lateForThem: daysSince != null && typical != null && daysSince > Math.ceil(typical * 1.5),
        stock,
        daysOfStock: daysOfStock(stock, sold / 28),
        lastCall: o.data.calls.filter((k) => k.customerId === c.id).sort((a, b) => b.ts.localeCompare(a.ts))[0],
      };
    })
    .sort((a, b) => (b.daysSince ?? 99) - b.threshold - ((a.daysSince ?? 99) - a.threshold));
}

export type AlertKind = "GROSSISTE" | "VALIDATION" | "ECART" | "CLOTURE";
export interface Alert {
  id: string;
  kind: AlertKind;
  tone: Tone;
  title: string;
  detail: string;
  href: string;
}

const STEP_TONE: Record<LadderStep["action"], Tone> = { TACHE: "warn", NOTIFIER: "warn", BLOQUER: "alert" };

export function alerts(o: Ctx): Alert[] {
  const out: Alert[] = [];
  const inScope = (centreId: string) => o.centreId === "all" || centreId === o.centreId;
  for (const w of wholesalerStatuses(o)) {
    if (!w.step) continue;
    out.push({
      id: `w-${w.customer.id}`,
      kind: "GROSSISTE",
      tone: STEP_TONE[w.step.action],
      title: `${w.customer.name} : ${w.daysSince} jours sans passage`,
      detail: w.step.action === "BLOQUER" ? "Mises en consignation bloquées jusqu'au prochain passage." : w.step.action === "NOTIFIER" ? "Responsable prévenu. Appelez le grossiste." : "Appel à passer par le commercial.",
      href: `/ventes/clients/${w.customer.id}`,
    });
  }
  for (const ord of o.data.orders) {
    if (!inScope(ord.centreId) || ord.status !== "CONFIRMEE" || !ord.approval.required || ord.approval.by) continue;
    const c = o.data.customers.find((x) => x.id === ord.customerId);
    out.push({ id: `a-${ord.id}`, kind: "VALIDATION", tone: "warn", title: `Commande ${ord.number} à valider`, detail: `${c?.name ?? "Client"} : ${ord.approval.reasons[0] ?? "validation requise"}`, href: `/ventes/commandes/${ord.id}` });
  }
  for (const k of o.data.counts) {
    if (k.status !== "A_VALIDER") continue;
    const id = k.site.slice(k.site.indexOf(":") + 1);
    const isClient = k.site.startsWith("client:");
    const c = isClient ? o.data.customers.find((x) => x.id === id) : undefined;
    if (isClient ? !c || (o.centreId !== "all" && !c.centreIds.includes(o.centreId)) : !inScope(id)) continue;
    out.push({ id: `c-${k.id}`, kind: "ECART", tone: "warn", title: `Écart de comptage à valider`, detail: c ? c.name : "Magasin", href: c ? `/ventes/clients/${c.id}` : "/magasin" });
  }
  for (const centre of o.cfg.centres) {
    if (!inScope(centre.id)) continue;
    const open = unclosedDays(o.data.closes, centre.id, shiftDate(o.today, -7) < ledgerStart(o.today) ? ledgerStart(o.today) : shiftDate(o.today, -7), o.today);
    if (open.length) out.push({ id: `j-${centre.id}`, kind: "CLOTURE", tone: "alert", title: `${centre.name} : ${open.length} journée${open.length > 1 ? "s" : ""} non clôturée${open.length > 1 ? "s" : ""}`, detail: "Clôturez la journée du magasin pour figer l'état des bouteilles.", href: "/magasin" });
  }
  return out;
}
