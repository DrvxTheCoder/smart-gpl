"use client";

import { Command as Cmdk } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { Search } from "@/components/ui/icons";
import { cn } from "@/lib/format";

/**
 * Command menu, after ReUI's Command (shadcn/ui on cmdk): same parts and
 * API, dressed in the app's tokens.
 */
export function Command({ className, ...props }: React.ComponentProps<typeof Cmdk>) {
  return <Cmdk className={cn("flex h-full w-full flex-col overflow-hidden text-ink", className)} {...props} />;
}

export function CommandDialog({
  title = "Palette de commandes",
  description = "Cherchez une page, un inventaire ou une action.",
  open,
  onOpenChange,
  commandProps,
  children,
}: {
  title?: string;
  description?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commandProps?: React.ComponentProps<typeof Cmdk>;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="cmd-overlay fixed inset-0 z-50 bg-brand-950/25 backdrop-blur-[2px]" />
        <Dialog.Content
          className="cmd-content fixed top-[14vh] left-1/2 z-50 w-[calc(100%-32px)] max-w-[620px] -translate-x-1/2 overflow-hidden rounded-[22px] bg-card shadow-[0_30px_70px_-20px_rgba(4,17,10,0.45)] ring-1 ring-line"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <p className="sr-only">{description}</p>
          <Command loop {...commandProps}>
            {children}
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function CommandInput({ className, ...props }: React.ComponentProps<typeof Cmdk.Input>) {
  return (
    <div className="flex h-14 items-center gap-3 border-b border-line px-5">
      <Search className="size-[19px] shrink-0 text-muted" />
      <Cmdk.Input className={cn("h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint", className)} {...props} />
    </div>
  );
}

export function CommandList({ className, ...props }: React.ComponentProps<typeof Cmdk.List>) {
  return (
    <Cmdk.List
      className={cn("scroll-area max-h-[min(440px,60vh)] scroll-py-2 overflow-y-auto overscroll-contain p-2", className)}
      {...props}
    />
  );
}

export function CommandEmpty({ className, ...props }: React.ComponentProps<typeof Cmdk.Empty>) {
  return <Cmdk.Empty className={cn("py-10 text-center text-[14px] text-muted", className)} {...props} />;
}

export function CommandGroup({ className, ...props }: React.ComponentProps<typeof Cmdk.Group>) {
  return (
    <Cmdk.Group
      className={cn(
        "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint",
        className,
      )}
      {...props}
    />
  );
}

export function CommandSeparator({ className, ...props }: React.ComponentProps<typeof Cmdk.Separator>) {
  return <Cmdk.Separator className={cn("mx-3 my-1.5 h-px bg-line", className)} {...props} />;
}

export function CommandItem({ className, ...props }: React.ComponentProps<typeof Cmdk.Item>) {
  return (
    <Cmdk.Item
      className={cn(
        "relative flex h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-[14px] text-ink outline-none select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-45 data-[selected=true]:bg-board [&>svg]:size-[18px] [&>svg]:shrink-0 [&>svg]:text-muted data-[selected=true]:[&>svg]:text-brand-ink",
        className,
      )}
      {...props}
    />
  );
}

/** Keys shown at the end of an item. Pass several for a sequence: ["G", "D"]. */
export function CommandShortcut({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={cn("ml-auto flex items-center gap-1", className)}>
      {keys.map((k, i) => (
        <Kbd key={i}>{k}</Kbd>
      ))}
    </span>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn("grid h-6 min-w-6 place-items-center rounded-md bg-board px-1.5 font-sans text-[11px] font-medium text-muted ring-1 ring-line", className)}>
      {children}
    </kbd>
  );
}
