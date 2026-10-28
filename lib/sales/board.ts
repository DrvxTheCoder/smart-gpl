import type { DeliveryMode, DispatchStatus } from "./types";

/* ------------------------------------------------------------------
   The truck board: one column per dispatch state. Moving a card is a
   lifecycle transition, so only the next step forward is a valid drop.
   ------------------------------------------------------------------ */

export type DispatchAction = "gateIn" | "load" | "expedite" | "deliver";

export interface BoardColumn {
  status: DispatchStatus;
  title: string;
  sub: string;
}

export const BOARD_COLUMNS: BoardColumn[] = [
  { status: "PLANIFIE", title: "Planifiés", sub: "Attendus au portail" },
  { status: "EN_CHARGEMENT", title: "Au chargement", sub: "Vides reçues, chargement en cours" },
  { status: "CHARGE", title: "Chargés", sub: "Prêts pour le BL" },
  { status: "EXPEDIE", title: "En route", sub: "BL émis, livraison à confirmer" },
  { status: "LIVRE", title: "Livrés", sub: "Livrés ou enlevés" },
];

/** The action that moves a truck out of each state. */
export const NEXT_ACTION: Partial<Record<DispatchStatus, { action: DispatchAction; label: string; todo: string }>> = {
  PLANIFIE: { action: "gateIn", label: "Valider les vides reçues", todo: "Vides à valider" },
  EN_CHARGEMENT: { action: "load", label: "Valider le chargement", todo: "Chargement à valider" },
  CHARGE: { action: "expedite", label: "Émettre le BL et expédier", todo: "BL à émettre" },
  EXPEDIE: { action: "deliver", label: "Confirmer la livraison", todo: "Livraison à confirmer" },
};

/** Transitions that write ledger rows: always confirmed in a dialog, never on drop alone. */
export const CONFIRMED_ON_DROP: DispatchAction[] = ["gateIn", "expedite"];

const index = (s: DispatchStatus) => BOARD_COLUMNS.findIndex((c) => c.status === s);

/** Where a truck lands after its next step: a pick-up skips « En route ». */
export function nextStatus(from: DispatchStatus, mode: DeliveryMode): DispatchStatus | null {
  if (from === "CHARGE" && mode === "ENLEVEMENT") return "LIVRE";
  return BOARD_COLUMNS[index(from) + 1]?.status ?? null;
}

export type Move = { ok: true; action: DispatchAction } | { ok: false; reason: string; short: string } | null;

/**
 * What dropping a truck in a column means: the transition to run, or why
 * not. Null when the card goes back where it was.
 */
export function moveFor(from: DispatchStatus, to: DispatchStatus, mode: DeliveryMode): Move {
  if (from === to) return null;
  if (index(to) < index(from)) return { ok: false, short: "Pas de retour en arrière", reason: "Pas de retour en arrière : une étape validée est enregistrée et ne s'annule pas depuis le tableau." };
  const next = nextStatus(from, mode);
  const step = NEXT_ACTION[from];
  if (!step || !next) return { ok: false, short: "Étape finale", reason: "Ce camion est déjà livré." };
  // A pick-up leaves delivered: dropping it on « En route » or « Livrés » both mean expedite.
  if (to === next || (mode === "ENLEVEMENT" && from === "CHARGE" && to === "EXPEDIE")) return { ok: true, action: step.action };
  return { ok: false, short: "Une étape à la fois", reason: `Une étape à la fois : d'abord « ${step.label} ».` };
}
