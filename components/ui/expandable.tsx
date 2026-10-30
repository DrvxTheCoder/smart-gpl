"use client";

import { createContext, useContext, useId, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, MotionConfig, motion, type Transition } from "motion/react";
import { X } from "@/components/ui/icons";
import { cn } from "@/lib/format";

/*
 * A dashboard card that grows into a dialog. Card and dialog share a motion
 * layoutId, so the card's box morphs into the dialog's and back on close; the
 * dialog's content fades in once the box is on its way. Radix supplies the
 * modal behaviour (focus trap, Escape, scroll lock, focus back on close).
 */

const MORPH: Transition = { type: "spring", bounce: 0.14, duration: 0.5 };
const INTERACTIVE = "a, button, input, select, textarea, label, [role='slider'], [data-no-expand]";

const Ctx = createContext<((hint?: string) => void) | null>(null);

export function Expandable({
  title,
  subtitle,
  actions,
  detail,
  className,
  width = "max-w-5xl",
  as = "section",
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Controls beside the title in the dialog, e.g. a period switch. */
  actions?: ReactNode;
  /** The dialog body. `hint` is the `data-expand-hint` of the element clicked in the card, if any. */
  detail: (hint: string | undefined) => ReactNode;
  className?: string;
  width?: string;
  as?: "section" | "article";
  children: ReactNode;
}) {
  const layoutId = `expand-${useId()}`;
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string>();
  const close = useRef<HTMLButtonElement>(null);
  const Box = as === "article" ? motion.article : motion.section;

  const expand = (h?: string) => {
    setHint(h);
    setOpen(true);
  };

  return (
    <MotionConfig reducedMotion="user" transition={MORPH}>
      <Ctx.Provider value={expand}>
        <Box
          layoutId={layoutId}
          data-card
          style={{ borderRadius: 22 }}
          onClick={(e) => {
            const t = e.target as HTMLElement;
            // The card's own links and controls keep their job.
            if (t.closest(INTERACTIVE) && e.currentTarget.contains(t.closest(INTERACTIVE))) return;
            expand(t.closest<HTMLElement>("[data-expand-hint]")?.dataset.expandHint);
          }}
          className={cn("cursor-pointer bg-card p-5 transition-shadow duration-200 hover:shadow-[0_0_0_1px_var(--line)]", className)}
        >
          {children}
        </Box>
      </Ctx.Provider>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <AnimatePresence>
          {open && (
            <Dialog.Portal forceMount key="portal">
              <Dialog.Overlay forceMount asChild>
                <motion.div
                  className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                />
              </Dialog.Overlay>
              <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-3 sm:p-6">
                <Dialog.Content
                  forceMount
                  asChild
                  aria-describedby={undefined}
                  onOpenAutoFocus={(e) => {
                    e.preventDefault();
                    close.current?.focus();
                  }}
                  className="border border-ink/10"
                >
                  <motion.div
                    layoutId={layoutId}
                    style={{ borderRadius: 28 }}
                    className={cn("pointer-events-auto flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden bg-card text-ink shadow-[0_30px_80px_-24px_rgba(4,17,10,0.5)] sm:max-h-[calc(100dvh-3rem)]", width)}
                  >
                    <motion.div
                      className="flex min-h-0 flex-1 flex-col"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1, transition: { duration: 0.25, delay: 0.12 } }}
                      exit={{ opacity: 0, transition: { duration: 0.08 } }}
                    >
                      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4 sm:px-7 sm:pt-6">
                        <div className="min-w-0">
                          <Dialog.Title className="text-[22px] font-semibold tracking-[-0.02em]">{title}</Dialog.Title>
                          {subtitle && <p className="mt-0.5 text-[14px] text-muted">{subtitle}</p>}
                        </div>
                        <div className="flex items-center gap-2.5">
                          {actions}
                          <Dialog.Close
                            ref={close}
                            aria-label="Fermer"
                            className="grid size-9 shrink-0 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-brand-50 hover:text-ink"
                          >
                            <X className="size-4" />
                          </Dialog.Close>
                        </div>
                      </header>
                      <div className="scroll-area scroll-slim min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 sm:px-7 sm:pb-7">{detail(hint)}</div>
                    </motion.div>
                  </motion.div>
                </Dialog.Content>
              </div>
            </Dialog.Portal>
          )}
        </AnimatePresence>
      </Dialog.Root>
    </MotionConfig>
  );
}

/** The card's round corner button: the keyboard way into the dialog. */
export function ExpandButton({ label, dark }: { label: string; dark?: boolean }) {
  const expand = useContext(Ctx);
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      onClick={(e) => {
        e.stopPropagation();
        expand?.();
      }}
      className={cn(
        "grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border transition-transform hover:rotate-45",
        dark ? "border-transparent bg-white text-brand-950" : "border-line text-muted hover:text-ink",
      )}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
        <path d="M7.5 16.5l9-9M9.5 7.5h7v7" />
      </svg>
    </button>
  );
}
