"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * List filters live in the URL, so every view is deep-linkable. Reading uses
 * useSearchParams: wrap the page in <Suspense>. Default values are left out.
 */
export function useQuery<K extends string>(defaults: Record<K, string>) {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const defs = useRef(defaults);
  defs.current = defaults;
  const values = Object.fromEntries((Object.keys(defaults) as K[]).map((k) => [k, params.get(k) ?? defaults[k]])) as Record<K, string>;

  const set = useCallback(
    (patch: Partial<Record<K, string>>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch) as [K, string | undefined][]) {
        if (!v || v === defs.current[k]) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${path}?${qs}` : path, { scroll: false });
    },
    [params, router, path],
  );

  return [values, set] as const;
}

/**
 * A text filter typed into a field: local state for instant typing, written
 * through to the URL. Only a URL change made elsewhere (a link, the palette)
 * flows back into the field, never the echo of our own writes.
 */
export function useQueryText(value: string, write: (v: string) => void) {
  const [text, setText] = useState(value);
  // Every value we wrote: their echoes may arrive late and out of order.
  const sent = useRef(new Set([value]));
  useEffect(() => {
    if (sent.current.has(value)) return;
    sent.current = new Set([value]);
    setText(value);
  }, [value]);
  const change = (v: string) => {
    setText(v);
    sent.current.add(v);
    write(v);
  };
  return [text, change] as const;
}
