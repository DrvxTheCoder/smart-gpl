"use client";

import { Moon, Sun } from "@/components/ui/icons";
import { useTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/format";
import { useTheme } from "@/lib/use-theme";

/** Light ↔ dark in one click. The choice is saved for this device; "follow
    the system" lives in Paramètres › Affichage. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  const label = dark ? "Passer en thème clair" : "Passer en thème sombre";
  const hint = useTooltip({ side: "bottom" });
  return (
    <>
      <button
        {...hint.bind(label)}
        type="button"
        aria-label={label}
        aria-pressed={dark}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setTheme(dark ? "light" : "dark", { x: r.left + r.width / 2, y: r.top + r.height / 2 });
          hint.relabel(dark ? "Passer en thème sombre" : "Passer en thème clair");
        }}
        className="relative grid size-11 place-items-center overflow-hidden rounded-full bg-card text-ink transition-colors hover:text-brand-ink cursor-pointer"
      >
        <Sun className={cn("absolute size-[19px] transition-[transform,opacity] duration-500 ease-[cubic-bezier(.3,1.3,.5,1)]", dark ? "rotate-90 scale-50 opacity-0" : "rotate-0 scale-100 opacity-100")} />
        <Moon className={cn("absolute size-[18px] transition-[transform,opacity] duration-500 ease-[cubic-bezier(.3,1.3,.5,1)]", dark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-50 opacity-0")} />
      </button>
      {hint.tip}
    </>
  );
}
