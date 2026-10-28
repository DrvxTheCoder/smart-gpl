import type { Account } from "./auth";
import type { ModuleId } from "./modules";

/* Who sees each Paramètres section: the modules it configures, "admin" for
   tenant-wide ones, "all" for personal preferences. */
const ACCESS: Record<string, ModuleId[] | "admin" | "all"> = {
  marque: "admin",
  centres: ["production"],
  reservoirs: ["production"],
  flux: ["production"],
  bouteilles: ["production", "stock"],
  regles: ["production"],
  clients: ["ventes"],
  ventes: ["ventes"],
  consignation: ["ventes", "stock"],
  rapports: ["ventes", "stock"],
  roles: "admin",
  affichage: "all",
};

export function canSeeSetting(account: Account | null, tab: string) {
  const a = ACCESS[tab];
  return !!account && (account.admin || a === "all" || (Array.isArray(a) && a.some((m) => account.modules.includes(m))));
}
