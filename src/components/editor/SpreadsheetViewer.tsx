"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorkBook } from "xlsx";
import { SpinnerGap } from "@/components/ui/icon";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "@/hooks/useTranslation";

export const MAX_SPREADSHEET_ROWS = 5000;
export const MAX_SPREADSHEET_COLUMNS = 200;

type XlsxModule = typeof import("xlsx");

export function SpreadsheetViewer({ bytes }: { bytes: Uint8Array<ArrayBuffer> }) {
  const { t } = useTranslation();
  const [parser, setParser] = useState<XlsxModule | null>(null);
  const [workbook, setWorkbook] = useState<WorkBook | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setParser(null);
    setWorkbook(null);
    setError(false);

    void import("xlsx").then((xlsx) => {
      if (cancelled) return;
      const parsed = xlsx.read(bytes, {
        type: "array",
        cellFormula: false,
        cellHTML: false,
        cellStyles: false,
        bookVBA: false,
        sheetRows: MAX_SPREADSHEET_ROWS,
      });
      if (cancelled) return;
      setParser(() => xlsx);
      setWorkbook(parsed);
      setSheetName(parsed.SheetNames[0] ?? "");
    }).catch(() => {
      if (!cancelled) setError(true);
    });

    return () => {
      cancelled = true;
    };
  }, [bytes]);

  const grid = useMemo(() => {
    if (!parser || !workbook || !sheetName) return null;
    const sheet = workbook.Sheets[sheetName];
    const reference = sheet?.["!ref"];
    if (!sheet || !reference) {
      return { rows: [] as string[][], columns: 0, startRow: 0, startColumn: 0, truncated: false };
    }
    const sourceRange = parser.utils.decode_range(reference);
    const fullRange = parser.utils.decode_range(sheet["!fullref"] ?? reference);
    const lastRow = Math.min(sourceRange.e.r, sourceRange.s.r + MAX_SPREADSHEET_ROWS - 1);
    const lastColumn = Math.min(sourceRange.e.c, sourceRange.s.c + MAX_SPREADSHEET_COLUMNS - 1);
    const rows: string[][] = [];
    for (let row = sourceRange.s.r; row <= lastRow; row += 1) {
      const values: string[] = [];
      for (let column = sourceRange.s.c; column <= lastColumn; column += 1) {
        const cell = sheet[parser.utils.encode_cell({ r: row, c: column })];
        values.push(cell ? String(cell.w ?? parser.utils.format_cell(cell)) : "");
      }
      rows.push(values);
    }
    return {
      rows,
      columns: Math.max(0, lastColumn - sourceRange.s.c + 1),
      startRow: sourceRange.s.r,
      startColumn: sourceRange.s.c,
      truncated: fullRange.e.r > lastRow || fullRange.e.c > lastColumn,
    };
  }, [parser, workbook, sheetName]);

  if (error) {
    return <div className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">{t("filePreview.documentParseFailed")}</div>;
  }
  if (!parser || !workbook) {
    return <div className="flex h-full items-center justify-center"><SpinnerGap size={20} className="animate-spin text-muted-foreground" /></div>;
  }
  if (!grid) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t("filePreview.emptySpreadsheet")}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center border-b border-border/50 px-2">
        <Tabs value={sheetName} onValueChange={setSheetName} className="min-w-0 flex-1">
          <div className="overflow-x-auto">
            <TabsList className="h-8 w-max justify-start">
              {workbook.SheetNames.map((name) => (
                <TabsTrigger key={name} value={name} className="h-6 max-w-48 truncate px-3 text-[11px]">
                  {name}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
      </div>
      {grid.truncated && (
        <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-200">
          {t("filePreview.spreadsheetTruncated", { rows: MAX_SPREADSHEET_ROWS, columns: MAX_SPREADSHEET_COLUMNS })}
        </div>
      )}
      {grid.rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{t("filePreview.emptySpreadsheet")}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 z-20 bg-muted">
              <tr>
                <th className="sticky left-0 z-30 h-7 w-12 min-w-12 border-b border-r border-border bg-muted" />
                {Array.from({ length: grid.columns }, (_, column) => (
                  <th key={column} className="h-7 min-w-28 border-b border-r border-border bg-muted px-2 text-center font-medium text-muted-foreground">
                    {parser.utils.encode_col(grid.startColumn + column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <th className="sticky left-0 z-10 h-7 min-w-12 border-b border-r border-border bg-muted px-2 text-right font-normal text-muted-foreground">
                    {grid.startRow + rowIndex + 1}
                  </th>
                  {row.map((cell, columnIndex) => (
                    <td key={columnIndex} title={cell} className="h-7 max-w-72 min-w-28 truncate border-b border-r border-border/70 px-2 font-mono text-[11px]">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
