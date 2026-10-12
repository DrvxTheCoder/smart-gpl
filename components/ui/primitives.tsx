"use client";

import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/format";
import type { Band } from "@/lib/calc";

/* ---------------- Card ---------------- */
export function Card({
  className,
  children,
  as: Tag = "section",
  ...rest
}: React.HTMLAttributes<HTMLElement> & { as?: "section" | "article" | "div" }) {
  return (
    <Tag data-card className={cn("rounded-card bg-card p-5", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CardTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("text-[17px] font-medium tracking-[-0.01em] text-ink", className)}>{children}</h2>;
}

/* ---------------- Button ---------------- */
type Variant = "primary" | "ghost" | "soft" | "danger" | "light";
const variants: Record<Variant, string> = {
  primary: "bg-brand-800 text-white hover:bg-brand-950",
  ghost: "border border-brand-800/80 text-ink hover:bg-brand-50",
  soft: "bg-brand-100 text-brand-950 hover:bg-brand-200",
  danger: "bg-alert text-white hover:brightness-95",
  light: "bg-white text-brand-950 hover:bg-brand-50",
};

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" };

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "primary", size = "md", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:pointer-events-none disabled:opacity-45",
        size === "md" ? "h-11 px-5 text-[15px]" : "h-8 px-3.5 text-[13px]",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: "sm" | "md";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors",
        size === "md" ? "h-11 px-5 text-[15px]" : "h-8 px-3.5 text-[13px]",
        variants[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}

/* ---------------- Round arrow link (Fernly corner arrow) ---------------- */
export function CornerLink({ href, label, dark }: { href: string; label: string; dark?: boolean }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full border transition-transform hover:rotate-45",
        dark ? "border-transparent bg-white text-brand-950" : "border-ink/70 text-ink",
      )}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
        <path d="M7.5 16.5l9-9M9.5 7.5h7v7" />
      </svg>
    </Link>
  );
}

/* ---------------- Pills ---------------- */
const bandStyle: Record<Band, string> = {
  ok: "text-ok border-ok/40 bg-ok/8",
  warn: "text-warn border-warn/45 bg-warn/8",
  alert: "text-alert border-alert/45 bg-alert/8",
};

export function EcartPill({ pct, band, className }: { pct: number; band: Band; className?: string }) {
  const label = band === "ok" ? "Écart maîtrisé" : band === "warn" ? "Écart à surveiller" : "Écart à justifier";
  return (
    <span
      title={label}
      className={cn("tnum inline-flex h-6 items-center rounded-md border px-2 text-[12px] font-medium", bandStyle[band], className)}
    >
      {pct > 0 ? "+" : pct < 0 ? "−" : ""}
      {Math.abs(pct).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %
      <span className="sr-only">, {label}</span>
    </span>
  );
}

export function StatusBadge({ status }: { status: "EN_COURS" | "TERMINE" }) {
  return status === "EN_COURS" ? (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-warn/10 px-2 text-[12px] font-medium text-warn">
      <span className="size-1.5 animate-pulse rounded-full bg-warn" aria-hidden />
      En cours
    </span>
  ) : (
    <span className="inline-flex h-6 items-center rounded-md bg-brand-100 px-2 text-[12px] font-medium text-brand-800">Clôturé</span>
  );
}

/* ---------------- Sliding indicator ---------------- */
/**
 * Tracks the box of the active item inside `ref`, so a single highlight can
 * glide between items (pills, underlines, menu rows). Re-measures when the
 * container or its items resize, e.g. once the web font has loaded.
 */
export function useIndicator(ref: React.RefObject<HTMLElement | null>, selector: string, deps: React.DependencyList = []) {
  const [box, setBox] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [ready, setReady] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current?.querySelector<HTMLElement>(selector);
    const next = el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : { x: 0, y: 0, w: 0, h: 0 };
    setBox((b) => (b.x === next.x && b.y === next.y && b.w === next.w && b.h === next.h ? b : next));
  }, [ref, selector]);

  useLayoutEffect(measure, [measure, ...deps]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    root.querySelectorAll("button, a, li").forEach((n) => ro.observe(n));
    // Only animate once the first position is painted, never from 0,0.
    const t = requestAnimationFrame(() => setReady(true));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(t);
    };
  }, [ref, measure]);

  return { ...box, ready };
}

