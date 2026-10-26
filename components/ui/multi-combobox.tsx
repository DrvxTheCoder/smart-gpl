"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Plus, X } from "@/components/ui/icons";
import { cn } from "@/lib/format";
import { Popover, panelCls, revealIn } from "./popover";

export type ComboOption = { value: string; label: string; sub?: string };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * A multi-select combobox, after ReUI's c-combobox-12: the picks sit as chips
 * in the field, typing filters the list, Enter toggles, Backspace on an empty
 * query drops the last chip. With `creatable`, a query matching nobody can be
 * added as is.
 */
export function MultiCombobox({
  id,
  value,
  onChange,
  options,
  placeholder = "Choisir",
  ariaLabel,
  creatable,
  empty = "Aucun résultat",
}: {
  id?: string;
  value: string[];
  onChange: (v: string[]) => void;
  options: ComboOption[];
  placeholder?: string;
  ariaLabel?: string;
  creatable?: boolean;
  empty?: string;
}) {
  const uid = useId();
  const inputId = id ?? `${uid}-input`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const q = query.trim();
  const matches = q ? options.filter((o) => norm(o.label).includes(norm(q)) || (o.sub && norm(o.sub).includes(norm(q)))) : options;
  const canCreate = creatable && q !== "" && !options.some((o) => norm(o.label) === norm(q)) && !value.some((v) => norm(v) === norm(q));
  const rows: (ComboOption & { create?: boolean })[] = canCreate ? [...matches, { value: q, label: q, create: true }] : matches;
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  const toggle = (v: string) => {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
    setQuery("");
    setActive(0);
    inputRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (open) revealIn(listRef.current, listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`) ?? null);
  }, [active, open]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const last = rows.length - 1;
    if (e.key === "ArrowDown") {
      if (!open) setOpen(true);
      else setActive((a) => Math.min(a + 1, last));
    } else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
    else if (e.key === "Enter") {
      if (open && rows[active]) toggle(rows[active].value);
    } else if (e.key === "Backspace" && query === "" && value.length) onChange(value.slice(0, -1));
    else if (e.key === "Tab") return setOpen(false);
    else return;
    e.preventDefault();
  };

  const listId = `${uid}-list`;
  const optId = (i: number) => `${uid}-o${i}`;

  return (
    <div className="relative min-w-0 w-full">
      <div
        ref={boxRef}
        onPointerDown={(e) => {
          // Clicking the field's blank space focuses the query, as in a text input.
          if (e.target === e.currentTarget) {
            e.preventDefault();
            inputRef.current?.focus();
            setOpen(true);
          }
        }}
        className={cn(
          "flex min-h-10 w-full cursor-text flex-wrap items-center gap-1.5 rounded-xl border border-line bg-field py-1.5 pr-2.5 pl-1.5 transition-[border-color,box-shadow] duration-200 hover:border-faint",
          open && "border-brand-600 ring-3 ring-brand-600/12 hover:border-brand-600",
        )}
      >
        {value.map((v) => (
          <span key={v} className="flex h-7 items-center gap-1 rounded-lg bg-board pr-1 pl-2.5 text-[14px] font-medium text-ink">
            {labelOf(v)}
            <button
              type="button"
              aria-label={`Retirer ${labelOf(v)}`}
              onClick={() => toggle(v)}
              className="grid size-5 place-items-center rounded-md text-muted transition-colors hover:bg-alert/10 hover:text-alert"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && rows[active] ? optId(active) : undefined}
          value={query}
          placeholder={value.length ? "" : placeholder}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKey}
          className="h-7 min-w-[120px] flex-1 bg-transparent pl-1.5 text-[15px] text-ink outline-none placeholder:text-faint"
        />
      </div>

      <Popover open={open} anchor={boxRef} onDismiss={() => setOpen(false)} matchWidth>
        <div className={cn(panelCls, "flex max-w-[min(480px,calc(100vw-16px))] min-w-[220px] flex-col p-1.5")}>
          <div ref={listRef} id={listId} role="listbox" aria-multiselectable aria-label={ariaLabel} className="scroll-area relative max-h-[280px] overflow-y-auto outline-none">
            {rows.map((o, i) => {
              const on = !o.create && value.includes(o.value);
              return (
                <div
                  key={o.create ? "\0create" : o.value}
                  id={optId(i)}
                  data-i={i}
                  role="option"
                  aria-selected={on}
                  onPointerDown={(e) => e.preventDefault()} // keeps focus in the query
                  onPointerMove={() => setActive(i)}
                  onClick={() => toggle(o.value)}
                  className={cn(
                    "flex min-h-9 cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-[14px] transition-colors duration-150",
                    i === active && "bg-board",
                    on ? "font-medium text-brand-ink" : "text-ink",
                  )}
                >
                  {o.create ? (
                    <>
                      <Plus aria-hidden className="size-4 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate">
                        Ajouter « <b className="font-medium">{o.label}</b> »
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{o.label}</span>
                        {o.sub && <span className="block truncate text-[12px] font-normal text-muted">{o.sub}</span>}
                      </span>
                      <Check aria-hidden className={cn("size-4 shrink-0 transition-[opacity,scale] duration-200", on ? "scale-100 opacity-100" : "scale-50 opacity-0")} />
                    </>
                  )}
                </div>
              );
            })}
            {rows.length === 0 && <p className="px-2.5 py-6 text-center text-[13px] text-muted">{empty}</p>}
          </div>
        </div>
      </Popover>
    </div>
  );
}
