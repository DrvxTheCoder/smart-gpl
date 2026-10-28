"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "@/components/ui/icons";
import { cn } from "@/lib/format";
import { Popover, panelCls, revealIn } from "./popover";

export type SelectOption<T extends string> = { value: T; label: string };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const triggerStyles = {
  field:
    "tnum h-10 w-full rounded-xl border border-line bg-field pr-2.5 pl-3 text-[15px] hover:border-faint aria-expanded:border-brand-600 aria-expanded:ring-3 aria-expanded:ring-brand-600/12 focus-visible:border-brand-600",
  pill: "h-11 rounded-full bg-board pr-3.5 pl-4 text-[14px] font-medium ring-1 ring-line hover:ring-faint aria-expanded:ring-brand-600",
  bare: "-ml-1 h-7 rounded-lg px-1 text-[15px] font-medium hover:bg-board aria-expanded:bg-board",
};

/**
 * A listbox select, after ReUI's c-select-1. With `searchable` it becomes a
 * combobox: typing filters the options, arrows move, Enter picks.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder = "Choisir",
  ariaLabel,
  disabled,
  searchable,
  variant = "field",
  align = "start",
  className,
}: {
  value: T | null;
  onChange: (v: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  searchable?: boolean;
  variant?: keyof typeof triggerStyles;
  align?: "start" | "end";
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typed = useRef({ text: "", at: 0 });

  const selected = options.find((o) => o.value === value);
  const shown = searchable && query ? options.filter((o) => norm(o.label).includes(norm(query))) : options;

  const show = () => {
    if (disabled) return;
    setQuery("");
    setActive(Math.max(options.findIndex((o) => o.value === value), 0));
    setOpen(true);
  };
  const hide = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  };
  const choose = (o: SelectOption<T> | undefined) => {
    if (!o) return;
    onChange(o.value);
    hide(true);
  };

  useEffect(() => {
    if (!open) return;
    const t = requestAnimationFrame(() => (searchable ? searchRef.current : listRef.current)?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(t);
  }, [open, searchable]);

  useEffect(() => {
    if (open) revealIn(listRef.current, listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`) ?? null);
  }, [active, open]);

  const onKey = (e: React.KeyboardEvent) => {
    const last = shown.length - 1;
    if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, last));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
    else if (e.key === "Home" && !searchable) setActive(0);
    else if (e.key === "End" && !searchable) setActive(last);
    else if (e.key === "Enter" || (e.key === " " && !searchable)) choose(shown[active]);
    else if (e.key === "Tab") return hide(false);
    else if (!searchable && e.key.length === 1) {
      // Type-ahead: jump to the first option starting with what was typed.
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 600 ? typed.current.text : "") + norm(e.key), at: now };
      const i = shown.findIndex((o) => norm(o.label).startsWith(typed.current.text));
      if (i >= 0) setActive(i);
    } else return;
    e.preventDefault();
  };

  const listId = `${id}-list`;
  const optId = (i: number) => `${id}-o${i}`;

  return (
    <div className={cn("relative min-w-0", variant === "field" && "w-full", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? hide(false) : show())}
        onKeyDown={(e) => {
          if (["ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault();
            show();
          }
        }}
        className={cn(
          "flex max-w-full items-center gap-2 text-left text-ink outline-none transition-[border-color,box-shadow,background-color] duration-200 disabled:pointer-events-none disabled:bg-board disabled:text-muted",
          triggerStyles[variant],
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && "text-faint")}>{selected?.label ?? placeholder}</span>
        <ChevronDown
          aria-hidden
          className={cn("size-4 shrink-0 text-muted transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)]", open && "rotate-180", variant === "bare" && "size-3.5")}
        />
      </button>

      <Popover open={open} anchor={triggerRef} onDismiss={(r) => hide(r === "escape")} align={align} matchWidth>
        <div className={cn(panelCls, "flex max-w-[min(360px,calc(100vw-16px))] min-w-[180px] flex-col p-1.5")}>
          {searchable && (
            <div className="mb-1 flex h-10 items-center gap-2 border-b border-line px-2.5">
              <Search aria-hidden className="size-4 shrink-0 text-muted" />
              <input
                ref={searchRef}
                role="combobox"
                aria-label={`Rechercher${ariaLabel ? `, ${ariaLabel}` : ""}`}
                aria-expanded={open}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={shown[active] ? optId(active) : undefined}
                value={query}
                placeholder="Rechercher"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKey}
                className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
              />
            </div>
          )}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={searchable ? undefined : -1}
            aria-label={ariaLabel}
            aria-activedescendant={!searchable && shown[active] ? optId(active) : undefined}
            onKeyDown={searchable ? undefined : onKey}
            className="scroll-area relative max-h-[280px] overflow-y-auto outline-none"
          >
            {shown.map((o, i) => {
              const isSel = o.value === value;
              return (
                <div
                  key={o.value}
                  id={optId(i)}
                  data-i={i}
                  role="option"
                  aria-selected={isSel}
                  onPointerMove={() => setActive(i)}
                  onClick={() => choose(o)}
                  className={cn(
                    "flex h-9 cursor-pointer items-center gap-2 rounded-xl px-2.5 text-[14px] transition-colors duration-150",
                    i === active ? "bg-board" : "",
                    isSel ? "font-medium text-brand-ink" : "text-ink",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  <Check aria-hidden className={cn("size-4 shrink-0 transition-[opacity,scale] duration-200", isSel ? "scale-100 opacity-100" : "scale-50 opacity-0")} />
                </div>
              );
            })}
            {shown.length === 0 && <p className="px-2.5 py-6 text-center text-[13px] text-muted">Aucun résultat</p>}
          </div>
        </div>
      </Popover>
    </div>
  );
}
