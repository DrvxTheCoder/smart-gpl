"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Clock } from "@/components/ui/icons";
import { cn } from "@/lib/format";
import { inputCls } from "./primitives";
import { Popover, centerIn, panelCls } from "./popover";

const pad = (n: number) => String(n).padStart(2, "0");

/** Reads what an operator types: "7", "730", "0730", "7:30", "7h30", "7 30". */
export function parseTime(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\s*[:h. ]\s*(\d{1,2})?$/) ?? s.match(/^(\d{1,2})(\d{2})$/) ?? s.match(/^(\d{1,2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

/**
 * 24-hour time input, after ReUI's time picker: type the time directly, or
 * open the clock for scrollable hour and minute columns.
 */
export function TimePicker({
  value,
  onChange,
  disabled,
  minuteStep = 1,
  ariaLabel,
  placeholder = "hh:mm",
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  minuteStep?: number;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [txt, setTxt] = useState(value);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hoursRef = useRef<HTMLDivElement>(null);
  const minsRef = useRef<HTMLDivElement>(null);

  useEffect(() => setTxt(value), [value]);

  const [h, m] = value ? value.split(":").map(Number) : [null, null];
  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, k) => k * minuteStep);

  const set = (nh: number, nm: number) => onChange(`${pad(nh)}:${pad(nm)}`);

  // On open, park each column on the current value.
  useLayoutEffect(() => {
    if (!open) return;
    centerIn(hoursRef.current, hoursRef.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? null);
    centerIn(minsRef.current, minsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? null);
  }, [open]);

  // After a pick, glide the chosen cell to the middle.
  useEffect(() => {
    if (!open) return;
    centerIn(hoursRef.current, hoursRef.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? null, true);
    centerIn(minsRef.current, minsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? null, true);
  }, [h, m, open]);

  const commit = () => {
    const t = parseTime(txt);
    if (t) onChange(t);
    else if (!txt.trim()) onChange("");
    else setTxt(value);
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) inputRef.current?.focus({ preventScroll: true });
  };

  const column = (label: string, items: number[], current: number | null, pick: (n: number) => void, ref: React.RefObject<HTMLDivElement | null>) => (
    <div className="flex min-w-0 flex-1 flex-col">
      <p className="pb-1.5 text-center text-[11px] font-medium text-faint">{label}</p>
      <div ref={ref} role="listbox" aria-label={label} className="scroll-area no-scrollbar relative h-[216px] overflow-y-auto px-0.5">
        {items.map((n) => {
          const sel = n === current;
          return (
            <button
              key={n}
              type="button"
              role="option"
              aria-selected={sel}
              onClick={() => pick(n)}
              className={cn(
                "tnum block h-9 w-full rounded-xl text-center text-[14px] transition-colors duration-200",
                sel ? "bg-brand-800 font-semibold text-white" : "text-ink hover:bg-board",
              )}
            >
              {pad(n)}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div ref={wrapRef} className="relative w-full">
      <input
        ref={inputRef}
        id={id}
        inputMode="numeric"
        autoComplete="off"
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        value={txt}
        onChange={(e) => setTxt(e.target.value.replace(/[^\d:hH. ]/g, "").slice(0, 5))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "ArrowDown" && e.altKey) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(inputCls, "pr-11", open && "border-brand-600 ring-3 ring-brand-600/12")}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label="Choisir l'heure"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors hover:bg-board hover:text-ink disabled:pointer-events-none disabled:opacity-50",
          open && "bg-brand-100 text-brand-ink",
        )}
      >
        <Clock className="size-4" />
      </button>

      <Popover open={open} anchor={wrapRef} onDismiss={(r) => close(r === "escape")} role="dialog" aria-label="Choisir l'heure">
        <div className={cn(panelCls, "w-[212px] p-2")}>
          <div className="flex gap-1.5">
            {column("Heure", Array.from({ length: 24 }, (_, k) => k), h, (n) => set(n, m ?? 0), hoursRef)}
            <div className="w-px self-stretch bg-line" aria-hidden />
            {column("Min", minutes, m, (n) => set(h ?? 0, n), minsRef)}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
            <button
              type="button"
              onClick={() => {
                const d = new Date();
                set(d.getHours(), Math.floor(d.getMinutes() / minuteStep) * minuteStep);
              }}
              className="h-8 rounded-full px-3 text-[13px] font-medium text-brand-ink hover:bg-brand-50"
            >
              Maintenant
            </button>
            <button type="button" onClick={() => close(true)} className="h-8 rounded-full bg-brand-800 px-4 text-[13px] font-medium text-white hover:bg-brand-950">
              OK
            </button>
          </div>
        </div>
      </Popover>
    </div>
  );
}
