"use client";

import { useEffect, useState, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import { dispatchAddToChat } from "@/lib/add-to-chat-event";
import { locateExcerptLines } from "@/lib/file-excerpt-reference";

export interface FileTextSelection {
  text: string;
  startLine?: number;
  endLine?: number;
  sourceLabel?: string;
}

interface UseDomFileSelectionOptions {
  containerRef: RefObject<HTMLElement | null>;
  sourceText: string;
  lineOffset?: number;
  resolveLines?: (range: Range) => { startLine: number; endLine: number } | null;
  resolveLabel?: (range: Range) => string | undefined;
}

export function useDomFileSelection({
  containerRef,
  sourceText,
  lineOffset = 0,
  resolveLines,
  resolveLabel,
}: UseDomFileSelectionOptions): FileTextSelection | null {
  const [selection, setSelection] = useState<FileTextSelection | null>(null);

  useEffect(() => {
    const handleSelectionChange = () => {
      const browserSelection = window.getSelection();
      if (!browserSelection || browserSelection.rangeCount === 0 || browserSelection.isCollapsed) {
        setSelection(null);
        return;
      }
      const range = browserSelection.getRangeAt(0);
      const container = containerRef.current;
      if (!container || !container.contains(range.commonAncestorContainer)) {
        setSelection(null);
        return;
      }
      const text = browserSelection.toString().trim();
      if (!text) {
        setSelection(null);
        return;
      }
      const lines = resolveLines?.(range) ?? locateExcerptLines(sourceText, text, lineOffset);
      setSelection({
        text,
        startLine: lines?.startLine,
        endLine: lines?.endLine,
        sourceLabel: resolveLabel?.(range),
      });
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [containerRef, lineOffset, resolveLabel, resolveLines, sourceText]);

  return selection;
}

export function sourceLineRangeFromDom(range: Range): { startLine: number; endLine: number } | null {
  const startLine = sourceLineForBoundary(range.startContainer, range.startOffset, false);
  const endLine = sourceLineForBoundary(range.endContainer, range.endOffset, true);
  if (!startLine || !endLine) return null;
  return {
    startLine: Math.min(startLine, endLine),
    endLine: Math.max(startLine, endLine),
  };
}

export function FileSelectionToolbar({
  filePath,
  selection,
}: {
  filePath: string;
  selection: FileTextSelection | null;
}) {
  const { t } = useTranslation();
  if (!selection) return null;

  return (
    <div className="sticky top-0 z-10 flex items-center justify-end gap-2 border-b border-border/40 bg-background/95 px-3 py-1.5 backdrop-blur">
      <span className="truncate text-[10px] text-muted-foreground">
        {selection.text.length} {t("filePreview.addToChat.charsLabel")}
      </span>
      <Button
        size="xs"
        variant="outline"
        onClick={() => {
          dispatchAddToChat({
            text: selection.text,
            sourcePath: filePath,
            sourceLabel: selection.sourceLabel,
            sourceAnchor: selection.startLine ? `#L${selection.startLine}` : undefined,
            startLine: selection.startLine,
            endLine: selection.endLine,
          });
        }}
        className="h-6 px-2 text-[11px]"
      >
        {t("filePreview.addToChat.action")}
      </Button>
    </div>
  );
}

function sourceLineForBoundary(node: Node, offset: number, isEnd: boolean): number | null {
  let target: Node | null = node;
  if (node instanceof Element && node.childNodes.length > 0) {
    const index = isEnd
      ? Math.max(0, Math.min(node.childNodes.length - 1, offset - 1))
      : Math.min(node.childNodes.length - 1, offset);
    target = node.childNodes[index] ?? node;
  }
  const element = target instanceof Element ? target : target?.parentElement;
  const lineElement = element?.closest<HTMLElement>("[data-source-line]");
  const value = Number(lineElement?.dataset.sourceLine);
  return Number.isInteger(value) && value > 0 ? value : null;
}
