"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/format";
import { glide, useIndicator } from "@/components/ui/primitives";
import { DISPATCH_STATUS, ORDER_STATUS } from "@/lib/sales/lifecycle";
import type { Tone } from "@/lib/sales/solvency";
import type { DispatchStatus, OrderStatus } from "@/lib/sales/types";
import type { FillStatus } from "@/lib/sales/stock";

/* Building blocks shared by the sales and warehouse screens. They follow the
   production screens: ok / warn / alert pills, status badges, tab strips. */

const toneStyle: Record<Tone, string> = {
  ok: "text-ok border-ok/40 bg-ok/8",
  warn: "text-warn border-warn/45 bg-warn/8",
  alert: "text-alert border-alert/45 bg-alert/8",
};

/** A status pill: tone colour plus text, never colour alone. */
export function TonePill({ tone, children, className, title }: { tone: Tone; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("tnum inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium whitespace-nowrap", toneStyle[tone], className)}>
      <span className={cn("size-1.5 rounded-full", tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : "bg-alert")} aria-hidden />
      {children}
    </span>
  );
}

const badgeTone = {
  muted: "bg-board text-muted ring-1 ring-line",
  warn: "bg-warn/10 text-warn",
  brand: "bg-brand-100 text-brand-800",
  ok: "bg-ok/10 text-ok",
  alert: "bg-alert/10 text-alert",
};

export function OrderBadge({ status, partial }: { status: OrderStatus; partial?: boolean }) {
  const s = ORDER_STATUS[status];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={cn("inline-flex h-6 items-center rounded-md px-2 text-[12px] font-medium whitespace-nowrap", badgeTone[s.tone])}>{s.label}</span>
      {partial && <span className="hatch inline-flex h-6 items-center rounded-md px-2 text-[12px] font-medium whitespace-nowrap text-ink">Partielle</span>}
    </span>
  );
}

export function DispatchBadge({ status }: { status: DispatchStatus }) {
  const s = DISPATCH_STATUS[status];
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium whitespace-nowrap", badgeTone[s.tone])}>
      {(status === "EN_CHARGEMENT" || status === "CHARGE") && <span className="size-1.5 animate-pulse rounded-full bg-warn" aria-hidden />}
      {s.label}
    </span>
  );
}

/**
 * Tab strip with the sheet's sliding underline: role="tab", arrow keys,
 * and the active tab kept in view when the strip scrolls sideways.
 */
export function TabStrip<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const underline = useIndicator(ref, '[role="tab"][aria-selected="true"]', [value, tabs.length]);

  useEffect(() => {
    const list = ref.current;
    const el = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !el) return;
    if (el.offsetLeft < list.scrollLeft || el.offsetLeft + el.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollTo({ left: el.offsetLeft - 16, behavior: "smooth" });
  }, [value]);

  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === value);
    const next = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length : null;
    if (next == null) return;
    e.preventDefault();
    onChange(tabs[next].id);
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div ref={ref} role="tablist" aria-label={label} onKeyDown={onKey} className="no-scrollbar relative flex gap-1 overflow-x-auto border-b border-line px-3 pt-3">
      <span aria-hidden className={cn("absolute bottom-0 left-0 h-[3px] rounded-full bg-brand-800", underline.ready && glide)} style={{ transform: `translateX(${underline.x + 12}px)`, width: Math.max(underline.w - 24, 0) }} />
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={value === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          className={cn("relative shrink-0 rounded-t-xl px-3.5 pt-2 pb-3 text-[14px] whitespace-nowrap transition-colors duration-300", value === t.id ? "font-semibold text-ink" : "text-muted hover:text-ink")}
        >
          {t.label}
          {t.count ? <span className="tnum ml-1.5 rounded-md bg-board px-1.5 text-[11px]">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Give it `key={id}` so each tab settles in with panel-in. */
export function TabPanel({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className={cn("panel-in p-5", className)}>
      {children}
    </div>
  );
}

/** The "this record does not exist" state, with the way back. */
export function Missing({ text, href, back }: { text: string; href: string; back: string }) {
  return (
    <div className="grid min-h-[50vh] place-items-center text-center">
      <div>
        <p className="text-[18px] font-medium">{text}</p>
        <Link href={href} className="mt-3 inline-block text-brand-800 underline">
          {back}
        </Link>
      </div>
    </div>
  );
}

/** A labelled figure with its unit muted, for dl groups. */
export function Figure({ label, value, unit, sub, className, tone }: { label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; className?: string; tone?: Tone }) {
  return (
    <div className={className}>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={cn("tnum mt-0.5 text-[22px] font-semibold tracking-[-0.02em]", tone === "warn" ? "text-warn" : tone === "alert" ? "text-alert" : undefined)}>
        {value}
        {unit && <span className="ml-1 text-[14px] font-medium text-muted">{unit}</span>}
      </dd>
      {sub && <dd className="text-[12px] text-faint">{sub}</dd>}
    </div>
  );
}

/** Horizontal share bar, hatched where it is still open. */
export function Meter({ pct, tone, label }: { pct: number; tone?: Tone; label: string }) {
  const p = Math.min(Math.max(pct, 0), 100);
  return (
    <div className="hatch h-2 overflow-hidden rounded-full" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)}>
      <div className={cn("h-full rounded-full transition-[width] duration-700", tone === "alert" ? "bg-alert" : tone === "warn" ? "bg-warn" : "bg-brand-600")} style={{ width: `${p}%` }} />
    </div>
  );
}

const FILL: Record<FillStatus, { label: string; cls: string }> = {
  A_REMPLIR: { label: "À remplir", cls: "border border-warn/45 text-warn" },
  PARTIELLE: { label: "Remplie en partie", cls: "hatch text-ink" },
  REMPLIE: { label: "Remplie", cls: "bg-ok/10 text-ok" },
};

/** Production's fill status of an order's bottles. */
export function FillBadge({ status }: { status: FillStatus }) {
  return <span className={cn("inline-flex h-6 items-center rounded-md px-2 text-[12px] font-medium whitespace-nowrap", FILL[status].cls)}>{FILL[status].label}</span>;
}
