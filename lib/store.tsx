"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CONFIG, generateInventories } from "./seed";
import { migrateStoredConfig, storedConfig } from "./tenant-io";
import type { Centre, Inventory, TenantConfig } from "./types";
import type { OnProgress, ReportFile } from "./year-report";

import { CONFIG_KEY, DENSITY_KEY, EDITS_KEY, LEGACY_CONFIG_KEY } from "./keys";
import { useAuth } from "./auth";

export type Density = "compact" | "expanded";

/** What a notice is about; picks the island's icon, tint and how long it stays. */
export type NoticeKind = "info" | "success" | "warning" | "error" | "expanded" | "compact" | "pause" | "bell";
export interface Notice {
  id: number;
  msg: string;
  kind: NoticeKind;
  /** Times the same info toast was raised again while on screen. */
  repeat: number;
}

/**
 * Work that runs in the background and surfaces in the hub. It lives in the
 * provider, above the pages, so it keeps running across navigation. Once
 * settled it stays listed (done or error) until the hub has shown the outcome.
 */
export interface Job {
  id: string;
  kind: string; // one running job per kind
  progress: number; // 0..1
  status: "running" | "done" | "error";
  msg: string; // the outcome, once settled
}

export interface JobSpec {
  kind: string;
  /** Shown if another job of the same kind is already running. */
  busyMsg: string;
  doneMsg: string;
  run: (onProgress: OnProgress) => Promise<ReportFile | void>;
}

