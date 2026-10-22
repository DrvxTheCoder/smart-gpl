"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  LayoutGrid,
  ClipboardList,
  ChartColumn,
  Settings2,
  LifeBuoy,
  LogOut,
  Menu,
  X,
  FileDown,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowDown,
  ShoppingCart,
  Store,
  Target,
  TrendingUp,
  Truck,
  Users,
  Warehouse,
  Factory,
} from "@/components/ui/icons";
import { Segmented } from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth";
import { canOpen, moduleDef, moduleOf, MODULES, type ModuleId } from "@/lib/modules";
import { fillState } from "@/lib/sales/stock";
import { useStore } from "@/lib/store";
import { COLLAPSED_KEY } from "@/lib/keys";
import { setRail } from "@/lib/look";
import { useSalesMaybe } from "@/lib/sales/store";
import { wholesalerStatuses } from "@/lib/sales/alerts";
import { Select } from "@/components/ui/select";
import { CommandMenu } from "./command-menu";
import { Island } from "./island";
import { AlertBell } from "./alert-bell";
import { cn } from "@/lib/format";
import { buildYearReport } from "@/lib/year-report";
import { ICON_PATHS, ICON_SIZE } from "@/lib/brand";
import { failingExport } from "@/lib/dev/failing-export"; // DEV ONLY, temporary

gsap.registerPlugin(useGSAP);

