import { nextVersion, versionsOf } from "../forecast";
import type { CommandResult, Env } from "../store";
import type { Forecast, ForecastLine } from "../types";

/**
 * Saves the grid as a new version; the previous one stays, never overwritten.
 * The grid sends every cell, zeros included, so an emptied period is replaced too.
 */
export function saveForecast(env: Env, o: { centreId: string; granularity: Forecast["granularity"]; lines: ForecastLine[] }): CommandResult {
  if (!env.can("forecast.edit")) return { ok: false, error: "Action réservée : la saisie des prévisions est ouverte à l'équipe commerciale." };
  if (o.centreId === "all") return { ok: false, error: "Choisissez un centre : les prévisions se saisissent centre par centre." };
  const previous = versionsOf(env.data.forecasts, o.centreId, o.granularity)[0];
  const fc = nextVersion(previous, { id: crypto.randomUUID(), centreId: o.centreId, granularity: o.granularity, by: env.by, now: env.now, lines: o.lines });
  if (previous && key(previous.lines) === key(fc.lines)) return { ok: false, error: "Aucun changement : modifiez au moins une quantité avant d'enregistrer une version." };
  return { ok: true, patch: { forecasts: [fc] }, msg: `Prévision v${fc.version} enregistrée` };
}

const key = (lines: ForecastLine[]) =>
  lines
    .map((l) => `${l.period}|${l.scope}|${l.key}|${l.formatId}|${l.qty}`)
    .sort()
    .join(";");
