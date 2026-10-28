import type { LevelModel } from "@/lib/tankLevel";
import type { TankType } from "@/lib/types";

/* ------------------------------------------------------------------
   Geometry of each tank illustration, in the SVG's own units.
   `clipBox` is the inner area the liquid fills; the level math maps a
   volume ratio onto its height.
   ------------------------------------------------------------------ */

export type TankKind = "sphere" | "cigar" | "citerne";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TankGeometry {
  viewBox: Box;
  clipBox: Box;
  model: LevelModel;
}

export const TANK_GEOMETRY: Record<TankKind, TankGeometry> = {
  // Source viewBox 122.64 × 109.04, cropped to the drawing (rail top to base plate).
  // Body circle: centre (61.79, 37.69), r 31.05; the liquid sits 1.15 inside the shell.
  sphere: {
    viewBox: { x: 29.49, y: -0.5, w: 64.6, h: 76.23 },
    clipBox: { x: 31.89, y: 7.79, w: 59.8, h: 59.8 },
    model: "sphere",
  },
  // Body pill: x 10.01–59.49, y 9.68–31.80 (radius 11.06); the liquid sits 1 inside the shell.
  cigar: {
    viewBox: { x: 0, y: 0, w: 69.12, h: 37.95 },
    clipBox: { x: 11.01, y: 10.68, w: 47.48, h: 20.12 },
    model: "horizontal-cylinder",
  },
  // Body: x 2.90–69.92, cylinder y 10.72–62.90 under the dome and rail; the liquid sits 1 inside the shell.
  citerne: {
    viewBox: { x: 0, y: 0, w: 72.83, h: 66.21 },
    clipBox: { x: 3.9, y: 11.72, w: 65.02, h: 50.18 },
    model: "vertical-cylinder",
  },
};

/** Tallest viewBox; illustrations share one scale so a cigar keeps its size next to a sphere. */
export const TANK_REF_HEIGHT = Math.max(...Object.values(TANK_GEOMETRY).map((g) => g.viewBox.h));

/** Illustration for a configured reservoir type, if one exists. */
export function tankKind(type: TankType): TankKind | null {
  if (type === "SPHERE") return "sphere";
  if (type === "CIGARE") return "cigar";
  if (type === "CITERNE") return "citerne";
  return null;
}
