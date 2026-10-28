"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MotionConfig, motion } from "motion/react";
import { ChevronRight, Lock, Truck } from "@/components/ui/icons";
import { Button, ButtonLink, Dialog } from "@/components/ui/primitives";
import { ConfirmCount } from "@/components/sales/warehouse-ui";
import { TonePill } from "@/components/sales/ui";
import { useStore } from "@/lib/store";
import { useSales } from "@/lib/sales/store";
import { advanceDispatch, confirmParty, dispatchContext } from "@/lib/sales/commands/dispatch";
import { blockers, DISPATCH_FLOW, type Failure } from "@/lib/sales/lifecycle";
import { BOARD_COLUMNS, CONFIRMED_ON_DROP, moveFor, NEXT_ACTION, type DispatchAction, type Move } from "@/lib/sales/board";
import { gridTotal } from "@/lib/sales/bottle-ledger";
import { dayOf } from "@/lib/sales/dates";
import { MODE } from "@/lib/sales/labels";
import { cap, cn, fmt, fmtDate, fmtMoney } from "@/lib/format";
import { BULK, type Confirmation, type Dispatch, type DispatchStatus, type Order } from "@/lib/sales/types";

/* ------------------------------------------------------------------
   Truck board. A card moves to the next column by drag (mouse, or a
   long press on touch), by keyboard (Space, arrows, Space), or with its
   « étape suivante » button. Every move is a lifecycle transition: steps
   that write ledger rows or need a confirmation open a dialog first.
   ------------------------------------------------------------------ */

type Drag = { id: string; from: DispatchStatus; over: DispatchStatus | null; via: "pointer" | "keyboard" };
type Pending = { id: string; from: DispatchStatus; pointerId: number; x0: number; y0: number; touch: boolean; el: HTMLElement; timer: number | null };

const LONG_PRESS = 280;
const EDGE = 56;
// Guards a dialog settles in place, so they are not listed as blockers there.
const INLINE_GUARDS = new Set(["gateCount", "loadingConfirmed", "pod"]);

const time = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

