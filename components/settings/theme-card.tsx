"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Card, CardTitle, Segmented, Switch } from "@/components/ui/primitives";
import { cn } from "@/lib/format";
import type { ThemePref } from "@/lib/look";
import { useTheme } from "@/lib/use-theme";

const THEMES: { id: ThemePref; label: string }[] = [
  { id: "light", label: "Clair" },
  { id: "dark", label: "Sombre" },
  { id: "system", label: "Système" },
];

const ease = "duration-[900ms] ease-[cubic-bezier(.65,0,.25,1)]";

// Eight rays around the sun; they draw back into the disc as it becomes the moon.
const RAYS = Array.from({ length: 8 }, (_, i) => (i * 360) / 8);

/** One disc that turns from sun to moon: its rays draw in, a second circle
    slides in as a mask and bites the crescent out, the warm fill fades to the
    cool one and a few stars come out. Spared from the theme swap's
    transition freeze by data-keep-motion (globals.css). */
function SunMoon({ dark }: { dark: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <span data-keep-motion className="relative grid place-items-center">
      {/* Soft glow behind the disc, warm then cool. */}
      <span
        aria-hidden
        className={cn("absolute size-28 rounded-full transition-[background-color,opacity,transform]", ease)}
        style={{opacity: dark ? 0.22 : 0.3, transform: dark ? "scale(0.85)" : "scale(1)" }}
      />
      <svg viewBox="0 0 120 120" className={cn("relative size-32 overflow-visible transition-transform", ease, dark ? "-rotate-[30deg]" : "rotate-[15deg]")} aria-hidden>
        <defs>
          <linearGradient id={`${id}-sun`} x1="1" y1="0" x2="0" y2="1">
            <stop offset="0.2" stopColor="#ff9d0a" />
            <stop offset="1" stopColor="#ff2d6f" />
          </linearGradient>
          <linearGradient id={`${id}-moon`} x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#a6e1ff" />
            <stop offset="1" stopColor="#8a80ff" />
          </linearGradient>
          <mask id={`${id}-bite`}>
            <rect x="-20" y="-20" width="160" height="160" fill="white" />
            <circle cx="0" cy="0" r="38" fill="black" className={cn("transition-transform", ease)} style={{ transform: dark ? "translate(86px, 34px)" : "translate(160px, -50px)" }} />
          </mask>
        </defs>
        <g stroke="#ff8a1f" strokeWidth="5" strokeLinecap="round">
          {RAYS.map((a, i) => (
            <line
              key={a}
              x1="60"
              y1="2"
              x2="60"
              y2="8"
              className={cn("transition-[transform,opacity]", ease)}
              style={{
                transformOrigin: "60px 60px",
                transform: `rotate(${a}deg) translateY(${dark ? 22 : 0}px) scale(${dark ? 0.4 : 1})`,
                opacity: dark ? 0 : 1,
                transitionDelay: `${dark ? i * 25 : 200 + i * 35}ms`,
              }}
            />
          ))}
        </g>
        <g mask={`url(#${id}-bite)`} className={cn("transition-transform", ease)} style={{ transformOrigin: "60px 60px", transform: dark ? "scale(1.12)" : "scale(0.82)" }}>
          <circle cx="60" cy="60" r="46" fill={`url(#${id}-sun)`} />
          <circle cx="60" cy="60" r="46" fill={`url(#${id}-moon)`} className={cn("transition-opacity", ease)} style={{ opacity: dark ? 1 : 0 }} />
        </g>
        {[
          [106, 10, 2.4],
          [116, 50, 1.5],
          [86, -2, 1.3],
        ].map(([cx, cy, r], i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="#c4ccff"
            className={cn("transition-[opacity,transform]", ease)}
            style={{ transformOrigin: `${cx}px ${cy}px`, opacity: dark ? 0.9 : 0, transform: `scale(${dark ? 1 : 0})`, transitionDelay: dark ? `${350 + i * 110}ms` : "0ms" }}
          />
        ))}
      </svg>
    </span>
  );
}

function useClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const t = setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function ThemeCard() {
  const { pref, theme, setTheme, contrast, setContrast } = useTheme();
  const track = useRef<HTMLDivElement>(null);
  const clock = useClock();
  const dark = theme === "dark";

  return (
    <Card className="w-fit">
      <CardTitle>Thème</CardTitle>
      <p className="mt-1 text-[13px] text-muted">Choisissez votre thème préféré</p>

      <div className="mt-5 w-85 max-w-85">
        {/* A small screen previewing the theme, the switcher at its foot. */}
        <div className="relative flex flex-col items-center rounded-[26px] bg-board p-4 pt-3 ring-1 ring-line">
          <div className="tnum flex h-5 w-full items-center justify-between px-1 text-[12px] font-medium text-faint">
            <span>{clock}</span>
            <span className={cn("rounded-full bg-canvas px-2 text-[11px] transition-opacity duration-300", pref === "system" ? "opacity-100" : "opacity-0")}>Auto</span>
          </div>
          <div className="grid h-40 place-items-center">
            <SunMoon dark={dark} />
          </div>
          {/* The app's own segmented control, as in the module switcher. The
              wrapper finds the clicked option for the reveal's origin, and keeps
              the pill gliding through the theme swap. */}
          <div ref={track} data-keep-motion>
            <Segmented
              label="Thème"
              value={pref}
              options={THEMES.map((t) => ({ value: t.id, label: t.label }))}
              onChange={(v) => {
                const r = track.current?.querySelector(`[data-v="${v}"]`)?.getBoundingClientRect();
                setTheme(v, r && { x: r.left + r.width / 2, y: r.top + r.height / 2 });
              }}
            />
          </div>
        </div>

        <label data-keep-motion className="mt-4 flex items-center justify-between gap-4 px-1">
          <span className="text-[15px] font-medium">Contraste élevé</span>
          <Switch checked={contrast} label="Contraste élevé" onChange={setContrast} />
        </label>
      </div>
    </Card>
  );
}
