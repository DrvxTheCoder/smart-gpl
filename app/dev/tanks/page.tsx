"use client";

import { useState } from "react";
import { Card, CardTitle } from "@/components/ui/primitives";
import { ReservoirsCard } from "@/components/tanks/ReservoirsCard";
import { TankIllustration } from "@/components/tanks/TankIllustration";
import type { TankKind } from "@/components/tanks/tankGeometry";

/* Scratch page for the tank illustrations: edge fills, many instances on one page, live level changes. */

const FILLS = [0, 0.01, 0.05, 0.3, 0.5, 0.552, 0.9, 1];
const KINDS: TankKind[] = ["sphere", "cigar"];

export default function TanksDev() {
  const [live, setLive] = useState(0.552);
  return (
    <div className="space-y-4">
      <h1 className="text-[28px] font-semibold">Réservoirs, banc d&apos;essai</h1>

      {KINDS.map((k) => (
        <Card key={k}>
          <CardTitle>{k}</CardTitle>
          <div className="mt-4 grid grid-cols-4 gap-4 lg:grid-cols-8">
            {FILLS.map((f) => (
              <figure key={f} className="rounded-2xl bg-board p-2 text-center">
                <TankIllustration type={k} fill={f} className="mx-auto h-24 w-auto max-w-full" />
                <figcaption className="tnum mt-1 text-[12px] text-muted">{f}</figcaption>
              </figure>
            ))}
          </div>
        </Card>
      ))}

      <Card>
        <CardTitle>Niveau animé</CardTitle>
        <input type="range" min={0} max={1} step={0.01} value={live} onChange={(e) => setLive(+e.target.value)} className="mt-3 w-full" aria-label="Remplissage" />
        <div className="mt-3 flex items-end gap-6">
          <TankIllustration type="sphere" fill={live} className="h-48 w-auto" />
          <TankIllustration type="cigar" fill={live} className="h-24 w-auto" />
          <TankIllustration type="citerne" fill={live} className="h-40 w-auto" />
        </div>
      </Card>

      <ReservoirsCard
        warned={0}
        blocked={[]}
        tanks={[
          { key: "s1", name: "Sphère S1", type: "SPHERE", pct: 55.2, t: 298.2, capT: 540, capM3: 950 },
          { key: "s2", name: "Sphère S2", type: "SPHERE", pct: 8, t: 43.2, capT: 540, capM3: 950 },
          { key: "c1", name: "Cigare C1", type: "CIGARE", pct: 95, t: 128.3, capT: 135, capM3: 240 },
          { key: "c2", name: "Cigare C2", type: "CIGARE", pct: 30, t: 40.5, capT: 135, capM3: 240 },
          { key: "v1", name: "Citerne V1", type: "CITERNE", pct: 62, t: 53, capT: 85.5, capM3: 150 },
          { key: "x1", name: "Réservoir X", type: "AUTRE", pct: 40, t: 20, capT: 50, capM3: 90 },
        ]}
        detail={(key) => <p className="text-[14px] text-muted">Réservoir ouvert : {key ?? "aucun"}.</p>}
      />
    </div>
  );
}
