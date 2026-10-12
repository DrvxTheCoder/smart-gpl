"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  ChartColumn,
  ClipboardList,
  Container,
  Cylinder,
  Factory,
  LayoutGrid,
  Monitor,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Users,
  Workflow,
  Store,
  FileText,
  ShieldUser,
  type Icon,
} from "@/components/ui/icons";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  Kbd,
} from "@/components/ui/command";
import { useStore } from "@/lib/store";
import { cap, cn, fmtDate, invCode } from "@/lib/format";

const PAGES: { href: string; label: string; icon: Icon; key: string }[] = [
  { href: "/", label: "Tableau de bord", icon: LayoutGrid, key: "D" },
  { href: "/inventaires", label: "Inventaires", icon: ClipboardList, key: "I" },
  { href: "/analyses", label: "Analyses", icon: ChartColumn, key: "A" },
  { href: "/parametres", label: "Paramètres", icon: Settings2, key: "P" },
];

const SETTINGS: { tab: string; label: string; icon: Icon }[] = [
  { tab: "marque", label: "Entreprise et marque", icon: Palette },
  { tab: "centres", label: "Centres et lignes", icon: Factory },
  { tab: "reservoirs", label: "Réservoirs", icon: Container },
  { tab: "flux", label: "Entrées et sorties", icon: ArrowLeftRight },
  { tab: "bouteilles", label: "Marques et bouteilles", icon: Cylinder },
  { tab: "regles", label: "Règles de calcul", icon: SlidersHorizontal },
  { tab: "clients", label: "Clients et contrats", icon: Users },
  { tab: "ventes", label: "Ventes et flux", icon: Workflow },
  { tab: "consignation", label: "Consignation", icon: Store },
  { tab: "rapports", label: "Rapports", icon: FileText },
  { tab: "roles", label: "Rôles", icon: ShieldUser },
  { tab: "affichage", label: "Affichage", icon: Monitor },
];

const SEQUENCE_MS = 900; // window to press the second key of "G then D"

/** True when a single-key shortcut would steal a keystroke meant for a field. */
function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el.tagName === "INPUT" && !["checkbox", "radio", "button"].includes((el as HTMLInputElement).type));
}

/**
 * Popovers stay mounted while closed (native popover API), so look for ones
 * actually showing, plus Radix dialogs and native <dialog>s.
 */
function popupOpen() {
  if (document.querySelector('[role="dialog"][data-state="open"], dialog[open]')) return true;
  try {
    return !!document.querySelector(":popover-open");
  } catch {
    return false; // browser without the popover API
  }
}

