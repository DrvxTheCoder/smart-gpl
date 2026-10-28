/* ------------------------------------------------------------------
   Tank level math. Readings give a fill as a share of volume; the
   illustrations need the liquid height, which is not linear in volume
   for a sphere or a horizontal cylinder (a vertical one is linear).
   ------------------------------------------------------------------ */

export type LevelModel = "sphere" | "horizontal-cylinder" | "vertical-cylinder";

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0);

/** Volume ratio held below a height ratio `x` (0 = bottom, 1 = top). */
export function heightToFillRatio(model: LevelModel, x: number): number {
  const h = clamp01(x);
  if (model === "sphere") return h * h * (3 - 2 * h);
  // Upright cylinder: the domed top is ignored, so volume follows height.
  if (model === "vertical-cylinder") return h;
  // Circular segment of a cylinder lying on its side; the rounded ends are ignored.
  const theta = 2 * Math.acos(1 - 2 * h);
  return (theta - Math.sin(theta)) / (2 * Math.PI);
}

/** Height ratio of the liquid surface for a volume ratio. Both curves are monotonic, so bisection is enough. */
export function fillToHeightRatio(model: LevelModel, fill: number): number {
  const f = clamp01(fill);
  if (f === 0 || f === 1) return f;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (heightToFillRatio(model, mid) < f) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export type LevelTone = "ok" | "warn" | "alert";

/** Same thresholds as the dashboard bar: nearly empty is critical, nearly full (no headspace) is a warning. */
export function levelTone(pct: number): LevelTone {
  if (pct < 15) return "alert";
  if (pct > 90) return "warn";
  return "ok";
}
