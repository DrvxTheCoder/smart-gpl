/* The device's look (brand colour, page width, collapsed rail) lives in
   localStorage, which the server cannot read. applyLook runs as an inline
   script in <head>, before the first paint, so the page never shows the
   defaults first. The CSS reads the attributes it sets (see the `wide` and
   `rail` variants in globals.css); React state only catches up after. */

import { COLLAPSED_KEY, CONFIG_KEY, DENSITY_KEY, LEGACY_CONFIG_KEY } from "./keys";

const KEYS = { config: CONFIG_KEY, legacy: LEGACY_CONFIG_KEY, density: DENSITY_KEY, collapsed: COLLAPSED_KEY };

// Serialised into the page: self-contained, no imports, no helpers.
function applyLookFrom(keys: typeof KEYS) {
  try {
    const root = document.documentElement;
    const raw = localStorage.getItem(keys.config) || localStorage.getItem(keys.legacy);
    if (raw) {
      const stored = JSON.parse(raw);
      const cfg = stored && (stored.config || stored); // v1 was the bare config
      const brand = cfg && cfg.branding && cfg.branding.brand;
      if (typeof brand === "string" && /^#[0-9a-f]{6}$/i.test(brand)) root.style.setProperty("--brand", brand);
    }
    root.toggleAttribute("data-wide", localStorage.getItem(keys.density) === "expanded");
    root.toggleAttribute("data-rail", localStorage.getItem(keys.collapsed) === "1");
  } catch {}
}

export const lookScript = `(${applyLookFrom.toString()})(${JSON.stringify(KEYS)})`;

/** Re-applies the stored look: React's dev remount resets <html>'s attributes. */
export const applyLook = () => applyLookFrom(KEYS);

export const setWide = (on: boolean) => document.documentElement.toggleAttribute("data-wide", on);
export const setRail = (on: boolean) => document.documentElement.toggleAttribute("data-rail", on);
