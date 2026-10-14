import { describe, expect, it } from "vitest";
import { ACCOUNTS, authenticate, DEMO_PASSWORD } from "../lib/auth";
import { canOpen, moduleOf } from "../lib/modules";
import { canSeeSetting } from "../lib/settings-access";
import { DEFAULT_SALES } from "../lib/sales/defaults";

const account = (id: string) => ACCOUNTS.find((a) => a.id === id)!;

describe("modules", () => {
  it("each route belongs to one module; settings and login are shared", () => {
    expect(moduleOf("/")).toBe("production");
    expect(moduleOf("/inventaires/ruf_2026-10-09")).toBe("production");
    expect(moduleOf("/remplissage")).toBe("production");
    expect(moduleOf("/ventes")).toBe("ventes");
    expect(moduleOf("/ventes/commandes/x?nouveau=1")).toBe("ventes");
    expect(moduleOf("/magasin/rapport")).toBe("stock");
    expect(moduleOf("/expeditions/x")).toBe("stock");
    expect(moduleOf("/parametres")).toBeNull();
    expect(moduleOf("/connexion")).toBeNull();
    // A prefix only matches whole segments.
    expect(moduleOf("/ventesx")).toBeNull();
  });

  it("a module head opens only its module and the shared pages; the admin opens everything", () => {
    const v = account("ventes");
    expect(canOpen(v.modules, "/ventes/clients")).toBe(true);
    expect(canOpen(v.modules, "/expeditions")).toBe(false);
    expect(canOpen(v.modules, "/")).toBe(false);
    expect(canOpen(v.modules, "/parametres")).toBe(true);
    for (const p of ["/", "/ventes", "/magasin", "/remplissage"]) expect(canOpen(account("admin").modules, p)).toBe(true);
  });

  it("settings sections follow the modules they configure", () => {
    expect(canSeeSetting(account("production"), "reservoirs")).toBe(true);
    expect(canSeeSetting(account("production"), "clients")).toBe(false);
    expect(canSeeSetting(account("stock"), "bouteilles")).toBe(true);
    expect(canSeeSetting(account("ventes"), "roles")).toBe(false);
    expect(canSeeSetting(account("ventes"), "affichage")).toBe(true);
    expect(canSeeSetting(account("admin"), "marque")).toBe(true);
    expect(canSeeSetting(null, "affichage")).toBe(false);
  });
});

describe("mock login", () => {
  it("accepts the demo accounts with the demo password, and says what is wrong otherwise", () => {
    const ok = authenticate(" Ventes@Baobab-Energie.sn ", DEMO_PASSWORD);
    expect("account" in ok && ok.account.id).toBe("ventes");
    const badPw = authenticate("ventes@baobab-energie.sn", "x");
    expect("error" in badPw && badPw.error).toMatch(/Mot de passe/);
    const unknown = authenticate("nobody@example.com", DEMO_PASSWORD);
    expect("error" in unknown && unknown.error).toMatch(/Adresse inconnue/);
  });

  it("one head per module plus an administrator, each mapped to a permission role of the tenant", () => {
    const roles = DEFAULT_SALES.roles.map((r) => r.id);
    expect(ACCOUNTS.map((a) => a.modules.join("+"))).toEqual(["production", "ventes", "stock", "production+ventes+stock"]);
    for (const a of ACCOUNTS) expect(roles).toContain(a.salesRole);
    expect(ACCOUNTS.filter((a) => a.admin).map((a) => a.id)).toEqual(["admin"]);
    expect(DEFAULT_SALES.permissions["order.fill"]).toContain(account("production").salesRole);
  });
});
