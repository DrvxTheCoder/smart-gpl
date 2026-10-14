/* ------------------------------------------------------------------
   The product is three modules sharing one tenant: production, sales
   (ventes) and warehouse (stock). Each route belongs to one module by
   its path; Paramètres and the login page are shared.
   ------------------------------------------------------------------ */

export type ModuleId = "production" | "ventes" | "stock";

export interface ModuleDef {
  id: ModuleId;
  label: string;
  home: string;
  prefixes: string[]; // a path belongs to the module when it starts with one of these
}

export const MODULES: ModuleDef[] = [
  { id: "production", label: "Production", home: "/", prefixes: ["/inventaires", "/analyses", "/remplissage"] },
  { id: "ventes", label: "Ventes", home: "/ventes", prefixes: ["/ventes"] },
  { id: "stock", label: "Stock", home: "/magasin", prefixes: ["/magasin", "/expeditions"] },
];

const SHARED = ["/parametres", "/connexion", "/dev"];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** The module a path belongs to, or null for shared pages. */
export function moduleOf(path: string): ModuleId | null {
  const p = path.split("?")[0];
  if (SHARED.some((s) => under(p, s))) return null;
  if (p === "/") return "production";
  return MODULES.find((m) => m.prefixes.some((x) => under(p, x)))?.id ?? null;
}

export const moduleDef = (id: ModuleId) => MODULES.find((m) => m.id === id) ?? MODULES[0];

/** Whether someone with these modules may open a path. Shared pages are open to all. */
export function canOpen(modules: ModuleId[], path: string) {
  const m = moduleOf(path);
  return m == null || modules.includes(m);
}
