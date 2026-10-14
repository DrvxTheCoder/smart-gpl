"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useAnimate, useReducedMotion, type Transition } from "motion/react";
import { useNow, useStore, type Job, type Notice, type NoticeKind } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { liveSeconds, RollingClock, RollingPercent, useStopToggle } from "@/components/production/production";
import {
  BellGlyph,
  ClockGlyph,
  ErrorGlyph,
  InfoGlyph,
  PauseGlyph,
  ProgressRing,
  SuccessGlyph,
  ViewWidthGlyph,
  WarningGlyph,
  type AnimatedIconProps,
} from "@/components/ui/animated-icons";
import { cn } from "@/lib/format";
import type { Inventory } from "@/lib/types";

export type HubVariant =
  | "idle"
  | "success"
  | "error"
  | "warning"
  | "info"
  | "bell"
  | "pause"
  | "view"
  | "activity-compact"
  | "activity-expanded"
  | "job"
  | "mini";

interface HubSize {
  width: number;
  height: number;
  borderRadius: number;
}

const TOAST: HubSize = { width: 260, height: 44, borderRadius: 22 };
const COMPACT: HubSize = { width: 212, height: 36, borderRadius: 18 };

/**
 * Every state has a fixed box; the hub springs straight to it. Content is
 * written to fit its box, never the other way round, so the shape is
 * known the moment the state changes.
 */
export const HUB_SIZES: Record<HubVariant, HubSize> = {
  idle: { width: 40, height: 8, borderRadius: 4 },
  success: TOAST,
  error: TOAST,
  warning: TOAST,
  info: TOAST,
  bell: TOAST,
  pause: TOAST,
  view: { width: 168, height: 40, borderRadius: 20 },
  "activity-compact": COMPACT,
  "activity-expanded": { width: 340, height: 116, borderRadius: 28 },
  job: COMPACT,
  mini: { width: 36, height: 36, borderRadius: 18 },
};

/** Activities shown at once: the main pill and one circle docked to its right. */
const MAX_ACTIVITIES = 2;
const GAP = 8;

// Status tones lifted toward white so they read on the dark hub.
const OK = "text-[color-mix(in_oklab,var(--ok)_55%,white)]";
const WARN = "text-[color-mix(in_oklab,var(--warn)_70%,white)]";
const ALERT = "text-[color-mix(in_oklab,var(--alert)_60%,white)]";

const KINDS: Record<NoticeKind, { variant: HubVariant; Glyph: (p: AnimatedIconProps) => React.JSX.Element; tint: string; ms: number }> = {
  info: { variant: "info", Glyph: InfoGlyph, tint: "text-white/75", ms: 3000 },
  success: { variant: "success", Glyph: SuccessGlyph, tint: OK, ms: 2600 },
  warning: { variant: "warning", Glyph: WarningGlyph, tint: WARN, ms: 3400 },
  error: { variant: "error", Glyph: ErrorGlyph, tint: ALERT, ms: 4000 },
  bell: { variant: "bell", Glyph: BellGlyph, tint: "text-white/75", ms: 3000 },
  pause: { variant: "pause", Glyph: PauseGlyph, tint: WARN, ms: 1400 },
  expanded: { variant: "view", Glyph: (p) => <ViewWidthGlyph {...p} to="expanded" />, tint: "text-white/75", ms: 1400 },
  compact: { variant: "view", Glyph: (p) => <ViewWidthGlyph {...p} to="compact" />, tint: "text-white/75", ms: 1400 },
};

/** A settled job reads like the matching toast, and stays as long. */
const outcomeKind = (job: Job): NoticeKind => (job.status === "error" ? "error" : "success");

/** The one spring every size change uses. */
const MORPH: Transition = { type: "spring", visualDuration: 0.42, bounce: 0.28 };
const EASE_OUT = [0.2, 0.9, 0.25, 1] as const;
const SHAKE = { x: [0, -6, 5, -3, 2, 0] };

/** Something running that the hub keeps on screen until it ends. */
type Activity = { id: string; kind: "inventory"; inv: Inventory } | { id: string; kind: "job"; job: Job };

