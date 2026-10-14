"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useStore, type NoticeKind } from "../store";
import { useAuth } from "../auth";
import type { Inventory, TenantConfig } from "../types";
import { ownBrand } from "./bottle-ledger";
import { addToOverlay, applyPatch, loadOverlay, mergeOverlay, storedOverlay, type Overlay, type Patch } from "./data";
import { ymd } from "./dates";
import { SALES_KEY } from "../keys";
import { generateSales } from "./seed";
import { ledgerStart, openingMovements, productionMovements } from "./stock";
import type { Action, BottleMovement, Role, SalesData } from "./types";

/* ------------------------------------------------------------------
   Sales state, nested inside the production store. It reuses its
   toasts, background jobs, centre and user; it only adds the sales data
   (demo seed + this device's overlay) and the prototype role switcher.
   ------------------------------------------------------------------ */

/** What every command needs: plain data, the clock and who acts. */
export interface Env {
  cfg: TenantConfig;
  data: SalesData;
  ledger: BottleMovement[];
  inventories: Inventory[];
  own: string;
  today: string;
  now: string;
  by: string;
  can: (a: Action) => boolean;
}

export type CommandResult = { ok: true; patch: Patch; msg: string; kind?: NoticeKind; goTo?: string } | { ok: false; error: string };

interface SalesStore {
  data: SalesData;
  /** Opening + production (derived) + recorded movements: the full bottle ledger. */
  ledger: BottleMovement[];
  own: string;
  today: string;
  role: Role; // the signed-in account's permission role
  actor: string;
  can: (a: Action) => boolean;
  /** The current state as a command sees it, for live checks in screens (read only). */
  env: Env;
  /** Runs a pure command against the current state; commits and reports. */
  exec: (cmd: (env: Env) => CommandResult) => CommandResult;
  resetSales: () => void;
}

const Ctx = createContext<SalesStore | null>(null);

/** Changes only when closed production changes, so editing an open inventory never regenerates the seed. */
function productionSignature(inventories: Inventory[]) {
  let s = "";
  for (const i of inventories) {
    if (i.status !== "TERMINE") continue;
    let n = 0;
    for (const v of Object.values(i.bottles)) n += Number(v) || 0;
    if (i.night.enabled) for (const v of Object.values(i.night.bottles)) n += Number(v) || 0;
    s += `${i.id}:${n};`;
  }
  return s;
}

export function SalesProvider({ children }: { children: React.ReactNode }) {
  const { ready, config, inventories, toast } = useStore();
  const { account } = useAuth();
  const [overlay, setOverlay] = useState<Overlay>({});
  const [today, setToday] = useState("");
  const overlayRef = useRef<Overlay>({});

  useEffect(() => {
    if (!ready) return;
    setToday(ymd(new Date()));
    try {
      const r = loadOverlay(localStorage.getItem(SALES_KEY));
      overlayRef.current = r.overlay;
      setOverlay(r.overlay);
      if (r.notice) toast(r.notice, "warning");
    } catch {}
  }, [ready, toast]);

  const sig = useMemo(() => productionSignature(inventories), [inventories]);
  const invRef = useRef(inventories);
  invRef.current = inventories;
  const salesCfg = config.sales;
  const formatsKey = config.bottleTypes.map((b) => b.id).join();
  const centresKey = config.centres.map((c) => c.id).join();
  const cfgRef = useRef(config);
  cfgRef.current = config;

  // The seed depends on closed production, the sales settings, formats and centres;
  // config and inventories are read through refs so other edits never rebuild it.
  const seed = useMemo(
    () => (today ? generateSales(cfgRef.current, invRef.current, new Date(`${today}T12:00:00`)) : null),
    [today, sig, salesCfg, formatsKey, centresKey],
  );
  const data = useMemo(() => (seed ? mergeOverlay(seed, overlay) : null), [seed, overlay]);

  const own = ownBrand(config.sales.brands);
  const derived = useMemo(
    () => (today ? [...openingMovements(cfgRef.current, own, ledgerStart(today)), ...productionMovements(invRef.current, own, ledgerStart(today))] : []),
    [today, sig, own, salesCfg.openingStock],
  );
  const ledger = useMemo(() => (data ? [...derived, ...data.movements] : derived), [derived, data]);

  const role = config.sales.roles.find((r) => r.id === account?.salesRole) ?? config.sales.roles[0];
  const actor = account?.name ?? role.person;
  // The administrator may do everything; others follow the tenant's permission matrix.
  const admin = !!account?.admin;
  const can = useCallback((a: Action) => admin || (config.sales.permissions[a] ?? []).includes(role.id), [admin, config.sales.permissions, role.id]);

  const commit = useCallback((patch: Patch) => {
    const next = addToOverlay(overlayRef.current, patch);
    overlayRef.current = next;
    setOverlay(next);
    try {
      localStorage.setItem(SALES_KEY, storedOverlay(next));
    } catch {}
  }, []);

  // Commands read the latest state, even several in a row before a re-render.
  const latest = useRef<{ data: SalesData | null; ledger: BottleMovement[] }>({ data: null, ledger: [] });
  latest.current = { data, ledger };

  const exec = useCallback(
    (cmd: (env: Env) => CommandResult): CommandResult => {
      const cur = latest.current;
      if (!cur.data) return { ok: false, error: "Données de vente en cours de chargement." };
      const r = cmd({ cfg: cfgRef.current, data: cur.data, ledger: cur.ledger, inventories: invRef.current, own, today, now: new Date().toISOString(), by: actor, can });
      if (r.ok) {
        commit(r.patch);
        const nextData = applyPatch(cur.data, r.patch);
        latest.current = { data: nextData, ledger: [...derived, ...nextData.movements] };
        if (r.msg) toast(r.msg, r.kind ?? "success");
      } else toast(r.error, "error");
      return r;
    },
    [own, today, actor, can, commit, toast, derived],
  );

  const resetSales = useCallback(() => {
    try {
      localStorage.removeItem(SALES_KEY);
    } catch {}
    overlayRef.current = {};
    setOverlay({});
  }, []);

  const env = useMemo<Env | null>(
    () => (data ? { cfg: config, data, ledger, inventories, own, today, now: `${today}T12:00:00`, by: actor, can } : null),
    [data, config, ledger, inventories, own, today, actor, can],
  );

  const value = useMemo<SalesStore | null>(
    () => (data && env ? { data, ledger, own, today, role, actor, can, env, exec, resetSales } : null),
    [data, ledger, own, today, role, actor, can, env, exec, resetSales],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Null until the client has booted and the seed is built. */
export function useSalesMaybe() {
  return useContext(Ctx);
}

export function useSales() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSales before the sales data is ready");
  return s;
}
