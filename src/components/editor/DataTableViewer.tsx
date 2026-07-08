"use client";

import { useMemo, useState } from "react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { DownloadSimple, CaretUp, CaretDown } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/*
 * DataTableViewer — Phase 5.4 minimum viable surface.
 *
 * Two entry points:
 *   - `csv` prop: raw CSV text, parsed via papaparse with header row
 *   - `rows` + `header` props: already-parsed structured data (used by
 *     the inline-datatable PreviewSource kind for chat-extracted tables)
 *
 * MVP scope: sortable columns (click header), export CSV / JSON. Deferred
 * to follow-up: column filter inputs, virtualization for >10k rows,
 * xlsx-style freeze panes, row selection.
 */

export interface DataTableViewerProps {
  /** Pre-parsed rows + header. When provided, `csv` is ignored. */
  rows?: unknown[][];
  header?: string[];
  /** Raw CSV / TSV text. Pass delimiter='\t' for TSV. */
  csv?: string;
  delimiter?: string;
  /** Filename stem used by export CSV / JSON affordances. */
  filename?: string;
}

type Row = Record<string, unknown>;

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function DataTableViewer({
  rows: rowsProp,
  header: headerProp,
  csv,
  delimiter,
  filename = "table",
}: DataTableViewerProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Derived (via useMemo) — not state — so we don't hit React's
  // "setState in effect" lint rule. Switching between rows+header and
  // csv-text input is a prop change; useMemo recomputes reactively.
  const { header, rows, parseError } = useMemo<{
    header: string[];
    rows: Row[];
    parseError: string | null;
  }>(() => {
    if (rowsProp && headerProp) {
      const structured = rowsProp.map((row) => {
        const obj: Row = {};
        headerProp.forEach((col, i) => {
          obj[col] = (row as unknown[])[i];
        });
        return obj;
      });
      return { header: headerProp, rows: structured, parseError: null };
    }
    if (csv !== undefined) {
      const result = Papa.parse<Row>(csv, {
        header: true,
        skipEmptyLines: true,
        delimiter: delimiter ?? "",
      });
      const err = result.errors[0]?.message ?? null;
      const inferredHeader = (result.meta?.fields as string[] | undefined) ?? [];
      return { header: inferredHeader, rows: result.data, parseError: err };
    }
    return { header: [], rows: [], parseError: null };
  }, [rowsProp, headerProp, csv, delimiter]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = stringifyCell(a[sortKey]);
      const bv = stringifyCell(b[sortKey]);
      const an = Number(av);
      const bn = Number(bv);
      const numeric = !Number.isNaN(an) && !Number.isNaN(bn);
      const cmp = numeric ? an - bn : av.localeCompare(bv);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const onHeaderClick = (col: string) => {
    if (sortKey === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir("asc");
    }
  };

  const download = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename.replace(/\.[^.]+$/, "")}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportCsv = () => {
    const csvText = Papa.unparse({ fields: header, data: rows });
    download(new Blob([csvText], { type: "text/csv;charset=utf-8" }), "csv");
  };

  const exportJson = () => {
    const jsonText = JSON.stringify(rows, null, 2);
    download(new Blob([jsonText], { type: "application/json;charset=utf-8" }), "json");
  };

  if (header.length === 0 && rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        No tabular data to display
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          {rows.length} rows · {header.length} columns
          {parseError && (
            <span className="ml-2 text-amber-600 dark:text-amber-400">
              · {parseError}
            </span>
          )}
        </p>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="xs" onClick={exportCsv} title="Export CSV" className="gap-1">
            <DownloadSimple size={12} />
            CSV
          </Button>
          <Button variant="ghost" size="xs" onClick={exportJson} title="Export JSON" className="gap-1">
            <DownloadSimple size={12} />
            JSON
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background">
            <tr>
              {header.map((col) => (
                <th
                  key={col}
                  className="cursor-pointer select-none border-b border-border/40 px-3 py-1.5 text-left font-medium text-muted-foreground hover:bg-muted/50"
                  onClick={() => onHeaderClick(col)}
                >
                  <span className="inline-flex items-center gap-1">
                    <span className="truncate">{col}</span>
                    {sortKey === col &&
                      (sortDir === "asc" ? (
                        <CaretUp size={10} />
                      ) : (
                        <CaretDown size={10} />
                      ))}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, i) => (
              <tr
                key={i}
                className={cn(
                  "border-b border-border/20 hover:bg-muted/30",
                  i % 2 === 1 && "bg-muted/10",
                )}
              >
                {header.map((col) => (
                  <td key={col} className="truncate px-3 py-1 font-mono text-[11px]" title={stringifyCell(row[col])}>
                    {stringifyCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
