"use client";

import { Container } from "@/components/ui/icons";
import { TankLevel } from "@/components/production/production";
import type { TankType } from "@/lib/types";
import { TankIllustration } from "./TankIllustration";
import { TANK_GEOMETRY, TANK_REF_HEIGHT, tankKind } from "./tankGeometry";

/** One slide: name and tonnage, the animated tank, then the fill bar. */
export function TankCard({ name, type, pct, tonnes, capT, capM3 }: { name: string; type: TankType; pct: number; tonnes: number; capT: number; capM3: number }) {
  const kind = tankKind(type);
  return (
    <div className="h-full rounded-2xl bg-board p-4">
      <TankLevel name={name} pct={pct} tonnes={tonnes} capT={capT} capM3={capM3}>
        {/* Shared scale and baseline: every drawing is sized against the tallest viewBox. */}
        <div className="flex h-[132px] items-end justify-center py-2">
          {kind ? (
            <TankIllustration
              type={kind}
              fill={pct / 100}
              className="max-w-full"
              style={{ height: `${(TANK_GEOMETRY[kind].viewBox.h / TANK_REF_HEIGHT) * 100}%` }}
            />
          ) : (
            <Container className="size-12 self-center text-faint" aria-hidden />
          )}
        </div>
      </TankLevel>
    </div>
  );
}