const SURFACE =
  "absolute bottom-0 left-0 overflow-hidden bg-brand-950 text-white shadow-[0_14px_34px_-12px_rgba(4,17,10,0.6)] ring-1 ring-white/10";

/**
 * Dark hub, bottom centre. It holds up to two activities: the primary is
 * the main pill, the other a circle docked to its right showing only its
 * indicator, and tapping the circle swaps them. Each activity keeps its own
 * element, so a swap morphs size, position and content in place. A toast
 * takes over the main pill at once, then hands back.
 */
export function Island() {
  const { notice, dismissNotice, inventories, centreId, jobs, dismissJob } = useStore();
  const { account } = useAuth();
  const path = usePathname();
  const reduce = !!useReducedMotion();
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState<string | null>(null);
  const vw = useViewportWidth();

  const live =
    inventories.find((i) => i.status === "EN_COURS" && (centreId === "all" || i.centreId === centreId)) ?? null;
  // The dashboard and the inventory itself already show the timer card.
  // The live inventory belongs to production: other modules never see it.
  const showLive = !!live && !!account?.modules.includes("production") && path !== "/" && path !== `/inventaires/${live.id}`;

  // The inventory comes first, so it's the main pill unless the user swapped.
  // Past the limit, activities wait their turn; jobs keep running meanwhile.
  const activities: Activity[] = [
    ...(showLive && live ? [{ id: `inv-${live.id}`, kind: "inventory" as const, inv: live }] : []),
    ...jobs.map((job) => ({ id: job.id, kind: "job" as const, job })),
  ].slice(0, MAX_ACTIVITIES);
  // Who holds the main pill: an outcome first, then the user's pick (a job
  // they just started counts), then the inventory.
  const settledOnScreen = activities.find((a) => a.kind === "job" && a.job.status !== "running");
  const primary =
    settledOnScreen ??
    activities.find((a) => a.id === pinned) ??
    activities[0] ??
    null;
  const expanded = !notice && primary?.kind === "inventory" && open;
  // The details take the whole hub; the circle steps aside meanwhile.
  const secondary = expanded ? null : (activities.find((a) => a !== primary) ?? null);

  // The main pill is the primary activity's element. With none left it stays
  // the last one's, so an outcome or a toast morphs on in place.
  const lastMain = useRef("hub");
  if (primary) lastMain.current = primary.id;
  const mainKey = primary?.id ?? lastMain.current;

  const variant: HubVariant = notice
    ? KINDS[notice.kind].variant
    : !primary
      ? "idle"
      : primary.kind === "inventory"
        ? open
          ? "activity-expanded"
          : "activity-compact"
        : primary.job.status === "running"
          ? "job"
          : KINDS[outcomeKind(primary.job)].variant;
  const size = fit(HUB_SIZES[variant], vw, secondary ? 2 * (HUB_SIZES.mini.width + GAP) : 0);
  // Keys the main content: a new key swaps it, whatever was there.
  const key = notice
    ? `n${notice.id}`
    : !primary
      ? "idle"
      : primary.kind === "inventory"
        ? `live-${open ? "open" : "pill"}-${!!primary.inv.pausedAt}`
        : `job-${primary.job.status}`;
  const idle = variant === "idle";

  // Collapse the details when leaving the page or when the activity ends.
  useEffect(() => setOpen(false), [path, showLive]);

  // Outside click or Escape folds the details back.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!scope.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, scope]);

  // Hiding drops pointer events, so a pending hover-end may never arrive.
  useEffect(() => setHover(false), [notice?.id]);

  // One timer, for the notice on screen; replaced or hovered, it's cancelled.
  useEffect(() => {
    if (!notice || hover) return;
    const t = setTimeout(() => dismissNotice(notice.id), KINDS[notice.kind].ms);
    return () => clearTimeout(t);
  }, [notice, hover, dismissNotice]);

  // A settled job shows its outcome as long as the matching toast would,
  // counted from when it's on screen: a queued one waits for its slot.
  const onScreen = activities.map((a) => a.id).join(" ");
  const scheduled = useRef(new Set<string>());
  useEffect(() => {
    const ids = onScreen.split(" ");
    for (const j of jobs) {
      if (j.status === "running" || scheduled.current.has(j.id) || !ids.includes(j.id)) continue;
      scheduled.current.add(j.id);
      setTimeout(() => dismissJob(j.id), KINDS[outcomeKind(j)].ms);
    }
  }, [jobs, onScreen, dismissJob]);

  // Starting a job is a deliberate act: it takes the main pill and keeps it
  // until the user swaps or it ends.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const fresh = jobs.find((j) => j.status === "running" && !seen.current.has(j.id));
    for (const j of jobs) seen.current.add(j.id);
    if (fresh) setPinned(fresh.id);
  }, [jobs]);

  // Errors, and an info toast raised again, give the hub a short head shake.
  useEffect(() => {
    if (!notice || reduce || !scope.current) return;
    if (notice.repeat > 0) animate(scope.current, SHAKE, { duration: 0.4, ease: "easeOut" });
    else if (notice.kind === "error") animate(scope.current, SHAKE, { duration: 0.45, ease: "easeOut", delay: 0.1 });
  }, [notice, reduce, animate, scope]);
  const failed = jobs.filter((j) => j.status === "error" && onScreen.split(" ").includes(j.id)).length;
  useEffect(() => {
    if (failed && !reduce && scope.current) animate(scope.current, SHAKE, { duration: 0.45, ease: "easeOut", delay: 0.1 });
  }, [failed, reduce, animate, scope]);

  const swap = () => {
    if (!secondary) return;
    setOpen(false);
    setPinned(secondary.id);
  };

  // Announced separately so the morphing visuals never re-read.
  const settled = jobs.filter((j) => j.status !== "running");
  const polite = [notice && notice.kind !== "error" ? notice.msg : "", ...settled.filter((j) => j.status === "done").map((j) => j.msg)];
  const assertive = [notice?.kind === "error" ? notice.msg : "", ...settled.filter((j) => j.status === "error").map((j) => j.msg)];

  const transition = reduce ? { duration: 0 } : { ...MORPH, opacity: { duration: 0.18 } };
  const mini = HUB_SIZES.mini;
  // The circle is centred on the pill's height. It enters and leaves tucked
  // behind the pill's right end, as if it budded off it.
  const miniY = -(size.height - mini.height) / 2;
  const tucked = { x: size.width / 2 - mini.width, y: miniY, ...mini, opacity: 0, scale: 0.6 };

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {polite.filter(Boolean).join(". ")}
      </div>
      <div className="sr-only" role="alert">
        {assertive.filter(Boolean).join(". ")}
      </div>

      {/* A zero-size anchor at bottom centre; each element places itself
          from it, so the pill and the circle can trade places. */}
      <div ref={scope} className="pointer-events-none fixed bottom-6 left-1/2 z-50">
        <AnimatePresence initial={false}>
          <motion.div
            key={mainKey}
            aria-hidden={idle}
            initial={reduce ? { opacity: 0 } : { x: -HUB_SIZES.idle.width / 2, y: 0, ...HUB_SIZES.idle, opacity: 0, scale: 1 }}
            animate={{ x: -size.width / 2, y: 0, ...size, opacity: idle ? 0 : 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: reduce ? 0.1 : 0.18 } }}
            transition={transition}
            onHoverStart={() => setHover(true)}
            onHoverEnd={() => setHover(false)}
            className={cn(SURFACE, "z-10", !idle && "pointer-events-auto")}
          >
            <AnimatePresence initial={false}>
              {!idle && (
                <Slot key={key} size={size} reduce={reduce}>
                  {notice ? (
                    <NoticeView notice={notice} reduce={reduce} onClose={() => dismissNotice(notice.id)} />
                  ) : primary?.kind === "inventory" ? (
                    open ? (
                      <LiveExpanded inv={primary.inv} reduce={reduce} />
                    ) : (
                      <LiveCompact inv={primary.inv} reduce={reduce} onOpen={() => setOpen(true)} />
                    )
                  ) : primary?.kind === "job" ? (
                    primary.job.status === "running" ? (
                      <JobCompact job={primary.job} reduce={reduce} />
                    ) : (
                      <JobOutcome job={primary.job} reduce={reduce} onClose={() => dismissJob(primary.job.id)} />
                    )
                  ) : null}
                </Slot>
              )}
            </AnimatePresence>
          </motion.div>
          {secondary && (
            <motion.div
              key={secondary.id}
              initial={reduce ? { opacity: 0 } : tucked}
              animate={{ x: size.width / 2 + GAP, y: miniY, ...mini, opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : tucked}
              transition={transition}
              className={cn(SURFACE, "pointer-events-auto")}
            >
              <AnimatePresence initial={false}>
                <Slot key={miniKey(secondary)} size={mini} reduce={reduce}>
                  <MiniView activity={secondary} reduce={reduce} onSwap={swap} />
                </Slot>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

const miniKey = (a: Activity) => (a.kind === "inventory" ? `mini-${!!a.inv.pausedAt}` : `mini-${a.job.status}`);

/**
 * Content box at its variant's own size, centred in the hub and clipped by
 * it. Mid-morph it never reflows; it just shows more or less of itself.
 * Incoming fades up with a little blur; outgoing leaves fast, out of flow.
 */
function Slot({ size, reduce, children }: { size: HubSize; reduce: boolean; children: React.ReactNode }) {
  return (
    <motion.div
      className="absolute inset-0 m-auto"
      style={{ width: size.width, height: size.height }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92, filter: "blur(6px)" }}
      animate={{
        opacity: 1,
        scale: 1,
        filter: "blur(0px)",
        transition: reduce ? { duration: 0.15 } : { duration: 0.26, ease: EASE_OUT, delay: 0.04 },
      }}
      exit={{
        opacity: 0,
        ...(reduce ? {} : { scale: 0.96, filter: "blur(2px)" }),
        pointerEvents: "none",
        transition: { duration: reduce ? 0.1 : 0.12, ease: "easeIn" },
      }}
    >
      {children}
    </motion.div>
  );
}

function NoticeView({ notice, reduce, onClose }: { notice: Notice; reduce: boolean; onClose: () => void }) {
  const { Glyph, tint } = KINDS[notice.kind];
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={`${notice.msg} (fermer)`}
      className="flex size-full items-center gap-2.5 pr-4 pl-2.5 whitespace-nowrap"
    >
      {/* Glyph centred on the pill's end radius; message centred in what's left. */}
      <span className={cn("grid size-6 shrink-0 place-items-center", tint)}>
        <Glyph className="size-[21px]" still={reduce} />
      </span>
      <span className="min-w-0 flex-1 truncate text-center text-[14px]">{notice.msg}</span>
    </button>
  );
}

/** A running job: its ring, what it is, and how far along. */
function JobCompact({ job, reduce }: { job: Job; reduce: boolean }) {
  const pct = Math.round(job.progress * 100);
  return (
    <div
      role="progressbar"
      aria-label="Export en cours"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="flex size-full items-center gap-2 pr-3.5 pl-2 whitespace-nowrap"
    >
      <span className={cn("grid shrink-0 place-items-center", OK)}>
        <ProgressRing className="size-5" progress={job.progress} still={reduce} />
      </span>
      <span className="min-w-0 flex-1 truncate text-center text-[13px] text-white/65">Export en cours</span>
      {/* Fixed box, right-aligned: up to "100 %" fits, so the label never shifts. */}
      <span className="flex w-11 shrink-0 justify-end">
        <RollingPercent value={pct} className="text-[13px]" />
      </span>
    </div>
  );
}

/** A settled job, worded and drawn like the matching toast. */
function JobOutcome({ job, reduce, onClose }: { job: Job; reduce: boolean; onClose: () => void }) {
  return <NoticeView notice={{ id: 0, msg: job.msg, kind: outcomeKind(job), repeat: 0 }} reduce={reduce} onClose={onClose} />;
}

/** The docked circle: only the activity's indicator. Tapping it swaps. */
function MiniView({ activity, reduce, onSwap }: { activity: Activity; reduce: boolean; onSwap: () => void }) {
  let label: string;
  let glyph: React.ReactNode;
  if (activity.kind === "inventory") {
    const paused = !!activity.inv.pausedAt;
    label = paused ? "Arrêt en cours, afficher" : "Inventaire en cours, afficher";
    glyph = <LiveGlyph paused={paused} reduce={reduce} className="size-5 text-white" />;
  } else if (activity.job.status === "running") {
    label = `Export en cours, ${Math.round(activity.job.progress * 100)} %, afficher`;
    glyph = (
      <span className={cn("grid place-items-center", OK)}>
        <ProgressRing className="size-5" progress={activity.job.progress} still={reduce} />
      </span>
    );
  } else {
    const { Glyph, tint } = KINDS[outcomeKind(activity.job)];
    label = `${activity.job.msg}, afficher`;
    glyph = (
      <span className={cn("grid place-items-center", tint)}>
        <Glyph className="size-5" still={reduce} />
      </span>
    );
  }
  return (
    <button type="button" onClick={onSwap} aria-label={label} className="grid size-full cursor-pointer place-items-center">
      {glyph}
    </button>
  );
}

/** Live figures for an inventory: productive time, or the running stop. */
function useLive(inv: Inventory) {
  const { config } = useStore();
  const now = useNow(1000);
  const paused = !!inv.pausedAt;
  const secs = paused
    ? Math.max(Math.floor((now.getTime() - new Date(inv.pausedAt!).getTime()) / 1000), 0)
    : Math.floor(liveSeconds(inv, now, config.rules.lunchBreakMin));
  return { paused, secs, name: config.centres.find((c) => c.id === inv.centreId)?.name ?? "" };
}

function LiveGlyph({ paused, reduce, className }: { paused: boolean; reduce: boolean; className: string }) {
  return (
    <span className={cn("grid shrink-0 place-items-center", paused ? WARN : OK)}>
      {paused ? <PauseGlyph className={className} still={reduce} breathe /> : <ClockGlyph className={className} still={reduce} />}
    </span>
  );
}

function LiveCompact({ inv, reduce, onOpen }: { inv: Inventory; reduce: boolean; onOpen: () => void }) {
  const { paused, name, secs } = useLive(inv);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={false}
      aria-label={paused ? `Arrêt en cours à ${name}, afficher le détail` : `Inventaire en cours à ${name}, afficher le détail`}
      className="flex size-full items-center justify-center gap-2 pr-3.5 pl-2 whitespace-nowrap cursor-pointer"
    >
      <LiveGlyph paused={paused} reduce={reduce} className="size-5 text-white" />
      <span className="min-w-0 flex-1 truncate text-center text-[13px] text-white/65">{paused ? "Arrêt" : name}</span>
      <RollingClock seconds={secs} tight className="shrink-0 text-[13px]" />
    </button>
  );
}