export function CommandMenu({ collapsed, onCollapse }: { collapsed: boolean; onCollapse: () => void }) {
  const router = useRouter();
  const { inventories, config, centreId, setCentreId, density, setDensity, toast } = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mac, setMac] = useState(false);
  const pendingG = useRef(0);

  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);

  const sorted = useMemo(() => [...inventories].sort((a, b) => b.date.localeCompare(a.date)), [inventories]);
  const today = sorted.find((i) => i.status === "EN_COURS" && (centreId === "all" || i.centreId === centreId)) ?? sorted.find((i) => i.status === "EN_COURS");
  const centreName = (id: string) => config.centres.find((c) => c.id === id)?.name ?? id;
  // Empty query: the latest few. Typing: every inventory is searchable.
  const shownInvs = query ? sorted : sorted.slice(0, 5);

  // Shortcuts read the latest state without re-binding the listener.
  const actions = useRef({
    openToday: () => {},
    toggleWidth: () => {},
    collapse: onCollapse,
  });
  actions.current = {
    openToday: () => (today ? router.push(`/inventaires/${today.id}`) : toast("Aucun inventaire en cours", "warning")),
    toggleWidth: () => {
      const next = density === "compact" ? "expanded" : "compact";
      setDensity(next);
      toast(next === "expanded" ? "Vue étendue" : "Vue compacte", next);
    },
    collapse: onCollapse,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target)) return;
      if (popupOpen()) return; // an open popup owns the keyboard

      const k = e.key.toLowerCase();
      if (pendingG.current && Date.now() - pendingG.current < SEQUENCE_MS) {
        pendingG.current = 0;
        const page = PAGES.find((p) => p.key.toLowerCase() === k);
        if (page) {
          e.preventDefault();
          router.push(page.href);
        }
        return;
      }
      if (k === "g") pendingG.current = Date.now();
      else if (k === "/") {
        e.preventDefault();
        setOpen(true);
      } else if (k === "n") actions.current.openToday();
      else if (k === "m") actions.current.collapse();
      else if (k === "l") actions.current.toggleWidth();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="hidden h-11 flex-1 items-center rounded-full bg-card px-4 text-left text-[14px] text-muted transition-colors hover:text-ink sm:flex sm:max-w-[360px]"
      >
        <Search className="size-[18px]" />
        <span className="ml-2.5 flex-1 truncate">Chercher un inventaire, une date</span>
        <Kbd className="bg-board ring-0">{mac ? "⌘ K" : "Ctrl K"}</Kbd>
      </button>
      <button type="button" onClick={() => setOpen(true)} className="grid size-11 place-items-center rounded-full bg-card sm:hidden" aria-label="Rechercher">
        <Search className="size-[19px]" />
      </button>

      <CommandDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery("");
        }}
      >
        <CommandInput value={query} onValueChange={setQuery} placeholder="Chercher une page, un inventaire, une action…" />
        <CommandList>
          <CommandEmpty>Aucun résultat pour « {query} »</CommandEmpty>

          <CommandGroup heading="Actions">
            <CommandItem value="saisir inventaire du jour nouveau" onSelect={() => run(actions.current.openToday)} disabled={!today}>
              <Plus />
              Saisir l&apos;inventaire du jour
              <CommandShortcut keys={["N"]} />
            </CommandItem>
            <CommandItem value="replier deplier menu barre laterale sidebar" onSelect={() => run(onCollapse)}>
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              {collapsed ? "Déplier le menu" : "Replier le menu"}
              <CommandShortcut keys={["M"]} />
            </CommandItem>
            <CommandItem value="largeur affichage vue etendue compacte" onSelect={() => run(actions.current.toggleWidth)}>
              <Monitor />
              {density === "compact" ? "Passer en vue étendue" : "Passer en vue compacte"}
              <CommandShortcut keys={["L"]} />
            </CommandItem>
          </CommandGroup>

          <CommandGroup heading="Aller à">
            {PAGES.map((p) => (
              <CommandItem key={p.href} value={`page ${p.label}`} onSelect={() => run(() => router.push(p.href))}>
                <p.icon />
                {p.label}
                <CommandShortcut keys={["G", p.key]} />
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading={query ? "Inventaires" : "Inventaires récents"}>
            {shownInvs.map((i) => (
              <CommandItem
                key={i.id}
                value={`${invCode(i.date)} ${fmtDate(i.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} ${i.date} ${centreName(i.centreId)}`}
                onSelect={() => run(() => router.push(`/inventaires/${i.id}`))}
              >
                <ClipboardList />
                <span className="min-w-0 flex-1 truncate">
                  {cap(fmtDate(i.date, { weekday: "short", day: "numeric", month: "short" }))}
                  <span className="text-muted"> · {centreName(i.centreId)}</span>
                </span>
                <span className={cn("tnum text-[12px]", i.status === "EN_COURS" ? "font-medium text-warn" : "text-faint")}>
                  {i.status === "EN_COURS" ? "En cours" : invCode(i.date)}
                </span>
              </CommandItem>
            ))}
            {query && (
              <CommandItem value={`__all ${query}`} onSelect={() => run(() => router.push(`/inventaires?q=${encodeURIComponent(query)}`))}>
                <Search />
                Voir tous les résultats pour « {query} »
              </CommandItem>
            )}
          </CommandGroup>

          <CommandGroup heading="Centre affiché">
            {[...config.centres.map((c) => ({ id: c.id, name: c.name })), { id: "all", name: "Tous les centres" }].map((c) => (
              <CommandItem key={c.id} value={`centre ${c.name}`} onSelect={() => run(() => setCentreId(c.id))}>
                <Factory />
                <span className="flex-1">{c.name}</span>
                {centreId === c.id && <span className="text-[12px] text-brand-800">Actuel</span>}
              </CommandItem>
            ))}
          </CommandGroup>

          {query && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Paramètres">
                {SETTINGS.map((s) => (
                  <CommandItem key={s.tab} value={`parametres ${s.label}`} onSelect={() => run(() => router.push(`/parametres?tab=${s.tab}`))}>
                    <s.icon />
                    {s.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
        <div className="flex items-center gap-4 border-t border-line px-5 py-2.5 text-[12px] text-muted">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> naviguer
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd> ouvrir
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Échap</Kbd> fermer
          </span>
        </div>
      </CommandDialog>
    </>
  );
}
