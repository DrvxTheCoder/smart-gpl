"use client";

import { IntegerInput } from "@/components/ui/primitives";
import { fmt } from "@/lib/format";
import { parseBlock } from "@/lib/sales/forecast";
import type { BottleType } from "@/lib/types";

export type Grid = Record<string, Record<string, number>>; // row key → format → qty

/**
 * Forecast entry: rows (customers or categories) × formats. A block copied
 * from a spreadsheet pastes from the focused cell, right and down.
 */
export function ForecastGrid({ rows, formats, values, onChange, disabled }: { rows: { key: string; label: string; sub?: string }[]; formats: BottleType[]; values: Grid; onChange: (next: Grid) => void; disabled?: boolean }) {
  const set = (r: string, f: string, v: number) => onChange({ ...values, [r]: { ...values[r], [f]: v } });

  const paste = (e: React.ClipboardEvent, ri: number, ci: number) => {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.trim())) return; // a single value: let the field take it
    e.preventDefault();
    const next: Grid = { ...values };
    parseBlock(text).forEach((line, dr) => {
      const row = rows[ri + dr];
      if (!row) return;
      next[row.key] = { ...next[row.key] };
      line.forEach((n, dc) => {
        const f = formats[ci + dc];
        if (f) next[row.key][f.id] = n;
      });
    });
    onChange(next);
  };

  const colTotal = (f: string) => rows.reduce((a, r) => a + (values[r.key]?.[f] ?? 0), 0);
  const rowTotal = (r: string) => formats.reduce((a, f) => a + (values[r]?.[f.id] ?? 0), 0);
  const tonnes = formats.reduce((a, f) => a + (colTotal(f.id) * f.kg) / 1000, 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-[14px]">
        <thead>
          <tr className="text-left text-[12px] text-muted">
            <th className="sticky left-0 z-10 bg-card pb-2 font-medium">Ligne</th>
            {formats.map((f) => (
              <th key={f.id} className="min-w-[84px] pb-2 pl-2 text-right font-medium">
                {f.label}
              </th>
            ))}
            <th className="pb-2 pl-3 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r.key} className="border-t border-line">
              <td className="sticky left-0 z-10 bg-card py-2 pr-3">
                <p className="max-w-[170px] truncate font-medium" title={r.label}>{r.label}</p>
                {r.sub && <p className="text-[12px] text-muted">{r.sub}</p>}
              </td>
              {formats.map((f, ci) => (
                <td key={f.id} className="py-2 pl-2" onPaste={(e) => paste(e, ri, ci)}>
                  <IntegerInput ariaLabel={`${r.label}, ${f.label}`} disabled={disabled} value={values[r.key]?.[f.id] ?? 0} onChange={(v) => set(r.key, f.id, v)} className="text-right" />
                </td>
              ))}
              <td className="tnum py-2 pl-3 text-right font-medium">{fmt(rowTotal(r.key))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-ink/80 font-semibold">
            <td className="sticky left-0 z-10 bg-card pt-3">Total</td>
            {formats.map((f) => (
              <td key={f.id} className="tnum pt-3 pl-2 text-right">
                {fmt(colTotal(f.id))}
              </td>
            ))}
            <td className="tnum pt-3 pl-3 text-right">{fmt(tonnes, 1)} T</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
