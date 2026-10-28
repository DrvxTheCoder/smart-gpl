"use client";

import { useCallback, useEffect, useState } from "react";
import { applyLook, readContrast, readThemePref, setContrast, setThemePref, systemTheme, type Theme, type ThemePref } from "./look";

/** The device's theme preference and what it resolves to. Follows the system
    live while the preference is "system". Before mount it reports light, the
    server's guess; the page itself is already painted right by the look script. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>("system");
  const [system, setSystem] = useState<Theme>("light");
  const [contrast, setContrastState] = useState(false);

  useEffect(() => {
    setPref(readThemePref());
    setSystem(systemTheme());
    setContrastState(readContrast());
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      setSystem(mq.matches ? "dark" : "light");
      if (readThemePref() === "system") setThemePref("system");
    };
    mq.addEventListener("change", onChange);
    // Another tab changed it.
    const onStorage = () => {
      setPref(readThemePref());
      setContrastState(readContrast());
      applyLook();
    };
    addEventListener("storage", onStorage);
    return () => {
      mq.removeEventListener("change", onChange);
      removeEventListener("storage", onStorage);
    };
  }, []);

  const choose = useCallback((next: ThemePref, origin?: { x: number; y: number }) => {
    setPref(next);
    setThemePref(next, origin);
  }, []);

  const toggleContrast = useCallback((on: boolean) => {
    setContrastState(on);
    setContrast(on);
  }, []);

  return { pref, theme: pref === "system" ? system : pref, setTheme: choose, contrast, setContrast: toggleContrast };
}
