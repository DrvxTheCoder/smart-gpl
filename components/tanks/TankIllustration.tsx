"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { cn } from "@/lib/format";
import { fillToHeightRatio, levelTone, type LevelTone } from "@/lib/tankLevel";
import { TANK_GEOMETRY, type TankGeometry, type TankKind } from "./tankGeometry";
import { cigarArt } from "./svg/CigarTank";
import { citerneArt } from "./svg/CiterneTank";
import { sphereArt } from "./svg/SphereTank";
import type { TankArt } from "./svg/types";

/* ------------------------------------------------------------------
   Animated tank: the vessel drawing with liquid at the level matching
   the volume ratio. Adding a type = an SVG module + a geometry entry
   + a line here.
   ------------------------------------------------------------------ */

const TANKS: Record<TankKind, { geometry: TankGeometry; art: TankArt }> = {
  sphere: { geometry: TANK_GEOMETRY.sphere, art: sphereArt },
  cigar: { geometry: TANK_GEOMETRY.cigar, art: cigarArt },
  citerne: { geometry: TANK_GEOMETRY.citerne, art: citerneArt },
};

const TONE_COLOR: Record<LevelTone, string> = {
  ok: "var(--b-800)",
  warn: "var(--warn)",
  alert: "var(--alert)",
};

/** Sine wave across [x0, x0 + 2·width], `periods` per width, closed down to `depth` below the surface. */
function wavePath(x0: number, width: number, amp: number, periods: number, depth: number, phase = 0, closed = true) {
  const steps = periods * 2 * 16;
  const k = (2 * Math.PI * periods) / width;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * 2 * width;
    const y = -amp * Math.sin(k * x + phase);
    d += `${i ? "L" : "M"}${(x0 + x).toFixed(2)},${y.toFixed(3)}`;
  }
  return closed ? `${d}V${depth.toFixed(2)}H${x0.toFixed(2)}Z` : d;
}

export function TankIllustration({
  type,
  fill,
  bubbles = true,
  className,
  style,
}: {
  type: TankKind;
  /** Volume ratio, 0 to 1. */
  fill: number;
  bubbles?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const { geometry, art } = TANKS[type];
  const { viewBox: vb, clipBox: cb, model } = geometry;
  const prefix = "tank" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const reduce = !!useReducedMotion();

  const f = Number.isFinite(fill) ? Math.min(Math.max(fill, 0), 1) : 0;
  const empty = f <= 0;
  // Nearly empty: a thin flat sliver. Nearly full: keep the surface just under the top.
  const sliver = f <= 0.02;
  const ratio = Math.min(Math.max(fillToHeightRatio(model, f), sliver ? 0.025 : 0), 0.975);
  const surfaceY = cb.y + cb.h * (1 - ratio);
  const depth = cb.y + cb.h - surfaceY;

  // Small waves, calmer near the top and bottom where the surface narrows.
  const taper = Math.max(0.25, Math.min(1, ratio / 0.12, (1 - ratio) / 0.12));
  const amp = reduce || sliver ? 0 : cb.h * 0.022 * taper;
  const animated = !reduce && amp > 0;

  const paths = useMemo(() => {
    const bottom = cb.h + 4; // past the clip bottom from any surface height
    return {
      front: wavePath(cb.x, cb.w, amp, 2, bottom),
      crest: wavePath(cb.x, cb.w, amp, 2, bottom, 0, false),
      back: wavePath(cb.x, cb.w, amp * 0.85, 2, bottom, Math.PI * 0.6),
    };
  }, [cb, amp]);

  // Level: fills from empty on mount, then eases to each new value.
  const y = useMotionValue(reduce ? surfaceY : cb.y + cb.h + amp + 1);
  useEffect(() => {
    if (reduce) {
      y.set(surfaceY);
      return;
    }
    const controls = animate(y, surfaceY, { duration: 1.2, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [surfaceY, reduce, y]);

  // Pause the loops while the tank is off screen (or scrolled away in the slider).
  const ref = useRef<SVGSVGElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || !animated) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, [animated]);

  const showBubbles = bubbles && animated && depth > cb.h * 0.2;
  const tone = levelTone(f * 100);

  return (
    <svg
      ref={ref}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      className={cn("tank-art", !visible && "is-paused", className)}
      style={{ ...style, ["--liq" as string]: TONE_COLOR[tone] }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={`${prefix}-clip`}>{art.clip()}</clipPath>
        <linearGradient id={`${prefix}-liq`} gradientUnits="userSpaceOnUse" x1="0" y1={-amp} x2="0" y2={cb.h}>
          <stop offset="0" style={{ stopColor: "var(--liq-hi)" }} />
          <stop offset="0.35" style={{ stopColor: "var(--liq)" }} />
          <stop offset="1" style={{ stopColor: "var(--liq-deep)" }} />
        </linearGradient>
      </defs>

      {art.back({ prefix })}

      {!empty && (
        <g clipPath={`url(#${prefix}-clip)`}>
          <motion.g style={{ y }}>
            <g className={cn(animated && "tank-wave tank-wave--back")} style={{ ["--wave-shift" as string]: `${-cb.w}px` }}>
              <path d={paths.back} transform={`translate(0 ${-amp * 0.5})`} style={{ fill: "var(--liq)" }} opacity="0.55" />
            </g>
            <g className={cn(animated && "tank-wave")} style={{ ["--wave-shift" as string]: `${-cb.w}px` }}>
              <path d={paths.front} fill={`url(#${prefix}-liq)`} />
              <path d={paths.crest} fill="none" style={{ stroke: "var(--liq-crest)" }} strokeWidth={cb.h * 0.012} strokeLinejoin="round" />
            </g>
            {showBubbles &&
              [0.42, 0.55, 0.64].map((bx, i) => (
                <circle
                  key={bx}
                  className="tank-bubble"
                  cx={cb.x + cb.w * bx}
                  cy={depth * 0.88}
                  r={cb.h * (0.011 + i * 0.003)}
                  style={{ ["--rise" as string]: `${-depth * 0.8}px`, animationDelay: `${i * 1.9}s`, animationDuration: `${5.2 + i * 1.1}s` }}
                />
              ))}
          </motion.g>
        </g>
      )}

      {art.front({ prefix })}
      {art.structure({ prefix })}
    </svg>
  );
}