export const glide = "transition-[transform,width,height,opacity] duration-[380ms] ease-[cubic-bezier(.2,.9,.25,1)]";

/* ---------------- Segmented control with a sliding pill ---------------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const pill = useIndicator(wrap, `[data-v="${value}"]`, [options.length]);

  return (
    <div ref={wrap} role="group" aria-label={label} className={cn("no-scrollbar relative inline-flex max-w-full overflow-x-auto rounded-full bg-board p-1 ring-1 ring-line", className)}>
      <span
        aria-hidden
        className={cn("absolute top-0 left-0 rounded-full bg-brand-800", pill.ready && glide)}
        style={{ transform: `translate(${pill.x}px, ${pill.y}px)`, width: pill.w, height: pill.h, opacity: pill.w ? 1 : 0 }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          data-v={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative z-10 h-8 shrink-0 rounded-full px-3.5 text-[13px] font-medium transition-colors duration-300",
            o.value === value ? "text-white" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Switch ---------------- */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-brand-800" : "bg-line",
      )}
    >
      <span
        className={cn(
          "absolute top-1 left-1 size-5 rounded-full bg-white shadow-sm transition-transform duration-300 ease-[cubic-bezier(.3,1.4,.5,1)]",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

/* ---------------- Fields ---------------- */
export function Field({
  label,
  unit,
  hint,
  className,
  children,
}: {
  label: string;
  unit?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="flex items-baseline justify-between gap-2 text-[13px] text-muted">
        <span className="truncate">{label}</span>
        {unit && <span className="text-[11px] text-faint">{unit}</span>}
      </span>
      {children}
      {hint && <span className="text-[12px] text-faint">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "tnum h-10 w-full rounded-xl border border-line bg-white px-3 text-[15px] text-ink outline-none transition-colors placeholder:text-faint focus:border-brand-600 disabled:bg-board disabled:text-muted";

export function NumberInput({
  value,
  onChange,
  step = 0.1,
  disabled,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [txt, setTxt] = useState(String(value ?? 0).replace(".", ","));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setTxt(String(value ?? 0).replace(".", ","));
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      disabled={disabled}
      value={txt}
      step={step}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onBlur={() => {
        focused.current = false;
        setTxt(String(value ?? 0).replace(".", ","));
      }}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d.,-]/g, "");
        setTxt(raw);
        const n = Number(raw.replace(",", "."));
        if (Number.isFinite(n)) onChange(n);
      }}
      className={inputCls}
    />
  );
}

/**
 * Whole numbers (money in F CFA, bottle counts): grouped by thousands at rest,
 * raw digits while typing, selected on focus. Never below `min`.
 */
export function IntegerInput({
  value,
  onChange,
  min = 0,
  disabled,
  ariaLabel,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const group = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n);
  const [txt, setTxt] = useState(group(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setTxt(group(value));
  }, [value]);
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={ariaLabel}
      disabled={disabled}
      value={txt}
      onFocus={(e) => {
        focused.current = true;
        setTxt(String(value));
        const el = e.currentTarget;
        requestAnimationFrame(() => el.select());
      }}
      onBlur={() => {
        focused.current = false;
        setTxt(group(value));
      }}
      onChange={(e) => {
        const raw = e.target.value.replace(/\D/g, "");
        setTxt(raw);
        onChange(Math.max(Number(raw) || 0, min));
      }}
      className={cn(inputCls, className)}
    />
  );
}

/* ---------------- Dialog (native <dialog>) ---------------- */
export function Dialog({
  open,
  onClose,
  title,
  children,
  width = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-[24px] bg-card p-0 text-ink backdrop:bg-brand-950/30 backdrop:backdrop-blur-[2px]",
        width,
      )}
    >
      <div className="p-6">
        <h2 className="mb-4 text-[19px] font-semibold tracking-[-0.01em]">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

/* ---------------- Toast ---------------- */
