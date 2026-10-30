"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CardTitle } from "@/components/ui/primitives";
import { ExpandButton, Expandable } from "@/components/ui/expandable";
import type { TankType } from "@/lib/types";
import { TankCard } from "./TankCard";
import { TankSlider } from "./TankSlider";

export interface TankStock {
  key: string;
  name: string;
  type: TankType;
  pct: number;
  t: number;
  capT: number;
  capM3: number;
}

/**
 * Dashboard "Réservoirs" card. Tanks follow the configured order (`centre.reservoirs`).
 * Opens into `detail`, on the tank that was clicked.
 */
export function ReservoirsCard({
  tanks,
  blocked,
  warned,
  className,
  subtitle,
  detail,
}: {
  tanks: TankStock[];
  blocked: string[];
  warned: number;
  className?: string;
  subtitle?: ReactNode;
  detail: (tankKey: string | undefined) => ReactNode;
}) {
  return (
    <Expandable className={className} title="Réservoirs" subtitle={subtitle} width="max-w-6xl" detail={detail}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <CardTitle>Réservoirs</CardTitle>
        <div className="flex items-center gap-2">
          <Link href="/parametres?tab=reservoirs" className="rounded-full border border-line px-3 py-1 text-[13px] font-medium hover:bg-brand-50">
            Configurer
          </Link>
          <ExpandButton label="Détail des réservoirs" />
        </div>
      </div>
      {tanks.length > 0 ? (
        <TankSlider
          label="Réservoirs"
          slides={tanks.map((t) => ({
            key: t.key,
            label: t.name,
            node: <TankCard name={t.name} type={t.type} pct={t.pct} tonnes={t.t} capT={t.capT} capM3={t.capM3} />,
          }))}
        />
      ) : (
        <p className="text-[14px] text-muted">Aucune mesure de réservoir pour le moment.</p>
      )}
      {/* <p className="mt-5 text-[12px] text-muted">Dernière mesure saisie. Poids liquide corrigé à la température.</p> */}
      {(blocked.length > 0 || warned > 0) && (
        <p className="mt-1.5 text-[12px] text-warn">
          {blocked.length > 0 && `Sans résultat, mesure hors table : ${blocked.join(", ")}. `}
          {warned > 0 && `${warned} réservoir${warned > 1 ? "s" : ""} avec avertissement de correction. Voir la fiche du jour.`}
        </p>
      )}
    </Expandable>
  );
}
