"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from "@/components/ui/icons";
import { cap, cn, parseISO } from "@/lib/format";
import { iso } from "@/lib/seed";
import { Popover, centerIn, panelCls } from "./popover";

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];
const monthName = (m: number, style: "long" | "short" = "long") =>
  cap(new Intl.DateTimeFormat("fr-FR", { month: style }).format(new Date(2026, m, 1))).replace(".", "");
const addDays = (s: string, n: number) => {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const firstOf = (s: string) => {
  const d = parseISO(s);
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

/**
 * Month calendar, after ReUI's c-calendar-13: the caption opens a year view,
 * a year opens its months, a month brings you back to the days. Dates are
 * yyyy-mm-dd strings, like everywhere else in the app.
 */
export function Calendar({
  value,
  onSelect,
  min,
  max,
  isMarked,
  autoFocus,
}: {
  value: string | null;
  onSelect: (d: string) => void;
  min?: string;
  max?: string;
  /** Adds a dot under a day, e.g. "an inventory exists". */
  isMarked?: (d: string) => boolean;
  autoFocus?: boolean;
}) {
  const today = iso(new Date());
  const start = value ?? (max && today > max ? max : min && today < min ? min : today);
  const [month, setMonth] = useState(() => firstOf(start));
  const [focus, setFocus] = useState(start);
  const [view, setView] = useState<"days" | "years" | "months">("days");
  const [year, setYear] = useState(month.getFullYear());
  const gridRef = useRef<HTMLDivElement>(null);
  const yearsRef = useRef<HTMLDivElement>(null);
  const dir = useRef(0);

  const off = (d: string) => (min != null && d < min) || (max != null && d > max);
  const minY = min ? Number(min.slice(0, 4)) : new Date().getFullYear() - 10;
  const maxY = max ? Number(max.slice(0, 4)) : new Date().getFullYear() + 10;

  // Always six rows, so the panel never changes height between months.
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, k) => iso(new Date(month.getFullYear(), month.getMonth(), 1 - offset + k)));
  }, [month]);

  const go = (target: Date) => {
    dir.current = Math.sign(target.getTime() - month.getTime());
    setMonth(target);
  };
  const canPrev = !min || iso(new Date(month.getFullYear(), month.getMonth(), 0)) >= min;
  const canNext = !max || iso(new Date(month.getFullYear(), month.getMonth() + 1, 1)) <= max;

  useLayoutEffect(() => {
    if (!dir.current || !gridRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo(gridRef.current, { x: dir.current * 14, opacity: 0 }, { x: 0, opacity: 1, duration: 0.28, ease: "power3.out" });
    dir.current = 0;
  }, [month]);

  useEffect(() => {
    if (autoFocus) gridRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
  }, [autoFocus]);

  useLayoutEffect(() => {
    if (view === "years") centerIn(yearsRef.current, yearsRef.current?.querySelector<HTMLElement>("[data-current]") ?? null);
  }, [view]);

  const moveFocus = (d: string) => {
    if (off(d)) return;
    setFocus(d);
    const f = firstOf(d);
    if (f.getTime() !== month.getTime()) go(f);
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-day="${d}"]`)?.focus({ preventScroll: true }));
  };

  const onKey = (e: React.KeyboardEvent) => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in steps) moveFocus(addDays(focus, steps[e.key]));
    else if (e.key === "PageUp" || e.key === "PageDown") {
      const d = parseISO(focus);
      d.setMonth(d.getMonth() + (e.key === "PageUp" ? -1 : 1));
      moveFocus(iso(d));
    } else if (e.key === "Home") moveFocus(addDays(focus, -((parseISO(focus).getDay() + 6) % 7)));
    else if (e.key === "End") moveFocus(addDays(focus, 6 - ((parseISO(focus).getDay() + 6) % 7)));
    else return;
    e.preventDefault();
  };

  const navBtn = "grid size-8 place-items-center rounded-full bg-board text-ink transition-colors hover:bg-brand-100 disabled:pointer-events-none disabled:opacity-35";

  return (
    <div className="w-[272px]">
      <div className="mb-2 flex h-8 items-center justify-between">
        {view === "months" ? (
          <button type="button" onClick={() => setView("years")} className="flex h-8 items-center gap-1 rounded-full pr-2.5 pl-1.5 text-[15px] font-semibold tracking-[-0.01em] hover:bg-board">
            <ChevronLeft className="size-4" />
            {year}
          </button>
        ) : (
          <button
            type="button"
            aria-expanded={view === "years"}
            aria-label={view === "years" ? "Revenir aux jours" : "Choisir le mois et l'année"}
            onClick={() => {
              setYear(month.getFullYear());
              setView(view === "years" ? "days" : "years");
            }}
            className="flex h-8 items-center gap-1.5 rounded-full pr-2 pl-2.5 text-[15px] font-semibold tracking-[-0.01em] hover:bg-board"
          >
            <span aria-live="polite">
              {monthName(month.getMonth())} {month.getFullYear()}
            </span>
            <ChevronDown className={cn("size-4 text-muted transition-transform duration-300", view === "years" && "rotate-180")} />
          </button>
        )}
        <div className={cn("flex gap-1.5 transition-opacity duration-200", view !== "days" && "pointer-events-none opacity-0")}>
          <button type="button" className={navBtn} aria-label="Mois précédent" disabled={!canPrev} onClick={() => go(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" className={navBtn} aria-label="Mois suivant" disabled={!canNext} onClick={() => go(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="relative overflow-hidden">
        <div className="grid grid-cols-7 text-center text-[11px] font-medium text-faint" aria-hidden>
          {WEEKDAYS.map((d, k) => (
            <span key={k} className="py-1">
              {d}
            </span>
          ))}
        </div>
        <div ref={gridRef} role="group" aria-label={`${monthName(month.getMonth())} ${month.getFullYear()}`} onKeyDown={onKey} className="grid grid-cols-7 gap-y-0.5">
          {cells.map((d) => {
            const inMonth = d.slice(0, 7) === iso(month).slice(0, 7);
            const sel = d === value;
            const disabled = off(d);
            return (
              <div key={d} className="grid place-items-center">
                <button
                  type="button"
                  data-day={d}
                  tabIndex={d === focus ? 0 : -1}
                  disabled={disabled}
                  aria-selected={sel}
                  aria-current={d === today ? "date" : undefined}
                  aria-label={new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(parseISO(d))}
                  onClick={() => {
                    setFocus(d);
                    onSelect(d);
                  }}
                  className={cn(
                    "tnum relative grid size-9 place-items-center rounded-full text-[13px] transition-[background-color,color,scale] duration-200 active:scale-90 disabled:pointer-events-none",
                    sel ? "bg-brand-800 font-semibold text-white" : "hover:bg-board",
                    !sel && d === today && "font-semibold text-brand-ink ring-1 ring-brand-600/50 ring-inset",
                    !sel && !inMonth && "text-faint",
                    disabled && "text-faint/60 line-through decoration-faint/50",
                  )}
                >
                  {Number(d.slice(8))}
                  {isMarked?.(d) && <span aria-hidden className={cn("absolute bottom-1 size-1 rounded-full", sel ? "bg-white" : "bg-brand-600")} />}
                </button>
              </div>
            );
          })}
        </div>

        {view !== "days" && (
          <div className="panel-in absolute inset-0 bg-card">
            {view === "years" ? (
              <div ref={yearsRef} className="scroll-area relative grid h-full grid-cols-4 content-start gap-1.5 overflow-y-auto p-0.5">
                {Array.from({ length: maxY - minY + 1 }, (_, k) => minY + k).map((y) => (
                  <button
                    key={y}
                    type="button"
                    data-current={y === month.getFullYear() || undefined}
                    onClick={() => {
                      setYear(y);
                      setView("months");
                    }}
                    className={cn(
                      "tnum h-9 rounded-full text-[13px] transition-colors",
                      y === month.getFullYear() ? "bg-brand-800 font-semibold text-white" : "ring-1 ring-line hover:bg-board",
                    )}
                  >
                    {y}
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid h-full grid-cols-3 content-start gap-1.5 p-0.5">
                {Array.from({ length: 12 }, (_, mo) => {
                  const first = iso(new Date(year, mo, 1));
                  const last = iso(new Date(year, mo + 1, 0));
                  const disabled = (min != null && last < min) || (max != null && first > max);
                  const cur = year === month.getFullYear() && mo === month.getMonth();
                  return (
                    <button
                      key={mo}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        go(new Date(year, mo, 1));
                        setView("days");
                      }}
                      className={cn(
                        "h-10 rounded-full text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-35",
                        cur ? "bg-brand-800 font-semibold text-white" : "ring-1 ring-line hover:bg-board",
                      )}
                    >
                      {monthName(mo, "short")}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PickerTrigger({
  triggerRef,
  open,
  disabled,
  ariaLabel,
  text,
  placeholder,
  onClick,
  onClear,
}: {
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  text: string | null;
  placeholder: string;
  onClick: () => void;
  onClear?: () => void;
}) {
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onClick}
        className={cn(
          "tnum flex h-10 w-full items-center gap-2 rounded-xl border border-line bg-field pl-3 text-left text-[15px] text-ink outline-none transition-[border-color,box-shadow] duration-200 hover:border-faint focus-visible:border-brand-600 disabled:pointer-events-none disabled:bg-board disabled:text-muted",
          open && "border-brand-600 ring-3 ring-brand-600/12",
          onClear && text ? "pr-9" : "pr-3",
        )}
      >
        <CalendarDays aria-hidden className={cn("size-4 shrink-0 transition-colors", open ? "text-brand-ink" : "text-muted")} />
        <span className={cn("min-w-0 flex-1 truncate", !text && "text-faint")}>{text ?? placeholder}</span>
      </button>
      {onClear && text && !disabled && (
        <button
          type="button"
          aria-label="Effacer la date"
          onClick={onClear}
          className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors hover:bg-board hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      )}
    </>
  );
}

/** Date field with a popover calendar (c-calendar-13). */
export function DatePicker({
  value,
  onChange,
  min,
  max,
  isMarked,
  clearable,
  disabled,
  ariaLabel,
  placeholder = "Choisir une date",
  className,
}: {
  value: string | null;
  onChange: (d: string | null) => void;
  min?: string;
  max?: string;
  isMarked?: (d: string) => boolean;
  clearable?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(0); // remounts the calendar on each opening
  const triggerRef = useRef<HTMLButtonElement>(null);
  const today = iso(new Date());
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  };
  const text = value ? cap(new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(parseISO(value))) : null;

  return (
    <div className={cn("relative w-full", className)}>
      <PickerTrigger
        triggerRef={triggerRef}
        open={open}
        disabled={disabled}
        ariaLabel={ariaLabel}
        text={text}
        placeholder={placeholder}
        onClick={() => {
          if (!open) setOpened((n) => n + 1);
          setOpen(!open);
        }}
        onClear={clearable ? () => onChange(null) : undefined}
      />
      <Popover open={open} anchor={triggerRef} onDismiss={(r) => close(r === "escape")} role="dialog" aria-label={ariaLabel ?? "Choisir une date"}>
        <div className={cn(panelCls, "p-3")}>
          {opened > 0 && (
            <Calendar
              key={opened}
              value={value}
              min={min}
              max={max}
              isMarked={isMarked}
              autoFocus={open}
              onSelect={(d) => {
                onChange(d);
                close(true);
              }}
            />
          )}
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
            <button
              type="button"
              disabled={(min != null && today < min) || (max != null && today > max)}
              onClick={() => {
                onChange(today);
                close(true);
              }}
              className="h-8 rounded-full px-3 text-[13px] font-medium text-brand-ink hover:bg-brand-50 disabled:opacity-40"
            >
              Aujourd&apos;hui
            </button>
            {clearable && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  close(true);
                }}
                className="h-8 rounded-full px-3 text-[13px] font-medium text-muted hover:bg-board hover:text-ink"
              >
                Effacer
              </button>
            )}
          </div>
        </div>
      </Popover>
    </div>
  );
}

/**
 * Date and time in one field (c-calendar-14): a calendar beside a column of
 * time slots. The value is a local "yyyy-mm-ddThh:mm" string.
 */
export function DateTimePicker({
  value,
  onChange,
  min,
  max,
  stepMin = 15,
  isSlotDisabled,
  disabled,
  ariaLabel,
  placeholder = "Choisir la date et l'heure",
}: {
  value: string | null;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  stepMin?: number;
  isSlotDisabled?: (date: string, time: string) => boolean;
  disabled?: boolean;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(0);
  const [day, setDay] = useState(value?.slice(0, 10) ?? iso(new Date()));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const slotsRef = useRef<HTMLDivElement>(null);
  const time = value && value.slice(0, 10) === day ? value.slice(11, 16) : null;

  const slots = useMemo(
    () => Array.from({ length: Math.ceil(1440 / stepMin) }, (_, k) => `${String(Math.floor((k * stepMin) / 60)).padStart(2, "0")}:${String((k * stepMin) % 60).padStart(2, "0")}`),
    [stepMin],
  );


  useLayoutEffect(() => {
    if (!open) return;
    const list = slotsRef.current;
    const target =
      list?.querySelector<HTMLElement>('[aria-pressed="true"]') ??
      list?.querySelector<HTMLElement>("button:not(:disabled)") ??
      null;
    centerIn(list, target);
  }, [open, day]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  };

  const text = value
    ? `${cap(new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" }).format(parseISO(value.slice(0, 10))))}, ${value.slice(11, 16)}`
    : null;

  return (
    <div className="relative w-full">
      <PickerTrigger
        triggerRef={triggerRef}
        open={open}
        disabled={disabled}
        ariaLabel={ariaLabel}
        text={text}
        placeholder={placeholder}
        onClick={() => {
          if (!open) {
            setDay(value?.slice(0, 10) ?? day);
            setOpened((n) => n + 1);
          }
          setOpen(!open);
        }}
      />
      <Popover open={open} anchor={triggerRef} onDismiss={(r) => close(r === "escape")} role="dialog" aria-label={ariaLabel ?? placeholder}>
        <div className={cn(panelCls, "flex max-sm:flex-col")}>
          <div className="p-3">{opened > 0 && <Calendar key={opened} value={day} min={min} max={max} autoFocus={open} onSelect={setDay} />}</div>
          {/* The slot list is taken out of flow on wide screens, so the calendar alone sets the height. */}
          <div className="relative flex flex-col border-line max-sm:border-t sm:w-[148px] sm:border-l">
            <p className="flex h-12 shrink-0 items-center px-4 text-[14px] font-semibold tracking-[-0.01em]">
              {cap(new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric" }).format(parseISO(day)))}
            </p>
            <div
              ref={slotsRef}
              role="group"
              aria-label="Heure"
              className="scroll-area grid content-start gap-1.5 overflow-y-auto px-3 pb-3 max-sm:relative max-sm:h-44 max-sm:grid-cols-3 sm:absolute sm:inset-x-0 sm:top-12 sm:bottom-0"
            >
              {slots.map((t) => {
                const sel = t === time;
                const off = isSlotDisabled?.(day, t) ?? false;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={sel}
                    disabled={off}
                    onClick={() => {
                      onChange(`${day}T${t}`);
                      close(true);
                    }}
                    className={cn(
                      "tnum h-8 shrink-0 rounded-full text-[13px] font-medium transition-colors duration-200 disabled:pointer-events-none disabled:text-faint/70 disabled:line-through disabled:ring-line/60",
                      sel ? "bg-brand-800 text-white" : "ring-1 ring-line hover:bg-board hover:ring-faint",
                    )}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Popover>
    </div>
  );
}
