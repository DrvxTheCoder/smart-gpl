"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
import { cn } from "@/lib/format";

export interface Slide {
  key: string;
  label: string;
  node: ReactNode;
}

const smooth = (): ScrollBehavior =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

/**
 * Scroll-snap carousel: two slides per view from `sm`, one with the next peeking on phones.
 * Arrows and dots appear only when the slides overflow.
 */
export function TankSlider({ slides, label }: { slides: Slide[]; label: string }) {
  const track = useRef<HTMLDivElement>(null);
  // Snap positions (scrollLeft per page) and the current one.
  const [stops, setStops] = useState<number[]>([0]);
  const [page, setPage] = useState(0);

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const base = el.getBoundingClientRect().left - el.scrollLeft;
    const next: number[] = [];
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const left = Math.min(Math.round(child.getBoundingClientRect().left - base), max);
      if (!next.length || left - next[next.length - 1] > 4) next.push(left);
    }
    if (max > 1 && next[next.length - 1] < max - 4) next.push(max);
    setStops(max > 1 ? next : [0]);
    let best = 0;
    for (let i = 1; i < next.length; i++) if (Math.abs(next[i] - el.scrollLeft) < Math.abs(next[best] - el.scrollLeft)) best = i;
    setPage(max > 1 ? best : 0);
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [measure, slides.length]);

  const go = (i: number) => {
    const el = track.current;
    const to = stops[Math.min(Math.max(i, 0), stops.length - 1)];
    if (el && to != null) el.scrollTo({ left: to, behavior: smooth() });
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") go(page + 1);
    else if (e.key === "ArrowLeft") go(page - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(stops.length - 1);
    else return;
    e.preventDefault();
  };

  const paged = stops.length > 1;

  return (
    <section aria-roledescription="carousel" aria-label={label}>
      <div
        ref={track}
        tabIndex={paged ? 0 : -1}
        onKeyDown={onKey}
        className="tank-slider -m-1 flex gap-3 overflow-x-auto p-1"
      >
        {slides.map((s, i) => (
          <div
            key={s.key}
            role="group"
            aria-roledescription="diapositive"
            aria-label={`${s.label}, ${i + 1} sur ${slides.length}`}
            data-expand-hint={s.key}
            className="shrink-0 basis-[85%] sm:basis-[calc(50%-6px)]"
          >
            {s.node}
          </div>
        ))}
      </div>

      {paged && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            {stops.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => go(i)}
                aria-label={`Aller à la page ${i + 1} sur ${stops.length}`}
                aria-current={i === page ? "true" : undefined}
                className="grid h-6 place-items-center px-0.5"
              >
                <span className={cn("block h-1.5 rounded-full transition-all duration-300", i === page ? "w-5 bg-brand-800" : "w-1.5 bg-[var(--hatch)]")} />
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => go(page - 1)}
              disabled={page === 0}
              aria-label="Réservoir précédent"
              className="grid size-8 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-brand-50 hover:text-ink disabled:pointer-events-none disabled:opacity-35"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => go(page + 1)}
              disabled={page === stops.length - 1}
              aria-label="Réservoir suivant"
              className="grid size-8 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-brand-50 hover:text-ink disabled:pointer-events-none disabled:opacity-35"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
