"use client";

import Link from "next/link";
import { useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { canOpen } from "@/lib/modules";

/** Whether the signed-in account may open a path (its modules, or a shared page). */
export function useCanOpen() {
  const { account } = useAuth();
  return useCallback((href: string) => !!account && canOpen(account.modules, href), [account]);
}

/**
 * A link into another module: a real link for those who may open it, plain
 * text for the others, so nobody is sent to a page that turns them away.
 */
export function AccessLink({ href, className, plainClassName, children }: { href: string; className?: string; plainClassName?: string; children: React.ReactNode }) {
  const can = useCanOpen();
  return can(href) ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <span className={plainClassName}>{children}</span>
  );
}