function LiveExpanded({ inv, reduce }: { inv: Inventory; reduce: boolean }) {
  const { paused, name, secs } = useLive(inv);
  const router = useRouter();
  const toggle = useStopToggle(inv);
  const stops = inv.stops.length;
  return (
    <div className="flex size-full flex-col justify-between p-4 whitespace-nowrap">
      <div className="flex items-center gap-3">
        <LiveGlyph paused={paused} reduce={reduce} className="size-8 text-white" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] text-white/60">{paused ? "Arrêt en cours" : "Inventaire en cours"}</p>
          <p className="truncate text-[14px] font-medium">{name}</p>
        </div>
        <RollingClock seconds={secs} tight className="shrink-0 text-[22px]" />
      </div>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] text-white/60">
          {paused ? "Temps utile en pause" : `Depuis ${inv.heureDebut} · ${stops} arrêt${stops > 1 ? "s" : ""}`}
        </span>
        <button
          type="button"
          onClick={toggle}
          className="h-8 shrink-0 rounded-full bg-white/12 px-3.5 text-[13px] font-medium hover:bg-white/20 cursor-pointer"
        >
          {paused ? "Reprendre" : "Arrêt"}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/inventaires/${inv.id}`)}
          className="h-8 shrink-0 rounded-full bg-white px-3.5 text-[13px] font-medium text-brand-950 hover:bg-white/85 cursor-pointer"
        >
          Ouvrir
        </button>
      </div>
    </div>
  );
}

/** Narrow screens keep a 16px gutter each side, plus room for the docked circle. */
function fit(size: HubSize, vw: number, reserve = 0): HubSize {
  return { ...size, width: Math.min(size.width, vw - 32 - reserve) };
}

function useViewportWidth() {
  const [vw, setVw] = useState(Infinity);
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vw;
}