interface Store {
  ready: boolean;
  config: TenantConfig;
  setConfig: (fn: (c: TenantConfig) => TenantConfig) => void;
  resetConfig: () => void;
  inventories: Inventory[];
  updateInventory: (id: string, fn: (i: Inventory) => Inventory) => void;
  centreId: string; // "all" or a centre id
  setCentreId: (id: string) => void;
  density: Density;
  setDensity: (d: Density) => void;
  centre: (id: string) => Centre;
  user: { name: string; email: string; role: string };
  toast: (msg: string, kind?: NoticeKind) => void;
  notice: Notice | null; // the one on screen; a new toast replaces it
  dismissNotice: (id: number) => void;
  jobs: Job[];
  startJob: (spec: JobSpec) => void;
  dismissJob: (id: string) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const { account } = useAuth();
  const [ready, setReady] = useState(false);
  const [config, setConfigState] = useState<TenantConfig>(DEFAULT_CONFIG);
  const [inventories, setInventories] = useState<Inventory[]>([]);
  const [centreId, setCentreId] = useState("ruf");
  const [density, setDensityState] = useState<Density>("compact");
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeSeq = useRef(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const jobsRef = useRef<Job[]>([]);
  const jobSeq = useRef(0);

  // Client-only boot: mock data depends on "today", and saved branding lives on this device.
  useEffect(() => {
    let cfg = DEFAULT_CONFIG;
    try {
      const raw = localStorage.getItem(CONFIG_KEY) ?? localStorage.getItem(LEGACY_CONFIG_KEY);
      const m = migrateStoredConfig(raw);
      cfg = m.config;
      if (m.migrated) {
        localStorage.setItem(CONFIG_KEY, storedConfig(cfg));
        localStorage.removeItem(LEGACY_CONFIG_KEY);
      }
      if (m.notice) setNotice({ id: ++noticeSeq.current, msg: "Configuration restaurée", kind: "warning", repeat: 0 });
    } catch {}
    setConfigState(cfg);
    let edits: Record<string, Inventory> = {};
    try {
      edits = JSON.parse(localStorage.getItem(EDITS_KEY) ?? "{}");
    } catch {}
    setInventories(generateInventories(cfg).map((i) => edits[i.id] ?? i));
    try {
      if (localStorage.getItem(DENSITY_KEY) === "expanded") setDensityState("expanded");
    } catch {}
    setReady(true);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--brand", config.branding.brand);
  }, [config.branding.brand]);

  const setConfig = useCallback((fn: (c: TenantConfig) => TenantConfig) => {
    setConfigState((prev) => {
      const next = fn(prev);
      try {
        localStorage.setItem(CONFIG_KEY, storedConfig(next));
      } catch {}
      return next;
    });
  }, []);

  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    try {
      localStorage.setItem(DENSITY_KEY, d);
    } catch {}
  }, []);

  const resetConfig = useCallback(() => {
    try {
      localStorage.removeItem(CONFIG_KEY);
      localStorage.removeItem(LEGACY_CONFIG_KEY);
      localStorage.removeItem(EDITS_KEY);
    } catch {}
    setConfigState(DEFAULT_CONFIG);
    setInventories(generateInventories(DEFAULT_CONFIG));
  }, []);

  const updateInventory = useCallback((id: string, fn: (i: Inventory) => Inventory) => {
    setInventories((list) =>
      list.map((i) => {
        if (i.id !== id) return i;
        const next = fn(i);
        try {
          const edits = JSON.parse(localStorage.getItem(EDITS_KEY) ?? "{}");
          edits[id] = next;
          localStorage.setItem(EDITS_KEY, JSON.stringify(edits));
        } catch {}
        return next;
      }),
    );
  }, []);

  // Latest wins: a new toast replaces the current one at once, never queues.
  // The same info toast again keeps its id (no re-entry) and counts a repeat.
  const toast = useCallback((msg: string, kind: NoticeKind = "info") => {
    setNotice((n) =>
      n && kind === "info" && n.kind === kind && n.msg === msg
        ? { ...n, repeat: n.repeat + 1 }
        : { id: ++noticeSeq.current, msg, kind, repeat: 0 },
    );
  }, []);

  const dismissNotice = useCallback((id: number) => setNotice((n) => (n?.id === id ? null : n)), []);

  const patchJob = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((list) => (jobsRef.current = list.map((j) => (j.id === id ? { ...j, ...patch } : j))));
  }, []);

  // A second job of a kind already running is refused, not queued: the
  // first one's result would be the same file.
  const startJob = useCallback(
    (spec: JobSpec) => {
      if (jobsRef.current.some((j) => j.kind === spec.kind && j.status === "running")) {
        toast(spec.busyMsg);
        return;
      }
      const id = `job${++jobSeq.current}`;
      const job: Job = { id, kind: spec.kind, progress: 0, status: "running", msg: "" };
      setJobs((list) => (jobsRef.current = [...list, job]));
      spec
        .run((p) => patchJob(id, { progress: Math.min(Math.max(p, 0), 1) }))
        .then((file) => {
          if (file) download(file);
          patchJob(id, { status: "done", progress: 1, msg: spec.doneMsg });
        })
        .catch((e: unknown) => {
          patchJob(id, { status: "error", msg: e instanceof Error && e.message ? e.message : "L'export a échoué" });
        });
    },
    [toast, patchJob],
  );

  const dismissJob = useCallback((id: string) => {
    setJobs((list) => (jobsRef.current = list.filter((j) => j.id !== id)));
  }, []);

  const centre = useCallback(
    (id: string) => config.centres.find((c) => c.id === id) ?? config.centres[0],
    [config.centres],
  );

  const value = useMemo<Store>(
    () => ({
      ready,
      config,
      setConfig,
      resetConfig,
      inventories,
      updateInventory,
      centreId,
      setCentreId,
      density,
      setDensity,
      centre,
      user: account ? { name: account.name, email: account.email, role: account.title } : { name: "", email: "", role: "" },
      toast,
      notice,
      dismissNotice,
      jobs,
      startJob,
      dismissJob,
    }),
    [ready, config, setConfig, resetConfig, inventories, updateInventory, centreId, density, setDensity, centre, account, toast, notice, dismissNotice, jobs, startJob, dismissJob],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
}

/** Inventories for the selected centre ("all" = every centre), newest first. */
export function useScopedInventories() {
  const { inventories, centreId } = useStore();
  return useMemo(
    () => (centreId === "all" ? inventories : inventories.filter((i) => i.centreId === centreId)),
    [inventories, centreId],
  );
}

function download({ blob, filename }: ReportFile) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Re-renders every `ms` so in-progress figures stay live. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
