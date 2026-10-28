"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { SESSION_KEY } from "./keys";
import { MODULES, type ModuleId } from "./modules";

/* ------------------------------------------------------------------
   Mock login. Four demo accounts, one per module plus an administrator;
   the session is the account id in localStorage. No server, no real
   credentials: this only lets each team's view be shown and tested.
   ------------------------------------------------------------------ */

export interface Account {
  id: string;
  name: string;
  email: string;
  title: string;
  modules: ModuleId[];
  salesRole: string; // permission role in the tenant's sales settings
  admin: boolean; // every module, every permission, every setting
}

export const DEMO_PASSWORD = "demo";

export const ACCOUNTS: Account[] = [
  { id: "production", name: "Awa Ndiaye", email: "production@baobab-energie.sn", title: "Responsable production", modules: ["production"], salesRole: "production", admin: false },
  { id: "ventes", name: "Cheikh Mbaye", email: "ventes@baobab-energie.sn", title: "Responsable commercial", modules: ["ventes"], salesRole: "resp_commercial", admin: false },
  { id: "stock", name: "Ousmane Ba", email: "stock@baobab-energie.sn", title: "Responsable magasin", modules: ["stock"], salesRole: "magasinier", admin: false },
  { id: "admin", name: "Aliou Kane", email: "admin@baobab-energie.sn", title: "Administrateur", modules: MODULES.map((m) => m.id), salesRole: "direction", admin: true },
];

/** Pure check of a demo login; the error says what to fix. */
export function authenticate(email: string, password: string): { account: Account } | { error: string } {
  const account = ACCOUNTS.find((a) => a.email.toLowerCase() === email.trim().toLowerCase());
  if (!account) return { error: "Adresse inconnue : utilisez un des comptes de démonstration ci-dessous." };
  if (password !== DEMO_PASSWORD) return { error: `Mot de passe incorrect : le mot de passe de démonstration est « ${DEMO_PASSWORD} ».` };
  return { account };
}

interface Auth {
  ready: boolean;
  account: Account | null;
  login: (email: string, password: string) => string | null; // the error, if any
  logout: () => void;
}

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    try {
      const id = localStorage.getItem(SESSION_KEY);
      setAccount(ACCOUNTS.find((a) => a.id === id) ?? null);
    } catch {}
    setReady(true);
  }, []);

  const login = useCallback((email: string, password: string) => {
    const r = authenticate(email, password);
    if ("error" in r) return r.error;
    setAccount(r.account);
    try {
      localStorage.setItem(SESSION_KEY, r.account.id);
    } catch {}
    return null;
  }, []);

  const logout = useCallback(() => {
    setAccount(null);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {}
  }, []);

  const value = useMemo(() => ({ ready, account, login, logout }), [ready, account, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const a = useContext(Ctx);
  if (!a) throw new Error("useAuth outside AuthProvider");
  return a;
}
