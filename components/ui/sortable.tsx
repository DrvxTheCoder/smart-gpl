"use client";

import { createContext, useContext, useRef, useState } from "react";
import { Reorder, useDragControls } from "motion/react";
import { Grip } from "@/components/ui/icons";
import { cn } from "@/lib/format";

/** `items` in the order of `ids`; what a Sortable's onReorder hands back. */
export const byIds = <T extends { id: string }>(items: T[], ids: string[]) => ids.map((id) => items.find((x) => x.id === id)!).filter(Boolean);

const Ctx = createContext<((id: string, by: number) => void) | null>(null);

/**
 * A list reordered by dragging each item's handle (motion's Reorder). The
 * handle also takes ArrowUp / ArrowDown, so the order can be set without a
 * pointer. Items are tracked by id, so edits inside them never break a drag.
 */
export function Sortable({
  ids,
  onReorder,
  as = "ul",
  className,
  children,
}: {
  ids: string[];
  onReorder: (ids: string[]) => void;
  as?: "ul" | "tbody";
  className?: string;
  children: React.ReactNode;
}) {
  const move = (id: string, by: number) => {
    const i = ids.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    onReorder(next);
  };
  return (
    <Ctx value={move}>
      <Reorder.Group as={as} axis="y" values={ids} onReorder={onReorder} className={className}>
        {children}
      </Reorder.Group>
    </Ctx>
  );
}

/** One sortable item; `children` receives the handle to place in the row. */
export function SortableItem({
  id,
  label,
  as = "li",
  className,
  children,
}: {
  id: string;
  label: string; // what the handle moves, for screen readers
  as?: "li" | "tr";
  className?: string;
  children: (handle: React.ReactNode) => React.ReactNode;
}) {
  const move = useContext(Ctx);
  const controls = useDragControls();
  const [dragging, setDragging] = useState(false);
  const handleRef = useRef<HTMLButtonElement>(null);

  const handle = (
    <button
      ref={handleRef}
      type="button"
      aria-label={`Déplacer ${label}`}
      title="Glisser pour réordonner"
      onPointerDown={(e) => {
        e.preventDefault();
        controls.start(e);
      }}
      onKeyDown={(e) => {
        const by = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
        if (!by || !move) return;
        e.preventDefault();
        move(id, by);
        // The row's node moves in the DOM, which drops focus: put it back.
        requestAnimationFrame(() => handleRef.current?.focus({ preventScroll: true }));
      }}
      className={cn(
        "grid size-8 shrink-0 touch-none place-items-center rounded-lg text-faint transition-colors hover:bg-card hover:text-ink focus-visible:text-ink",
        dragging ? "cursor-grabbing" : "cursor-grab",
      )}
    >
      <Grip className="size-4" />
    </button>
  );

  return (
    <Reorder.Item
      as={as}
      value={id}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => setDragging(false)}
      // className={cn("relative", dragging && "z-10 border-2 border-ink/20 p-1", className)}
      className={cn("relative", dragging && "z-10", className)}
    >
      {children(handle)}
    </Reorder.Item>
  );
}
