"use client";

import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { indentWithTab } from "@codemirror/commands";
import { useTheme } from "next-themes";

/*
 * MarkdownEditor — Phase 4 replacement for the raw <textarea> in
 * SkillEditor (and the future standalone .md editor surface).
 *
 * Design points (POC 0.4 §[设计]):
 * - Compartment-based theme swap so light↔dark does not rebuild the
 *   EditorView (no flash, no cursor loss).
 * - Value prop is controlled — external writes flow in via a diff
 *   dispatch, internal edits flow out via updateListener.
 * - Mod-s is intercepted for onSave; Tab inserts two spaces via
 *   indentWithTab to match the legacy textarea's behavior.
 * - CodeMirror owns its own virtualization (O(viewport) render), so 10-
 *   万-character files stay responsive without any app-side work.
 *
 * Style isolation from Tailwind v4 preflight is handled in globals.css
 * via `@layer base { .cm-editor, .cm-editor * { all: revert-layer; } }`
 * (POC 0.4 path C). Do not wrap this component in Shadow DOM —
 * token inheritance would break and focus behavior gets weird.
 */
export interface MarkdownEditorProps {
  value: string;
  onChange: (v: string) => void;
  onSave?: () => void;
  /** Optional filename shown via data-attribute (used for testing hooks). */
  filename?: string;
  /** Aria label for a11y; also shown as placeholder hint. */
  placeholder?: string;
  className?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  filename,
  placeholder,
  className,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Compartment is stable across renders — store on ref init so we don't
  // create a new one on every render (which would cause reconfigure loops).
  const themeCompartment = useRef(new Compartment()).current;
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const { resolvedTheme } = useTheme();

  // Refs track the latest callbacks so CodeMirror's long-lived listener
  // never captures a stale closure. Without this, fast typing after
  // onChange identity changes would dispatch into the old handler.
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // Initialize EditorView once per mount. State changes flow through
  // dispatches in the other effects below.
  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;

    const baseTheme = EditorView.theme({
      "&": { height: "100%", fontSize: "13px" },
      ".cm-scroller": {
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
      },
      ".cm-content": { padding: "12px" },
      "&.cm-focused": { outline: "none" },
    });

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
      indentWithTab,
    ]);

    const initialTheme = resolvedTheme === "dark" ? oneDark : [];

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        markdown(),
        baseTheme,
        themeCompartment.of(initialTheme),
        saveKeymap,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
      ],
    });

    viewRef.current = new EditorView({ state, parent: hostRef.current });
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // Intentional single-run — subsequent prop changes propagate via
    // dedicated effects (value / theme).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes — replace doc contents via dispatch.
  // Skips when the incoming value already matches what CodeMirror has,
  // so typing doesn't cause a self-echo loop.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur !== value) {
      view.dispatch({
        changes: { from: 0, to: cur.length, insert: value },
      });
    }
  }, [value]);

  // Theme compartment swap — no EditorView rebuild, no cursor loss.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.reconfigure(
        resolvedTheme === "dark" ? oneDark : [],
      ),
    });
  }, [resolvedTheme, themeCompartment]);

  return (
    <div
      ref={hostRef}
      className={className ?? "h-full w-full overflow-hidden"}
      data-filename={filename}
      aria-label={placeholder}
    />
  );
}
