"use client";

import { Pause, Play } from "@/components/ui/icons";
import { toMin } from "@/lib/calc";
import { useNow, useStore } from "@/lib/store";
import { cn, fmt } from "@/lib/format";
import { levelTone, type LevelTone } from "@/lib/tankLevel";
import type { Inventory } from "@/lib/types";

/* Rolling odometer digits — each digit is a 0–9 column that slides. */
function Digit({ d, tight }: { d: number; tight?: boolean }) {
  return (
    <span
      className={cn("relative inline-block h-[1em] overflow-hidden leading-none", tight ? "w-[0.68em]" : "w-[0.70em]")}
      aria-hidden
    >
      <span
        className="absolute inset-x-0 top-0 flex flex-col items-center transition-transform duration-500 ease-[cubic-bezier(.3,1.25,.5,1)]"
        style={{ transform: `translateY(${-d * 10}%)` }}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className="block h-[1em] w-full text-center leading-[1em]"
          >
            {i}
          </span>
        ))}
      </span>
    </span>
  );
}

/** A whole percentage on the same rolling digits as the clock. */
export function RollingPercent({ value, className }: { value: number; className?: string }) {
  const digits = String(Math.min(Math.max(Math.round(value), 0), 100)).split("");
  return (
    <span aria-label={`${digits.join("")} %`} className={cn("tnum inline-flex items-center font-medium tracking-[-0.03em]", className)}>
      {/* Keyed from the right, so the units digit keeps rolling as tens appear. */}
      {digits.map((d, i) => (
        <Digit key={digits.length - i} d={Number(d)} tight />
      ))}
      <span aria-hidden className="ml-[0.2em]">%</span>
    </span>
  );
}

/** `tight` packs the digits closer, for small sizes where fixed gaps read loose. */
export function RollingClock({ seconds, className, tight }: { seconds: number; className?: string; tight?: boolean }) {
  const s = Math.max(Math.floor(seconds), 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const parts = [h, m, r].map((n) => String(n).padStart(2, "0"));
  const label = `${h} heures ${m} minutes ${r} secondes`;
  return (
    <span role="timer" aria-label={label} className={cn("tnum inline-flex items-center font-medium tracking-[-0.03em]", className)}>
      {parts.map((p, i) => (
        <span key={i} className={cn("inline-flex items-center", tight ? "gap-0" : "gap-0.5")}>
          {i > 0 && <span className={cn("-translate-y-[0.06em] opacity-70", tight && "mx-[0.04em]")}>:</span>}
          <Digit d={Number(p[0])} tight={tight} />
          <Digit d={Number(p[1])} tight={tight} />
        </span>
      ))}
    </span>
  );
}

/** Live productive time for an inventory in progress: elapsed − lunch − stops − running pause. */
export function liveSeconds(inv: Inventory, now: Date, lunchMin: number) {
  const start = toMin(inv.heureDebut) ?? 480;
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  let elapsed = nowSec - start * 60;
  if (elapsed < 0) elapsed += 86400;
  if (elapsed > 5 * 3600) elapsed -= lunchMin * 60; // lunch taken after five hours
  const stops = inv.stops.reduce((a, s) => a + s.minutes, 0) * 60;
  const paused = inv.pausedAt ? Math.max((now.getTime() - new Date(inv.pausedAt).getTime()) / 1000, 0) : 0;
  return Math.max(elapsed - stops - paused, 0);
}

/** Starts a stop (productive time pauses), or ends the running one and records it. */
export function useStopToggle(inv: Inventory) {
  const { updateInventory, toast, user } = useStore();
  return () => {
    if (!inv.pausedAt) {
      updateInventory(inv.id, (i) => ({ ...i, pausedAt: new Date().toISOString() }));
      toast("Arrêt démarré", "pause");
      return;
    }
    const minutes = Math.max(Math.round((Date.now() - new Date(inv.pausedAt).getTime()) / 60000), 1);
    updateInventory(inv.id, (i) => ({
      ...i,
      pausedAt: undefined,
      stops: [
        ...i.stops,
        { id: crypto.randomUUID(), type: "Autre", minutes, note: "Saisi depuis le chronomètre", author: user.name, at: new Date().toISOString() },
      ],
    }));
    toast(`Arrêt ajouté · ${minutes} min`, "success");
  };
}

export function LiveTimerCard({ inv, compact }: { inv: Inventory; compact?: boolean }) {
  const now = useNow(1000);
  const { config } = useStore();
  const secs = inv.status === "EN_COURS" ? liveSeconds(inv, now, config.rules.lunchBreakMin) : 0;
  const pausedFor = inv.pausedAt ? Math.floor((now.getTime() - new Date(inv.pausedAt).getTime()) / 1000) : 0;

  const toggle = useStopToggle(inv);

  return (
    <div className={cn("surface-deep contours relative flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] p-5", compact && "p-4")}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[17px] font-medium">Temps utile</h2>
        {inv.pausedAt && (
          <span className="tnum rounded-md bg-warn/90 px-2 py-0.5 text-[12px] font-medium text-white">
            Arrêt {Math.floor(pausedFor / 60)}:{String(pausedFor % 60).padStart(2, "0")}
          </span>
        )}
      </div>
      <div className="flex flex-1 items-center justify-center py-3">
        <RollingClock seconds={secs} className={cn(compact ? "text-[40px]" : "text-[44px] xl:text-[50px]", inv.pausedAt && "opacity-60")} />
      </div>
      <div className="w-full flex items-center justify-between">
        <p className="max-w-[150px] text-[12px] leading-snug text-white/70">
          {inv.pausedAt ? "Reprendre enregistre l'arrêt" : `Depuis ${inv.heureDebut}, ${inv.stops.length} arrêt${inv.stops.length > 1 ? "s" : ""}`}
        </p>
        <button
          type="button"
          onClick={toggle}
          disabled={inv.status !== "EN_COURS"}
          aria-label={inv.pausedAt ? "Reprendre la production et enregistrer l'arrêt" : "Démarrer un arrêt"}
          className="grid size-12 place-items-center rounded-full bg-white text-brand-950 transition-transform hover:scale-105 disabled:opacity-40"
        >
          {inv.pausedAt ? <Play className="size-5 translate-x-px fill-current" /> : <Pause className="size-5 fill-current" />}
        </button>
      </div>
    </div>
  );
}

/* Horizontal tank level: liquid solid, headspace hatched. */
const TONE_BAR: Record<LevelTone, string> = { ok: "bg-brand-800", warn: "bg-warn", alert: "bg-alert" };

/** Name and tonnage over a fill bar. `children` (e.g. an illustration) sits between the two. */
export function TankLevel({ name, pct, tonnes, capT, capM3, children }: { name: string; pct: number; tonnes: number; capT: number; capM3: number; children?: React.ReactNode }) {
  const p = Math.min(Math.max(pct, 0), 100);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2">
      <span className="text-[15px] font-medium">{name}</span>
      <span className="tnum text-[13px] text-muted">
        <b className="font-semibold text-ink">{fmt(tonnes, 1)}</b> / {fmt(capT, 0)} T ({fmt(capM3, 0)} m³)
      </span>
      {children && <div className="col-span-2">{children}</div>}
      <div
        className="hatch col-span-2 h-3 overflow-hidden rounded-full"
        role="progressbar"
        aria-label={`Remplissage ${name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(p)}
        aria-valuetext={`${fmt(p, 0)} %, ${fmt(tonnes, 1)} T sur ${fmt(capT, 0)} T`}
      >
        <div className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-700", TONE_BAR[levelTone(p)])} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}