export const PRODUCT = "Smart GPL"; // placeholder product name

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${ICON_SIZE} ${ICON_SIZE}`} className={className} fill="currentColor" aria-hidden>
      {ICON_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

type BadgeKey = "inventories" | "approvals" | "dispatches" | "late" | "fills";
const BADGE_TEXT: Record<BadgeKey, string> = { inventories: "en cours", approvals: "à valider", dispatches: "au chargement", late: "en retard", fills: "à remplir" };
interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  badge?: BadgeKey;
}

/* Each module has its own navigation; Paramètres, help and sign-out are shared. */
const NAV: Record<ModuleId, NavItem[]> = {
  production: [
    { href: "/", label: "Tableau de bord", icon: LayoutGrid },
    { href: "/inventaires", label: "Inventaires", icon: ClipboardList, badge: "inventories" },
    { href: "/remplissage", label: "Remplissage", icon: Factory, badge: "fills" },
    { href: "/analyses", label: "Analyses", icon: ChartColumn },
  ],
  ventes: [
    { href: "/ventes", label: "Tableau de bord", icon: TrendingUp },
    { href: "/ventes/commandes", label: "Commandes", icon: ShoppingCart, badge: "approvals" },
    { href: "/ventes/clients", label: "Clients", icon: Users },
    { href: "/ventes/previsions", label: "Prévisions", icon: Target },
    { href: "/ventes/grossistes", label: "Grossistes", icon: Store, badge: "late" },
  ],
  stock: [
    { href: "/magasin", label: "Stock et bouteilles", icon: Warehouse },
    { href: "/expeditions", label: "Expéditions", icon: Truck, badge: "dispatches" },
  ],
};

/* Where each module was last left, so switching back returns there. */
const lastPath: Partial<Record<ModuleId, string>> = {};
let lastModule: ModuleId | null = null;

/** The module on screen: the page's own, or for shared pages the last one visited. */
function useCurrentModule(): ModuleId {
  const path = usePathname();
  const { account } = useAuth();
  return moduleOf(path) ?? (lastModule && account?.modules.includes(lastModule) ? lastModule : account?.modules[0] ?? "production");
}

/** Switch between the modules the account may open; hidden for a single-module account. */
function ModuleSwitcher({ onSwitch }: { onSwitch?: () => void }) {
  const { account } = useAuth();
  const router = useRouter();
  const current = useCurrentModule();
  const mods = MODULES.filter((m) => account?.modules.includes(m.id));
  if (mods.length < 2) return null;
  return (
    <Segmented
      label="Module"
      value={current}
      onChange={(m) => {
        onSwitch?.();
        router.push(lastPath[m] ?? moduleDef(m).home);
      }}
      options={mods.map((m) => ({ value: m.id, label: m.label }))}
    />
  );
}

const isDesktop = () => window.matchMedia("(min-width: 1024px)").matches;

/** The one link to highlight: the longest href the path falls under. */
function activeHref(path: string, items: NavItem[]) {
  let best = "";
  for (const href of [...items.map((i) => i.href), "/parametres"]) {
    const hit = href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
    if (hit && href.length > best.length) best = href;
  }
  return best;
}

/**
 * One tooltip for the whole collapsed rail. It fades in beside the first icon
 * hovered, then glides from icon to icon instead of blinking out and back.
 */
function useRailTooltip(enabled: boolean) {
  const tipRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const shown = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback((now = false) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const go = () => {
      if (!shown.current || !tipRef.current) return;
      shown.current = false;
      gsap.to(tipRef.current, { opacity: 0, x: "-=6", duration: 0.16, ease: "power2.in", overwrite: true });
    };
    if (now) go();
    else hideTimer.current = setTimeout(go, 90);
  }, []);

  useEffect(() => {
    if (!enabled) hide(true);
  }, [enabled, hide]);

  const show = (el: HTMLElement, label: string) => {
    const tip = tipRef.current;
    if (!enabled || !tip || !isDesktop()) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const r = el.getBoundingClientRect();
    const rail = el.closest("aside")?.getBoundingClientRect();
    const x = (rail?.right ?? r.right) + 10;
    const y = r.top + r.height / 2;
    setText(label);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (shown.current) {
      gsap.to(tip, { x, y, opacity: 1, duration: reduce ? 0 : 0.32, ease: "power3.out", overwrite: true });
    } else {
      gsap.set(tip, { y, yPercent: -50 });
      gsap.fromTo(tip, { x: x - 8, opacity: 0, scale: 0.96 }, { x, opacity: 1, scale: 1, duration: reduce ? 0 : 0.24, ease: "power3.out", overwrite: true });
    }
    shown.current = true;
  };

  const bind = (label: string) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => show(e.currentTarget, label),
    onMouseLeave: () => hide(),
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      if (e.currentTarget.matches(":focus-visible")) show(e.currentTarget, label);
    },
    onBlur: () => hide(),
  });

  const tooltip = (
    <div
      ref={tipRef}
      aria-hidden
      className="pointer-events-none fixed top-0 left-0 z-50 hidden h-6 items-center rounded-md bg-brand-950 px-2 text-[11px] font-medium whitespace-nowrap text-white opacity-0 shadow-[0_10px_24px_-10px_rgba(4,17,10,0.55)] lg:flex"
    >
      <span className="absolute top-1/2 -left-1 size-2 -translate-y-1/2 rotate-45 rounded-xs bg-brand-950" />
      <span className="relative">{text}</span>
    </div>
  );

  return { bind, tooltip, hide };
}

function SectionLabel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <p className={cn("relative mb-2 h-[18px] px-1 text-[12px] font-medium whitespace-nowrap text-faint", className)}>
      <span className="transition-opacity duration-200 lg:rail:opacity-0">{children}</span>
      <span aria-hidden className="absolute top-1/2 left-3 hidden h-px w-5 bg-line opacity-0 transition-opacity duration-300 lg:block rail:opacity-100" />
    </p>
  );
}

function Sidebar({ open, onClose, collapsed }: { open: boolean; onClose: () => void; collapsed: boolean }) {
  const path = usePathname();
  const { inventories, toast, config, startJob, centreId } = useStore();
  const { logout } = useAuth();
  const router = useRouter();
  const mod = useCurrentModule();
  const items = NAV[mod];
  const sales = useSalesMaybe(); // the shell renders before the sales data is built
  const here = (id: string) => centreId === "all" || id === centreId;
  const late = useMemo(
    () => (sales ? wholesalerStatuses({ cfg: config, data: sales.data, ledger: sales.ledger, today: sales.today, own: sales.own, centreId }).filter((w) => w.step).length : 0),
    [sales, config, centreId],
  );
  const badges: Record<BadgeKey, number> = {
    inventories: inventories.filter((i) => i.status === "EN_COURS").length,
    approvals: sales?.data.orders.filter((o) => here(o.centreId) && o.status === "CONFIRMEE" && o.approval.required && !o.approval.by).length ?? 0,
    late,
    dispatches: sales?.data.dispatches.filter((d) => here(d.centreId) && (d.status === "EN_CHARGEMENT" || d.status === "CHARGE")).length ?? 0,
    fills: sales?.data.orders.filter((o) => here(o.centreId) && (o.status === "CONFIRMEE" || o.status === "EXPEDIEE") && fillState(o) != null && fillState(o)?.status !== "REMPLIE").length ?? 0,
  };
  const current = activeHref(path, items);
  const navRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLSpanElement>(null);
  const { bind, tooltip, hide } = useRailTooltip(collapsed);

  // One rail for the whole nav: it travels to the active link.
  useGSAP(
    () => {
      const link = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!link || !railRef.current) return;
      const y = link.offsetTop + link.offsetHeight / 2 - 14;
      gsap.to(railRef.current, { y, opacity: 1, duration: 0.5, ease: "power3.out" });
    },
    { dependencies: [path, mod], scope: navRef },
  );

  useEffect(() => hide(true), [path, hide]);

  // On a short screen the nav scrolls; a fade at its foot says there is more below.
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const read = () => setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    el.addEventListener("scroll", read, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", read);
    };
  }, []);

  const year = new Date().getFullYear();
  const reportLabel = `Rapport annuel ${year}`;
  // Runs in the background; the hub shows its progress and outcome.
  const exportYear = () =>
    startJob({
      kind: "export",
      busyMsg: "Un export est déjà en cours",
      doneMsg: "Rapport annuel téléchargé",
      run: (onProgress) => buildYearReport({ inventories, config, year, onProgress }),
    });

  // Labels keep their full-width layout and are clipped by the rail, so
  // nothing reflows while the width animates. The rail look comes from the
  // data-rail attribute on <html>, set before the first paint (lib/look.ts).
  const fade = "transition-opacity duration-200 lg:rail:pointer-events-none lg:rail:opacity-0";
  const itemCls = "relative flex h-11 w-full items-center gap-3 overflow-hidden rounded-xl px-3 text-[15px] whitespace-nowrap transition-colors";

  return (
    <>
      <aside
        className={cn(
          "fixed inset-y-3 left-3 z-40 flex w-[248px] print:hidden flex-col overflow-hidden rounded-[26px] bg-board p-5 transition-[translate,width,box-shadow] duration-[420ms] ease-[cubic-bezier(.2,.9,.25,1)] lg:sticky lg:top-3 lg:bottom-auto lg:z-auto lg:h-[calc(100dvh-1.5rem)] lg:shrink-0 lg:self-start lg:translate-x-0",
          "lg:rail:w-[84px]",
          open ? "translate-x-0 shadow-2xl" : "-translate-x-[110%]",
        )}
        aria-label="Navigation principale"
      >
        <div className="flex items-center justify-between">
          <Link href={moduleDef(mod).home} className="flex items-center gap-1 rounded-xl" onClick={onClose} {...bind(PRODUCT)}>
            <span className="grid size-11 shrink-0 place-items-center text-brand-800">
              <Logo className="size-8" />
            </span>
            <span className={cn("text-[22px] font-extrabold tracking-[-0.02em] text-nowrap", fade)}>{PRODUCT}</span>
          </Link>
          <button className="grid size-9 place-items-center rounded-full lg:hidden" onClick={onClose} aria-label="Fermer le menu">
            <X className="size-5" />
          </button>
        </div>

        <div className="mt-5 lg:hidden">
          <ModuleSwitcher onSwitch={onClose} />
        </div>

        {/* Scrolls when the sections outgrow a short screen; it spans the
            aside's padding so the rail on its left edge is not clipped. */}
        <div
          ref={navRef}
          className="no-scrollbar relative -mx-5 mt-8 min-h-0 flex-1 overflow-y-auto px-5"
          style={more ? { maskImage: "linear-gradient(to bottom, black calc(100% - 40px), transparent)", WebkitMaskImage: "linear-gradient(to bottom, black calc(100% - 40px), transparent)" } : undefined}
        >
          <span ref={railRef} aria-hidden className="absolute top-0 left-0 h-7 w-[3px] rounded-r-full bg-brand-800 opacity-0" />
          <div>
            <SectionLabel>{moduleDef(mod).label}</SectionLabel>
            <ul className="space-y-0.5">
              {items.map(({ href, label, icon: Icon, badge }) => {
                const active = href === current;
                const count = badge ? badges[badge] : 0;
                const what = badge ? `${count} ${BADGE_TEXT[badge]}` : "";
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className={cn(itemCls, active ? "font-semibold text-ink" : "text-muted hover:bg-card/70 hover:text-ink")}
                      {...bind(count ? `${label} · ${what}` : label)}
                    >
                      <Icon className={cn("size-[19px] shrink-0", active && "text-brand-800")} strokeWidth={active ? 2.1 : 1.7} />
                      <span className={fade}>{label}</span>
                      {count > 0 && (
                        <>
                          <span
                            className={cn("tnum ml-auto grid h-5 min-w-5 place-items-center rounded-md bg-brand-800 px-1 text-[11px] font-semibold text-white", fade)}
                            aria-label={what}
                          >
                            {count}
                          </span>
                          <span
                            aria-hidden
                            className={cn(
                              "absolute top-2.5 left-[26px] hidden size-2 scale-50 rounded-full bg-brand-800 opacity-0 ring-2 ring-board transition-[opacity,scale] duration-300 lg:block",
                              "rail:scale-100 rail:opacity-100",
                            )}
                          />
                        </>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>

          <SectionLabel className="mt-7">
            Général
          </SectionLabel>
          <ul className="space-y-0.5">
            <li>
              <Link
                href="/parametres"
                onClick={onClose}
                aria-current={current === "/parametres" ? "page" : undefined}
                className={cn(itemCls, current === "/parametres" ? "font-semibold text-ink" : "text-muted hover:bg-card/70 hover:text-ink")}
                {...bind("Paramètres")}
              >
                <Settings2 className={cn("size-[19px] shrink-0", current === "/parametres" && "text-brand-800")} strokeWidth={current === "/parametres" ? 2.1 : 1.7} />
                <span className={fade}>Paramètres</span>
              </Link>
            </li>
            <li>
              <button
                onClick={() => toast("Centre d'aide à venir")}
                className={cn(itemCls, "text-muted hover:bg-card/70 hover:text-ink")}
                {...bind("Aide")}
              >
                <LifeBuoy className="size-[19px] shrink-0" strokeWidth={1.7} />
                <span className={fade}>Aide</span>
              </button>
            </li>
            <li>
              <button
                onClick={() => {
                  logout();
                  router.replace("/connexion");
                }}
                className={cn(itemCls, "text-muted hover:bg-card/70 hover:text-ink")}
                {...bind("Déconnexion")}
              >
                <LogOut className="size-[19px] shrink-0" strokeWidth={1.7} />
                <span className={fade}>Déconnexion</span>
              </button>
            </li>
          </ul>
        </div>

        {mod === "production" && (
        <div className="relative">
          <div
            className={cn(
              "surface-deep contours relative w-[208px] overflow-hidden rounded-[20px] p-4 transition-[opacity,visibility] duration-200",
              "lg:rail:invisible lg:rail:opacity-0",
            )}
          >
            <span className="grid size-8 place-items-center rounded-full bg-white/15">
              <FileDown className="size-4" />
            </span>
            <p className="mt-3 text-[16px] leading-snug font-medium">{reportLabel}</p>
            <p className="mt-1 text-[12px] text-white/70">{config.branding.companyName}, tous centres</p>
            <button
              onClick={exportYear}
              className="mt-4 h-10 w-full rounded-full bg-brand-600 text-[14px] font-medium text-white ring-1 ring-white/15 hover:bg-brand-400 hover:text-brand-950"
            >
              Générer le PDF
            </button>
            {/* <DevFailingExport /> */}
          </div>
          <button
            onClick={exportYear}
            aria-label={`${reportLabel}, exporter en PDF`}
            {...bind(`${reportLabel} (PDF)`)}
            className={cn(
              "surface-deep absolute bottom-0 left-0 hidden size-11 place-items-center rounded-xl transition-[opacity,scale,visibility] duration-300 lg:grid",
              "invisible scale-75 opacity-0 rail:visible rail:scale-100 rail:opacity-100",
            )}
          >
            <FileDown className="size-[18px]" />
          </button>
        </div>
        )}
      </aside>
      {tooltip}
      {open && <div className="fixed inset-0 z-30 bg-brand-950/25 lg:hidden" onClick={onClose} aria-hidden />}
    </>
  );
}

/**
 * DEV ONLY. Temporary: starts an export that fails after a minute, to check
 * the hub's progress-to-error transition. Remove this component, its use
 * above, and lib/dev/failing-export.ts.
 */
function DevFailingExport() {
  const { startJob } = useStore();
  return (
    <button
      onClick={() =>
        startJob({ kind: "export", busyMsg: "Un export est déjà en cours", doneMsg: "", run: failingExport })
      }
      className="mt-2 h-8 w-full rounded-full border border-dashed border-white/35 text-[12px] text-white/75 hover:bg-white/10"
    >
      Test (dev) : export en échec
    </button>
  );
}

function CentreSwitcher() {
  const { config, centreId, setCentreId } = useStore();
  return (
    <Select
      variant="pill"
      ariaLabel="Centre de production"
      value={centreId}
      onChange={setCentreId}
      align="end"
      options={[...config.centres.map((c) => ({ value: c.id, label: c.name })), { value: "all", label: "Tous les centres" }]}
    />
  );
}

/** Window scroll position, re-read on scroll and on resize. */
function useWindowScroll() {
  const [s, setS] = useState({ y: 0, max: 0 });
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const el = document.documentElement;
      setS({ y: window.scrollY, max: el.scrollHeight - window.innerHeight });
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    const ro = new ResizeObserver(queue);
    ro.observe(document.body);
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
    };
  }, []);
  return s;
}

/**
 * Stands in for the hidden page scrollbar: points down to jump to the end,
 * and flips up once past halfway to jump back to the top.
 */
function ScrollJump({ y, max }: { y: number; max: number }) {
  if (max < 40) return null;
  const up = y > max / 2;
  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: up ? 0 : max, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}
      aria-label={up ? "Remonter en haut de la page" : "Aller en bas de la page"}
      className="fixed right-5 bottom-5 z-30 grid size-11 place-items-center rounded-full bg-card text-muted shadow-[0_8px_24px_-10px_rgb(0_0_0/0.28)] ring-1 ring-line transition-colors hover:text-ink"
    >
      <ArrowDown className={cn("size-[18px] transition-transform duration-300 ease-[cubic-bezier(.2,.9,.25,1)]", up && "rotate-180")} strokeWidth={1.8} />
    </button>
  );
}

function Topbar({ onMenu, collapsed, onCollapse, raised }: { onMenu: () => void; collapsed: boolean; onCollapse: () => void; raised: boolean }) {
  const { user } = useStore();
  const { account } = useAuth();
  const multi = (account?.modules.length ?? 0) > 1; // the module switcher takes room in the bar
  const name = user.name;
  const role = user.role;
  const initials = name.split(" ").map((p) => p[0]).join("");

  return (
    <header
      className={cn(
        "relative flex shrink-0 items-center gap-3 rounded-[26px] bg-board p-2.5 pl-3 transition-shadow duration-300",
        raised && "shadow-[0_10px_28px_-14px_rgb(0_0_0/0.22)]",
      )}
    >
      <button className="grid size-11 place-items-center rounded-full bg-card lg:hidden" onClick={onMenu} aria-label="Ouvrir le menu">
        <Menu className="size-5" />
      </button>
      <button
        className="hidden size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:text-ink lg:grid cursor-pointer"
        onClick={onCollapse}
        aria-label={collapsed ? "Déplier le menu" : "Replier le menu"}
        aria-expanded={!collapsed}
      >
        <PanelLeftClose className="size-4 rail:hidden" strokeWidth={1.8} />
        <PanelLeftOpen className="hidden size-4 rail:block" strokeWidth={1.8} />
      </button>
      <div className="hidden shrink-0 lg:block">
        <ModuleSwitcher />
      </div>
      <CommandMenu collapsed={collapsed} onCollapse={onCollapse} />
      <div className="ml-auto flex items-center gap-2.5">
        <div className="hidden md:block">
          <CentreSwitcher />
        </div>
        <AlertBell />
        <Link href="/parametres" className="flex items-center gap-2.5 rounded-full pr-2" aria-label={`Paramètres du compte de ${name}`}>
          <span className="grid size-11 place-items-center rounded-full bg-[#f2cdb8] text-[14px] font-semibold text-[#5b2f19]">{initials}</span>
          <span className={cn("hidden flex-col leading-tight", multi ? "2xl:flex" : "xl:flex")}>
            <span className="text-[15px] font-medium">{name}</span>
            <span className="text-[12px] text-muted">{role}</span>
          </span>
        </Link>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { ready: storeReady, toast } = useStore();
  const { ready: authReady, account } = useAuth();
  const sales = useSalesMaybe();
  const path = usePathname();
  const router = useRouter();
  const allowed = !!account && canOpen(account.modules, path);
  const ready = storeReady && !!sales && allowed;
  const mainRef = useRef<HTMLElement>(null);

  // Signed out: to the login page. Outside one's modules: back to one's own.
  useEffect(() => {
    if (!authReady || path === "/connexion") return;
    if (!account) router.replace(`/connexion?suite=${encodeURIComponent(path)}`);
    else if (!canOpen(account.modules, path)) {
      toast(`Module ${moduleDef(moduleOf(path) ?? account.modules[0]).label.toLowerCase()} réservé à ses responsables`, "warning");
      router.replace(lastPath[account.modules[0]] ?? moduleDef(account.modules[0]).home);
    }
  }, [authReady, account, path, router, toast]);

  useEffect(() => {
    const m = moduleOf(path);
    if (m) {
      lastModule = m;
      lastPath[m] = path;
    }
  }, [path]);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {}
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    setRail(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {}
  };

  const scroll = useWindowScroll();

  // Each page starts at its top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [path]);

  // One orchestrated entrance per page: cards settle in, in reading order.
  useGSAP(
    () => {
      if (!ready) return;
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from("[data-card]", {
          y: 18,
          opacity: 0,
          duration: 0.6,
          ease: "power3.out",
          stagger: { each: 0.045, from: "start" },
          clearProps: "transform,opacity",
        });
      });
    },
    { dependencies: [path, ready], scope: mainRef },
  );

  if (path === "/connexion") return <>{children}</>;

  return (
    // Expanded fills the window, keeping the same 12px gutter on every side.
    // The width comes from the data-wide attribute on <html> (lib/look.ts).
    <div className="mx-auto flex min-h-dvh max-w-[1680px] gap-3 p-3 transition-[max-width] duration-420 ease-[cubic-bezier(.2,.9,.25,1)] wide:max-w-full print:p-0">
      <Sidebar open={open} onClose={() => setOpen(false)} collapsed={collapsed} />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {/* Sticky, backed by canvas down to its middle: the gutter above and
            the top corners read as page background, while content slides
            right under its lower edge. */}
        <div className="sticky top-0 z-20 -mt-3 pt-3 print:hidden">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-11 bg-canvas" />
          <Topbar onMenu={() => setOpen(true)} collapsed={collapsed} onCollapse={toggleCollapsed} raised={scroll.y > 0} />
        </div>
        <main ref={mainRef} id="main" className="flex-1 rounded-[26px] bg-board p-4 sm:p-5 print:rounded-none print:bg-white print:p-0">
          <div className="mb-4 md:hidden print:hidden">
            <CentreSwitcher />
          </div>
          {ready ? children : <div className="grid h-[60vh] place-items-center text-muted">Chargement…</div>}
        </main>
      </div>
      <div className="print:hidden">
        <ScrollJump y={scroll.y} max={scroll.max} />
        <Island />
      </div>
    </div>
  );
}
