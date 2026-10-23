/* The device's look (brand colour, page width, collapsed rail, theme) lives in
   localStorage, which the server cannot read. applyLook runs as an inline
   script in <head>, before the first paint, so the page never shows the
   defaults first. The CSS reads the attributes it sets (see the `wide`,
   `rail` and `dark` variants in globals.css); React state only catches up after. */

import { COLLAPSED_KEY, CONFIG_KEY, DENSITY_KEY, LEGACY_CONFIG_KEY, THEME_KEY } from "./keys";

export type ThemePref = "light" | "dark" | "system";
export type Theme = "light" | "dark";

const KEYS = { config: CONFIG_KEY, legacy: LEGACY_CONFIG_KEY, density: DENSITY_KEY, collapsed: COLLAPSED_KEY, theme: THEME_KEY };

// Browser chrome colour per theme: the canvas tokens in globals.css.
const CHROME = { light: "#e8ebe8", dark: "#0b100d" };

// Serialised into the page: self-contained, no imports, no helpers.
function applyLookFrom(keys: typeof KEYS, chrome: typeof CHROME) {
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
    const pref = localStorage.getItem(keys.theme);
    const dark = pref === "dark" || (pref !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    root.setAttribute("data-theme", dark ? "dark" : "light");
    root.style.colorScheme = dark ? "dark" : "light";
    const meta = document.querySelector('meta[name="theme-color"]:not([media])') || document.head.appendChild(document.createElement("meta"));
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", dark ? chrome.dark : chrome.light);
  } catch {}
}

export const lookScript = `(${applyLookFrom.toString()})(${JSON.stringify(KEYS)},${JSON.stringify(CHROME)})`;

/** Re-applies the stored look: React's dev remount resets <html>'s attributes. */
export const applyLook = () => applyLookFrom(KEYS, CHROME);

export const setWide = (on: boolean) => document.documentElement.toggleAttribute("data-wide", on);
export const setRail = (on: boolean) => document.documentElement.toggleAttribute("data-rail", on);

export const readThemePref = (): ThemePref => {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {}
  return "system";
};

export const systemTheme = (): Theme => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

/** Saves the preference and repaints. With an origin point (the button that
    asked), the new theme spreads from it in a circle where the browser has
    view transitions; elsewhere the swap is instant, never a cascade of
    per-element colour transitions. */
export function setThemePref(pref: ThemePref, origin?: { x: number; y: number }) {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {}
  const root = document.documentElement;
  const before = root.getAttribute("data-theme");
  const swap = () => {
    root.setAttribute("data-theme-switching", "");
    applyLook();
    // Two frames: the new colours are painted before transitions come back.
    requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute("data-theme-switching")));
  };
  const resolved = pref === "system" ? systemTheme() : pref;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (resolved === before || reduced || !origin || !document.startViewTransition) return swap();
  const r = Math.hypot(Math.max(origin.x, innerWidth - origin.x), Math.max(origin.y, innerHeight - origin.y));
  root.style.setProperty("--vt-x", `${origin.x}px`);
  root.style.setProperty("--vt-y", `${origin.y}px`);
  root.style.setProperty("--vt-r", `${r}px`);
  document.startViewTransition(swap);
}
