"use client";

import { useEffect, useRef } from "react";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import "@/components/editor/source-highlight-languages";
import type { FilePreview as FilePreviewType } from "@/types";
import { useThemeFamily } from "@/lib/theme/context";
import { resolveCodeTheme, resolveHljsStyle } from "@/lib/theme/code-themes";
import { FileSelectionToolbar, sourceLineRangeFromDom, useDomFileSelection } from "@/components/editor/FileSelectionToolbar";

function sourceLineProps(lineNumber: number, targetLine?: number): React.HTMLProps<HTMLElement> {
  return {
    "data-source-line": String(lineNumber),
    className: lineNumber === targetLine ? "block bg-blue-500/10" : "block",
  } as React.HTMLProps<HTMLElement>;
}

export function SourceView({
  preview,
  isDark,
  targetLine,
}: {
  preview: FilePreviewType;
  isDark: boolean;
  targetLine?: number;
}) {
  const { family, families } = useThemeFamily();
  const hljsStyle = resolveHljsStyle(resolveCodeTheme(families, family), isDark);
  const sourceRef = useRef<HTMLDivElement | null>(null);
  const selection = useDomFileSelection({
    containerRef: sourceRef,
    sourceText: preview.content,
    resolveLines: sourceLineRangeFromDom,
  });

  useEffect(() => {
    if (!targetLine) return;
    const frame = requestAnimationFrame(() => {
      sourceRef.current?.querySelector<HTMLElement>(`[data-source-line="${targetLine}"]`)
        ?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [preview.path, targetLine]);

  return (
    <div className="flex min-h-full flex-col text-xs">
      <FileSelectionToolbar filePath={preview.path} selection={selection} />
      <div ref={sourceRef}>
        <SyntaxHighlighter
          language={preview.language}
          style={hljsStyle}
          showLineNumbers
          wrapLines
          lineProps={(lineNumber) => sourceLineProps(lineNumber, targetLine)}
          customStyle={{ margin: 0, padding: "8px", borderRadius: 0, fontSize: "11px", lineHeight: "1.5", background: "transparent" }}
          lineNumberStyle={{ minWidth: "2.5em", paddingRight: "8px", color: "var(--muted-foreground)", opacity: 0.5, userSelect: "none" }}
        >
          {preview.content}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
