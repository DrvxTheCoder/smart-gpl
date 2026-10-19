"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";

/**
 * One tooltip shared by a group of triggers, above or below the hovered one.
 * It fades in on the first hover, then glides from trigger to trigger instead of
 * blinking out and back (like the collapsed sidebar's). Mouse hover and
 * keyboard focus only; Escape or scrolling dismisses it. The text is a visual
 * aid: give each trigger its own accessible label too.
 */
export function useTooltip({ side = "top" }: { side?: "top" | "bottom" } = {}) {
  const tipRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [mounted, setMounted] = useState(false);
  const shown = useRef(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setMounted(true), []);

  const clear = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
  };

  const hide = useCallback((now = false) => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const go = () => {
      if (!shown.current || !tipRef.current) return;
      shown.current = false;
      gsap.to(tipRef.current, { opacity: 0, y: side === "top" ? "+=4" : "-=4", scale: 0.97, duration: 0.14, ease: "power2.in", overwrite: true });
    };
    if (now) go();
    else hideTimer.current = setTimeout(go, 90);
  }, [side]);

  useEffect(() => {
    const off = () => hide(true);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && hide(true);
    window.addEventListener("scroll", off, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("scroll", off, true);
      window.removeEventListener("keydown", esc);
      clear();
    };
  }, [hide]);

  const place = (el: HTMLElement, label: string) => {
    const tip = tipRef.current;
    if (!tip) return;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = side === "top" ? r.top - 8 : r.bottom + 8;
    setText(label);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (shown.current) {
      gsap.to(tip, { x, y, opacity: 1, scale: 1, duration: reduce ? 0 : 0.3, ease: "power3.out", overwrite: true });
    } else {
      gsap.set(tip, { xPercent: -50, yPercent: side === "top" ? -100 : 0, transformOrigin: side === "top" ? "50% 100%" : "50% 0%" });
      gsap.fromTo(tip, { x, y: side === "top" ? y + 6 : y - 6, opacity: 0, scale: 0.96 }, { y, opacity: 1, scale: 1, duration: reduce ? 0 : 0.22, ease: "power3.out", overwrite: true });
    }
    shown.current = true;
  };

  const show = (el: HTMLElement, label: string) => {
    clear();
    // A short intent delay on the first hover; once open, it follows at once.
    if (shown.current) place(el, label);
    else openTimer.current = setTimeout(() => place(el, label), 120);
  };

  const bind = (label: string) => ({
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse") show(e.currentTarget, label);
    },
    onPointerLeave: () => hide(),
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      if (e.currentTarget.matches(":focus-visible")) show(e.currentTarget, label);
    },
    onBlur: () => hide(),
  });

  const tip = mounted
    ? createPortal(
        <div
          ref={tipRef}
          aria-hidden
          className="pointer-events-none fixed top-0 left-0 z-50 flex h-6 items-center rounded-md bg-brand-950 px-2 text-[11px] font-medium whitespace-nowrap text-white opacity-0 shadow-[0_10px_24px_-10px_rgba(4,17,10,0.55)]"
        >
          <span className={`absolute left-1/2 size-2 -translate-x-1/2 rotate-45 rounded-xs bg-brand-950 ${side === "top" ? "-bottom-1" : "-top-1"}`} />
          <span className="relative">{text}</span>
        </div>,
        document.body,
      )
    : null;

  /** Changes the text of the open tooltip in place (e.g. « Copié » after a click). */
  const relabel = (label: string) => {
    if (shown.current) setText(label);
  };

  return { bind, tip, hide, relabel };
}
