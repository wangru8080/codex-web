"use client";

import dynamic from "next/dynamic";
import type { MarkdownEditorProps } from "./MarkdownEditor";

/*
 * Dynamic wrapper for MarkdownEditor — keeps CodeMirror's ~135 KB
 * gzipped bundle out of the first-paint chunk. Only resolves when the
 * SkillEditor / file-edit surface actually renders this component.
 *
 * SSR must be false: CodeMirror's EditorView hits `document` at
 * construction time, which would throw in Node.
 */
export const MarkdownEditor = dynamic<MarkdownEditorProps>(
  () => import("./MarkdownEditor").then((m) => m.MarkdownEditor),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-full w-full animate-pulse bg-muted/40"
        aria-busy="true"
        aria-label="Loading editor"
      />
    ),
  },
);

export type { MarkdownEditorProps } from "./MarkdownEditor";