export function DispatchBoard({ list, day }: { list: Dispatch[]; day: string }) {
  const { config, toast } = useStore();
  const { data, env, exec } = useSales();
  const steps = config.sales.workflow.steps;
  const orders = useMemo(() => new Map(data.orders.map((o) => [o.id, o])), [data.orders]);
  const names = useMemo(() => new Map(data.customers.map((c) => [c.id, c.name])), [data.customers]);

  // What still blocks each truck's next step, for the card pill and the drop hint.
  const pending = useMemo(() => {
    const out = new Map<string, Failure[]>();
    for (const d of list) {
      const next = NEXT_ACTION[d.status];
      const ctx = next && dispatchContext(env, d);
      out.set(d.id, next && ctx ? blockers(DISPATCH_FLOW, next.action, d.status, ctx, steps) : []);
    }
    return out;
  }, [list, env, steps]);

  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const [ghostWidth, setGhostWidth] = useState(0);
  const [dialog, setDialog] = useState<{ id: string; action: DispatchAction } | null>(null);
  const [recent, setRecent] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const ghost = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const press = useRef<Pending | null>(null);
  const point = useRef({ x: 0, y: 0, dx: 0, dy: 0 });
  const suppressClick = useRef(false);
  const refocus = useRef<string | null>(null);
  const hintId = useId();

  const byId = useCallback((id: string) => list.find((d) => d.id === id), [list]);
  const modeOf = useCallback((d: Dispatch) => orders.get(d.orderId)?.mode ?? "LIVRAISON", [orders]);
  const colTitle = (s: DispatchStatus) => BOARD_COLUMNS.find((c) => c.status === s)?.title ?? s;

  const flash = (id: string) => {
    setRecent(id);
    window.setTimeout(() => setRecent((r) => (r === id ? null : r)), 1600);
  };

  /** Runs a move: at once when nothing is left to confirm, else through the dialog. */
  const start = (d: Dispatch, action: DispatchAction) => {
    refocus.current = d.id;
    const left = pending.get(d.id) ?? [];
    if (CONFIRMED_ON_DROP.includes(action) || left.length) {
      setDialog({ id: d.id, action });
      return;
    }
    const r = exec((e) => advanceDispatch(e, d.id, action));
    if (r.ok) flash(d.id);
  };

  const drop = (d: Dispatch, to: DispatchStatus | null) => {
    if (!to) return;
    const m = moveFor(d.status, to, modeOf(d));
    if (!m) return;
    if (!m.ok) {
      toast(m.reason, "warning");
      return;
    }
    start(d, m.action);
  };

  /* ---------- pointer ---------- */

  const columnAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-column]");
    return (el?.dataset.column as DispatchStatus | undefined) ?? null;
  };

  const placeGhost = () => {
    const g = ghost.current;
    if (g) g.style.transform = `translate3d(${point.current.x - point.current.dx}px, ${point.current.y - point.current.dy}px, 0)`;
  };

  // Window listeners stay the same functions for removal; they call this render's handlers.
  const onMove = useRef<(e: PointerEvent) => void>(() => {});
  const onUp = useRef<(e: PointerEvent) => void>(() => {});
  const onCancel = useRef<(e: PointerEvent) => void>(() => {});
  const [listeners] = useState(() => ({
    move: (e: PointerEvent) => onMove.current(e),
    up: (e: PointerEvent) => onUp.current(e),
    cancel: (e: PointerEvent) => onCancel.current(e),
  }));

  const noScroll = useCallback((e: TouchEvent) => e.preventDefault(), []);

  const cleanup = useCallback(() => {
    const p = press.current;
    if (p?.timer) window.clearTimeout(p.timer);
    press.current = null;
    window.removeEventListener("pointermove", listeners.move);
    window.removeEventListener("pointerup", listeners.up);
    window.removeEventListener("pointercancel", listeners.cancel);
    document.removeEventListener("touchmove", noScroll);
    document.documentElement.style.removeProperty("user-select");
    document.documentElement.style.removeProperty("cursor");
  }, [noScroll, listeners]);

  const begin = () => {
    const p = press.current;
    if (!p) return;
    if (p.timer) window.clearTimeout(p.timer);
    p.timer = null;
    const r = p.el.getBoundingClientRect();
    point.current = { x: p.x0, y: p.y0, dx: p.x0 - r.left, dy: p.y0 - r.top };
    setGhostWidth(r.width);
    setDrag({ id: p.id, from: p.from, over: p.from, via: "pointer" });
    document.addEventListener("touchmove", noScroll, { passive: false });
    document.documentElement.style.setProperty("user-select", "none");
    document.documentElement.style.setProperty("cursor", "grabbing");
    if (p.touch) navigator.vibrate?.(8);
  };

  onMove.current = (e) => {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    if (!dragRef.current) {
      const dist = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
      if (p.touch) {
        // Moving before the long press ends is a scroll, not a drag.
        if (dist > 8) cleanup();
        return;
      }
      if (dist < 5) return;
      begin();
    }
    point.current.x = e.clientX;
    point.current.y = e.clientY;
    placeGhost();
    const over = columnAt(e.clientX, e.clientY);
    const cur = dragRef.current;
    if (cur && over !== cur.over) setDrag({ ...cur, over });
  };

  onUp.current = (e) => {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    const cur = dragRef.current;
    cleanup();
    if (!cur) return;
    suppressClick.current = true;
    window.setTimeout(() => (suppressClick.current = false), 0);
    setDrag(null);
    const d = byId(cur.id);
    if (d) drop(d, columnAt(e.clientX, e.clientY));
  };

  onCancel.current = () => {
    cleanup();
    setDrag(null);
  };

  const pointerDown = (e: React.PointerEvent<HTMLElement>, d: Dispatch) => {
    if (e.button !== 0 || dragRef.current || !NEXT_ACTION[d.status]) return;
    if ((e.target as HTMLElement).closest("button")) return;
    const touch = e.pointerType !== "mouse";
    press.current = { id: d.id, from: d.status, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, touch, el: e.currentTarget, timer: touch ? window.setTimeout(begin, LONG_PRESS) : null };
    window.addEventListener("pointermove", listeners.move);
    window.addEventListener("pointerup", listeners.up);
    window.addEventListener("pointercancel", listeners.cancel);
  };

  useEffect(() => cleanup, [cleanup]);

  useLayoutEffect(() => {
    if (drag?.via === "pointer") placeGhost();
  }, [drag?.id, drag?.via]);

  // Edge auto-scroll while dragging: sideways in the board, up and down in the page.
  const dragging = drag?.via === "pointer";
  useEffect(() => {
    if (!dragging) return;
    let raf = 0;
    const tick = () => {
      const { x, y } = point.current;
      const s = scroller.current;
      if (s) {
        const r = s.getBoundingClientRect();
        if (x < r.left + EDGE) s.scrollLeft -= Math.ceil((r.left + EDGE - x) / 4);
        else if (x > r.right - EDGE) s.scrollLeft += Math.ceil((x - r.right + EDGE) / 4);
      }
      if (y < EDGE) window.scrollBy(0, -Math.ceil((EDGE - y) / 4));
      else if (y > window.innerHeight - EDGE) window.scrollBy(0, Math.ceil((y - window.innerHeight + EDGE) / 4));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dragging]);

  /* ---------- keyboard ---------- */

  const hint = (d: Dispatch, over: DispatchStatus) => {
    const m = moveFor(d.status, over, modeOf(d));
    if (!m) return `Colonne d'origine, « ${colTitle(over)} ».`;
    if (!m.ok) return `« ${colTitle(over)} » : ${m.reason}`;
    return `« ${colTitle(over)} » : déposer pour ${NEXT_ACTION[d.status]!.label.toLowerCase()}.`;
  };

  const keyDown = (e: React.KeyboardEvent, d: Dispatch) => {
    const cur = dragRef.current;
    if (!cur) {
      if (e.key === " " && NEXT_ACTION[d.status]) {
        e.preventDefault();
        setDrag({ id: d.id, from: d.status, over: d.status, via: "keyboard" });
        setAnnounce(`Camion ${d.truck} saisi dans « ${colTitle(d.status)} ». Flèches gauche et droite pour choisir la colonne, Espace pour déposer, Échap pour annuler.`);
      }
      return;
    }
    if (cur.id !== d.id || cur.via !== "keyboard") return;
    const i = BOARD_COLUMNS.findIndex((c) => c.status === cur.over);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = BOARD_COLUMNS[Math.min(Math.max(i + (e.key === "ArrowRight" ? 1 : -1), 0), BOARD_COLUMNS.length - 1)].status;
      setDrag({ ...cur, over: next });
      setAnnounce(hint(d, next));
      document.querySelector(`[data-column="${next}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      setDrag(null);
      const m: Move = cur.over ? moveFor(d.status, cur.over, modeOf(d)) : null;
      setAnnounce(m?.ok ? `Déposé dans « ${colTitle(cur.over!)} ».` : "Déplacement annulé.");
      drop(d, cur.over);
    } else if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      setDrag(null);
      setAnnounce("Déplacement annulé.");
    }
  };

  // A card that changed column remounts: give it the focus back.
  useEffect(() => {
    const id = refocus.current;
    if (dialog || !id) return;
    refocus.current = null;
    const a = document.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"] a`);
    if (a && document.activeElement !== a) a.focus({ preventScroll: true });
  }, [dialog, list]);

  const dragged = drag ? byId(drag.id) : undefined;

  return (
    <MotionConfig reducedMotion="user">
      <p id={hintId} className="sr-only">
        Espace pour saisir un camion, flèches gauche et droite pour choisir la colonne, Espace pour déposer, Échap pour annuler. Entrée ouvre la fiche.
      </p>
      <div className="sr-only" role="status" aria-live="assertive">
        {announce}
      </div>

      {/* On a narrow screen one column shows at a time: jump to the others. */}
      <nav className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 sm:-mx-5 sm:px-5 xl:hidden" aria-label="Aller à une étape">
        {BOARD_COLUMNS.map((col) => {
          const n = list.filter((d) => d.status === col.status).length;
          return (
            <button
              key={col.status}
              type="button"
              onClick={() => document.querySelector(`[data-column="${col.status}"]`)?.scrollIntoView({ block: "nearest", inline: "start", behavior: "smooth" })}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-card px-3.5 text-[13px] font-medium ring-1 ring-line transition-colors hover:bg-brand-50"
            >
              {col.title}
              <span className="tnum text-muted">{n}</span>
            </button>
          );
        })}
      </nav>

      <div ref={scroller} className="no-scrollbar -mx-4 -mt-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pt-1 pb-2 sm:-mx-5 sm:px-5 xl:snap-none" role="list" aria-label="Tableau des camions par étape">
        {BOARD_COLUMNS.map((col) => {
          const items = list.filter((d) => d.status === col.status);
          const move = dragged && drag ? moveFor(dragged.status, col.status, modeOf(dragged)) : null;
          const over = drag?.over === col.status;
          const left = dragged ? (pending.get(dragged.id) ?? []).filter((f) => !INLINE_GUARDS.has(f.guard)) : [];
          const state = !drag || !move ? "idle" : move.ok ? (left.length ? "blocked" : "ready") : "invalid";
          return (
            <section
              key={col.status}
              role="listitem"
              data-column={col.status}
              aria-labelledby={`col-${col.status}`}
              className={cn(
                "flex w-[min(82vw,300px)] shrink-0 snap-start flex-col rounded-card bg-card p-3 transition-[box-shadow,background-color,opacity] duration-150 sm:w-[280px] xl:w-auto xl:min-w-[208px] xl:flex-1",
                state === "ready" && "bg-brand-50 ring-2 ring-brand-400/60",
                state === "blocked" && "bg-warn/5 ring-2 ring-warn/40",
                state === "invalid" && "opacity-55",
                over && state === "ready" && "ring-brand-600",
                over && state === "blocked" && "ring-warn",
              )}
            >
              <header className="px-1 pt-1 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 id={`col-${col.status}`} className="text-[15px] font-semibold tracking-[-0.01em]">
                    {col.title}
                  </h2>
                  <span className="tnum grid h-6 min-w-6 place-items-center rounded-full bg-board px-1.5 text-[12px] font-medium text-muted" aria-label={`${items.length} camion${items.length > 1 ? "s" : ""}`}>
                    {items.length}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] text-muted">{col.sub}</p>
              </header>

              {drag && move && (
                <p
                  className={cn(
                    "mb-2 flex min-h-9 items-center gap-2 rounded-xl px-3 py-1.5 text-[12px] font-medium",
                    state === "ready" && "bg-brand-100 text-brand-ink",
                    state === "blocked" && "bg-warn/10 text-warn",
                    state === "invalid" && "bg-board text-muted",
                  )}
                >
                  {state === "invalid" && <Lock className="size-3.5 shrink-0" />}
                  {state === "ready" && <>Déposer : {NEXT_ACTION[dragged!.status]!.label.toLowerCase()}</>}
                  {state === "blocked" && (
                    <>
                      Déposer pour compléter : {left.length} point{left.length > 1 ? "s" : ""} à régler
                    </>
                  )}
                  {state === "invalid" && move && !move.ok && move.short}
                </p>
              )}

              <ul className="scroll-area scroll-slim -mx-1 flex max-h-135 min-h-24 flex-col gap-2 overflow-y-auto overscroll-contain px-1 py-0.5" aria-label={`Camions, ${col.title}`}>
                {items.map((d) => (
                  <motion.li key={d.id} layout="position" initial={recent === d.id ? { opacity: 0, scale: 0.96 } : false} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 520, damping: 38 }} data-card={d.id}>
                    <Card
                      d={d}
                      order={orders.get(d.orderId)}
                      customer={names.get(d.customerId) ?? ""}
                      day={day}
                      left={pending.get(d.id) ?? []}
                      lifted={drag?.id === d.id}
                      keyboardLifted={drag?.id === d.id && drag.via === "keyboard"}
                      recent={recent === d.id}
                      hintId={hintId}
                      onPointerDown={(e) => pointerDown(e, d)}
                      onKeyDown={(e) => keyDown(e, d)}
                      onClickCapture={(e) => {
                        if (suppressClick.current) {
                          e.preventDefault();
                          e.stopPropagation();
                        }
                      }}
                      onNext={() => {
                        const n = NEXT_ACTION[d.status];
                        if (n) start(d, n.action);
                      }}
                    />
                  </motion.li>
                ))}
                {items.length === 0 && (
                  <li className={cn("grid h-24 place-items-center rounded-2xl border border-dashed p-4 text-center text-[13px] text-muted", state === "ready" || state === "blocked" ? "border-current" : "border-line")}>
                    {state === "ready" || state === "blocked" ? "Déposer ici" : "Aucun camion"}
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>

      {drag?.via === "pointer" && dragged && (
        <div ref={ghost} className="pointer-events-none fixed top-0 left-0 z-50" style={{ width: ghostWidth }} aria-hidden>
          <div className="rotate-[1.5deg] rounded-2xl shadow-[0_24px_48px_-16px_rgba(4,17,10,0.35),0_4px_10px_-4px_rgba(4,17,10,0.12)] motion-reduce:rotate-0">
            <Card d={dragged} order={orders.get(dragged.orderId)} customer={names.get(dragged.customerId) ?? ""} day={day} left={pending.get(dragged.id) ?? []} ghost />
          </div>
        </div>
      )}

      {dialog && (
        <MoveDialog
          key={`${dialog.id}:${dialog.action}`}
          id={dialog.id}
          action={dialog.action}
          onClose={() => setDialog(null)}
          onDone={() => {
            flash(dialog.id);
            setDialog(null);
          }}
        />
      )}
    </MotionConfig>
  );
}

/* ---------------- card ---------------- */

function Card({
  d,
  order,
  customer,
  day,
  left,
  lifted,
  keyboardLifted,
  recent,
  ghost,
  hintId,
  onPointerDown,
  onKeyDown,
  onClickCapture,
  onNext,
}: {
  d: Dispatch;
  order?: Order;
  customer: string;
  day: string;
  left: Failure[];
  lifted?: boolean;
  keyboardLifted?: boolean;
  recent?: boolean;
  ghost?: boolean;
  hintId?: string;
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onClickCapture?: (e: React.MouseEvent) => void;
  onNext?: () => void;
}) {
  const next = NEXT_ACTION[d.status];
  const late = dayOf(d.slot) < day && d.status !== "EXPEDIE" && d.status !== "LIVRE";
  return (
    <div
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      onContextMenu={(e) => lifted && e.preventDefault()}
      className={cn(
        "group relative rounded-2xl bg-board transition-[background-color,box-shadow,opacity] select-none [-webkit-touch-callout:none]",
        next && !ghost && "cursor-grab active:cursor-grabbing",
        ghost && "bg-card ring-1 ring-brand-400/40",
        lifted && !keyboardLifted && "opacity-40 outline-2 outline-offset-[-2px] outline-line outline-dashed",
        keyboardLifted && "bg-brand-50 ring-2 ring-brand-600",
        recent && "ring-2 ring-brand-400",
        !lifted && !ghost && "hover:bg-brand-50",
      )}
    >
      <Link
        href={`/expeditions/${d.id}`}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        onKeyDown={onKeyDown}
        aria-describedby={next ? hintId : undefined}
        aria-label={`${time(d.slot)}, ${customer}, camion ${d.truck}, ${d.number}${late ? ", en retard" : ""}${next ? `, ${next.todo.toLowerCase()}` : ""}`}
        className="block rounded-2xl p-3 pb-2 outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
        tabIndex={ghost ? -1 : undefined}
      >
        <span className="flex items-center gap-2">
          <span className="tnum text-[13px] font-semibold">{time(d.slot)}</span>
          {late && <span className="text-[11px] font-medium text-alert">Prévu {cap(fmtDate(dayOf(d.slot), { weekday: "short", day: "numeric" }))}</span>}
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted">
            <Truck className="size-3.5" />
            {order ? MODE[order.mode] : ""}
          </span>
        </span>
        <span className="mt-1 block truncate text-[15px] font-medium">{customer}</span>
        <span className="block truncate text-[12px] text-muted">
          {d.truck} · {d.number}
        </span>
      </Link>
      <div className="flex min-h-10 items-center gap-2 px-3 pb-2">
        {next ? (
          <>
            <span className="flex min-w-0 flex-1 overflow-hidden">
              <TonePill tone={left.length ? "warn" : "ok"} title={left.map((f) => f.message).join("\n") || undefined} className="max-w-full">
                <span className="truncate">{next.todo}</span>
                {left.length > 0 && <span className="shrink-0">· {left.length}</span>}
              </TonePill>
            </span>
            {!ghost && (
              <button
                type="button"
                onClick={onNext}
                aria-label={`${next.label}, ${d.truck}`}
                title={next.label}
                className="grid size-9 shrink-0 place-items-center rounded-full text-brand-ink transition-colors hover:bg-card focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:outline-none"
              >
                <ChevronRight className="size-4" />
              </button>
            )}
          </>
        ) : (
          <TonePill tone="ok">{order?.mode === "ENLEVEMENT" ? "Enlevé" : "Livré"}</TonePill>
        )}
      </div>
    </div>
  );
}

/* ---------------- move dialog ---------------- */

const TITLES: Record<DispatchAction, string> = {
  gateIn: "Valider les vides reçues",
  load: "Avant de valider le chargement",
  expedite: "Émettre le BL et expédier ?",
  deliver: "Confirmer la livraison",
};

function MoveDialog({ id, action, onClose, onDone }: { id: string; action: DispatchAction; onClose: () => void; onDone: () => void }) {
  const { config } = useStore();
  const { data, env, exec } = useSales();
  const [ack, setAck] = useState(false);
  const d = data.dispatches.find((x) => x.id === id);
  const ctx = d ? dispatchContext(env, d) : null;
  if (!d || !ctx) return null;

  const steps = config.sales.workflow.steps;
  const failures = blockers(DISPATCH_FLOW, action, d.status, ctx, steps);
  const shown = failures.filter((f) => !INLINE_GUARDS.has(f.guard));
  const customer = data.customers.find((c) => c.id === d.customerId);
  const pickup = ctx.order.mode === "ENLEVEMENT";
  const confirm = (phase: "gateIn" | "loading" | "delivery") => (c: Omit<Confirmation, "at">) => exec((e) => confirmParty(e, d.id, phase, c)).ok;
  const go = () => {
    const r = exec((e) => advanceDispatch(e, d.id, action));
    if (r.ok) onDone();
  };
  const label = (f: string) => (f === BULK ? "Vrac (kg)" : config.bottleTypes.find((b) => b.id === f)?.label ?? f);
  const sheet = `/expeditions/${d.id}`;
  const empties = gridTotal(d.empties);
  const damaged = gridTotal(d.damaged);

  const gateParties = [
    { role: "Magasinier", name: env.by },
    { role: pickup ? "Client" : "Chauffeur", name: pickup ? customer?.contact.name : d.driver },
  ];

  return (
    <Dialog open onClose={onClose} title={TITLES[action]} width="max-w-lg">
      <p className="text-[14px] text-muted">
        <span className="font-medium text-ink">{customer?.name}</span>, camion {d.truck}, {d.number}.
      </p>

      {action === "gateIn" && (
        <div className="mt-4 space-y-3">
          {ctx.bulk ? (
            <p className="rounded-2xl bg-board p-3 text-[14px] text-muted">Vrac : pas de bouteilles à compter, le camion passe au chargement.</p>
          ) : (
            <p className="rounded-2xl bg-board p-3 text-[14px]">
              <span className="tnum font-semibold">{fmt(empties)}</span> vide{empties > 1 ? "s" : ""} comptée{empties > 1 ? "s" : ""}
              {damaged > 0 && (
                <>
                  , <span className="tnum font-semibold">{fmt(damaged)}</span> réformée{damaged > 1 ? "s" : ""}
                </>
              )}
              .{" "}
              <Link href={sheet} className="text-brand-ink hover:underline">
                {empties + damaged ? "Corriger le comptage" : "Saisir le comptage"}
              </Link>
              <span className="mt-1 block text-[12px] text-muted">Le comptage entre au stock du magasin dès la validation, puis il est figé.</span>
            </p>
          )}
          {!ctx.bulk && steps.gateInspection && <ConfirmCount parties={gateParties} value={d.gateIn} onConfirm={confirm("gateIn")} />}
        </div>
      )}

      {action === "expedite" && (
        <div className="mt-4 space-y-3">
          <p className="text-[14px] text-muted">Le BL devient un document figé. Les pleins sortent du stock{ctx.billing === "A_L_EXPEDITION" ? " et le montant est porté au compte du client" : ""}.</p>
          <dl className="tnum grid grid-cols-2 gap-2 rounded-2xl bg-board p-4 text-[14px]">
            {Object.entries(d.loaded)
              .filter(([, n]) => n > 0)
              .map(([f, n]) => (
                <div key={f} className="contents">
                  <dt className="text-muted">{label(f)}</dt>
                  <dd className="text-right font-semibold">{fmt(n)}</dd>
                </div>
              ))}
            <dt className="border-t border-line pt-2 text-muted">Valeur</dt>
            <dd className="border-t border-line pt-2 text-right font-semibold">{fmtMoney(ctx.amount, config.sales.currency.label)}</dd>
          </dl>
          <ConfirmCount parties={[{ role: "Magasinier", name: env.by }]} value={d.loading} onConfirm={confirm("loading")} />
          <label className="flex items-start gap-3 rounded-2xl border border-line p-3 text-[14px]">
            <input type="checkbox" className="mt-1 size-4 accent-[var(--b-800)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>Les quantités chargées correspondent à ce BL.</span>
          </label>
        </div>
      )}

      {action === "deliver" && steps.proofOfDelivery && !pickup && (
        <div className="mt-4">
          <ConfirmCount parties={[{ role: "Client", name: customer?.contact.name }]} value={d.delivery} onConfirm={confirm("delivery")} />
        </div>
      )}

      {shown.length > 0 && (
        <div className="mt-4 rounded-2xl border border-warn/40 bg-warn/6 p-3">
          <p className="text-[13px] font-medium text-warn">
            {shown.length} point{shown.length > 1 ? "s" : ""} à régler
          </p>
          <ul className="mt-1 space-y-1 text-[13px] text-ink">
            {shown.map((f) => (
              <li key={f.guard}>{f.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Revenir
        </Button>
        {action === "load" ? (
          <ButtonLink href={sheet}>Ouvrir la fiche</ButtonLink>
        ) : (
          <>
            {shown.length > 0 && (
              <ButtonLink href={sheet} variant="ghost">
                Ouvrir la fiche
              </ButtonLink>
            )}
            <Button disabled={failures.length > 0 || (action === "expedite" && !ack)} onClick={go}>
              {action === "gateIn" ? "Valider les vides" : action === "expedite" ? "Émettre le BL" : "Confirmer la livraison"}
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
