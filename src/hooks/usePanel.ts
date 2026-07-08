"use client";

import { createContext, useContext } from "react";
import type { PreviewTrust } from "@/lib/preview-source";

export type PanelContent = "files" | "tasks";

export type PreviewViewMode = "source" | "rendered" | "edit";

/**
 * Preview panel content source — discriminated union.
 *
 * - `file`             : filesystem path, API-loaded via /api/files/preview
 * - `inline-html`      : HTML string, rendered directly in iframe srcDoc (Phase 2)
 * - `inline-jsx`       : TSX/JSX string, rendered via Sandpack (Phase 2)
 * - `inline-datatable` : structured rows+header, rendered via DataTable viewer (Phase 5.4)
 *
 * All `inline-*` variants optionally carry a `virtualName` for header /
 * breadcrumb / copy fallback text. The file variant uses the path's
 * basename for display.
 *
 * The file variant carries a Phase-4 `trust` tier:
 *   - workspace        : path under sessionWorkingDirectory; loads with
 *                        baseDir, editable.
 *   - user-selected    : path outside workspace, user has authorized
 *                        opening; loads without workspace baseDir,
 *                        defaults readonly.
 *   - agent-referenced : path outside workspace, named by an AI tool;
 *                        PreviewPanel must render a confirm card and
 *                        delay fetch until the user accepts (which
 *                        transitions the source to user-selected).
 *
 * `trust` is optional for back-compat with callers and persisted state
 * pre-Phase-4 — consumers that read it should default a missing value
 * to 'workspace'. New code (this commit onward) sets it explicitly.
 *
 * Callers should use `setPreviewSource({ kind, ... })`. The legacy
 * `setPreviewFile(path)` API is preserved as an adapter that produces
 * `{ kind: 'file', filePath: path, trust: 'workspace', baseDir: workingDirectory }`.
 */
export type PreviewSource =
  | {
      kind: "file";
      filePath: string;
      trust?: PreviewTrust;
      /** baseDir for /api/files/preview scoping. workspace tier sets
       *  this to workingDirectory; user-selected / agent-referenced
       *  leave it undefined so the route falls back to homeDir. */
      baseDir?: string;
      /** When true, edit / save / autosave are disabled in PreviewPanel. */
      readonly?: boolean;
      /**
       * Phase 4 — optional anchor to scroll to after the file loads.
       * Three accepted forms:
       *   `#L12`         → line 12, source/edit view
       *   `:12` / `:12:5`→ same, Codex-style suffix
       *   `#slug`        → heading slug, rendered view (Markdown only)
       *
       * The panel parses this via `parseAnchor()` from
       * `src/lib/markdown/anchor.ts`. Invalid anchors are ignored.
       */
      anchor?: string;
      /**
       * Phase 4 UX — Markdown presentation style applied in-place to
       * the rendered view. NOT an artifact: the file is still the
       * source of truth; the template only changes typography/colors
       * via a CSS class on the body wrapper. Persists with the tab
       * so each Markdown opens with the user's last choice for that
       * file. Missing = `article` (the polished default).
       */
      presentationTemplate?: import("@/lib/markdown/presentation-templates").MarkdownPresentationStyle;
    }
  | { kind: "inline-html"; html: string; virtualName?: string;
      /**
       * Phase 4 — optional "source backlink" for HTML artifacts
       * generated from a Markdown file. PreviewPanel renders this
       * as a chip in the header and a "Refresh from source" action.
       */
      sourceBacklink?: PreviewSourceBacklink;
      /**
       * Phase 4 P1.2 — CSP mode for the injected meta. `strict`
       * (default) applies the Round 4 Static baseline: no scripts,
       * no egress, https only for img/style/font/media. `navigate`
       * is the special case for the localhost-artifact redirector
       * which needs meta-refresh navigation to work; everything
       * else (fetch / nested frame / worker) stays closed.
       */
      cspMode?: "strict" | "navigate" }
  | {
      kind: "inline-jsx";
      jsx: string;
      virtualName?: string;
      /** Optional runtime bindings (Phase 2.1 Sandpack to decide) */
      bindings?: Record<string, unknown>;
    }
  | {
      kind: "inline-datatable";
      rows: unknown[][];
      header: string[];
      virtualName?: string;
    }
  /**
   * Phase 4.B — JSON tree viewer. Used by the code-block Preview action
   * for ```json fences. `text` is the raw JSON; the viewer parses it
   * and falls back to a syntax-highlighted text view on parse error.
   */
  | { kind: "inline-json"; text: string; virtualName?: string }
  /**
   * Phase 4.B — unified diff viewer. Used by ```diff fences. The
   * viewer parses hunks line-by-line and color-codes +/- prefixes.
   */
  | { kind: "inline-diff"; diff: string; virtualName?: string }
  /**
   * Phase 4.B — Markdown content rendered inline without a file source.
   * Used by ```md/```markdown fences and by the Markdown→HTML
   * presentation pipeline when the user previews the source markdown.
   */
  | { kind: "inline-markdown"; markdown: string; virtualName?: string };

/**
 * Source backlink metadata attached to inline-html sources that were
 * generated FROM a Markdown file. PreviewPanel uses this to render
 * the source-of-truth chip + a "Refresh from source" affordance, so
 * the user always knows the Markdown is the authoritative copy and
 * the HTML is a derived view.
 *
 * Phase 4 P2.2 — the backlink carries the original trust tier and
 * baseDir of the source file so the refresh action can re-fetch
 * through the same scope the user originally authorized. Without
 * this, refreshing a presentation generated from an external
 * user-selected Markdown would 403 against the current chat's
 * workspace baseDir.
 */
export interface PreviewSourceBacklink {
  /** Absolute path to the source Markdown file */
  sourcePath: string;
  /** Optional heading slug or `#L12` line marker — the chip surfaces
   *  this so the user knows which section the artifact was rendered
   *  from. */
  sourceAnchor?: string;
  /** Identifier for the template used. Lets the refresh action
   *  re-generate with the same look. */
  templateId?: string;
  /** Trust tier of the source file at generation time. The refresh
   *  action uses this to decide which scope to pass to /api/files/
   *  preview — `workspace` re-uses `sourceBaseDir`; `user-selected`
   *  intentionally omits baseDir so the route falls back to homeDir
   *  (matching the original fetch). */
  sourceTrust?: PreviewTrust;
  /** baseDir associated with the source at generation time. Only
   *  populated for the `workspace` tier. */
  sourceBaseDir?: string;
  /** Whether the source was readonly at generation time. */
  sourceReadonly?: boolean;
}

export type { PreviewTrust };

export interface PanelContextValue {
  // --- Left sidebar (chat list / nav) state ---
  // Lives in AppShell but exposed here so the in-sidebar collapse
  // button and the UnifiedTopBar reopen button can both flip it.
  chatListOpen: boolean;
  setChatListOpen: (open: boolean) => void;

  // --- Right-side panel states ---
  // Phase 2 (2026-04-30): gitPanelOpen / dashboardPanelOpen / previewOpen
  // were removed — those surfaces moved into the Workspace Sidebar
  // (Git + Widget fixed Tabs, Markdown / Artifact / file preview as
  // dynamic Tabs). fileTreeOpen stays as the lightweight file tree's
  // independent topbar entry; assistantPanelOpen is its own concern.
  fileTreeOpen: boolean;
  setFileTreeOpen: (open: boolean) => void;
  terminalOpen: boolean;
  setTerminalOpen: (open: boolean) => void;
  assistantPanelOpen: boolean;
  setAssistantPanelOpen: (open: boolean) => void;
  isAssistantWorkspace: boolean;
  setIsAssistantWorkspace: (is: boolean) => void;

  // --- Git summary (for top bar, derived — no setters) ---
  currentBranch: string;
  gitDirtyCount: number;
  currentWorktreeLabel: string;
  setCurrentWorktreeLabel: (label: string) => void;

  // --- Preserved from old API ---
  workingDirectory: string;
  setWorkingDirectory: (dir: string) => void;
  sessionId: string;
  setSessionId: (id: string) => void;
  sessionTitle: string;
  setSessionTitle: (title: string) => void;
  streamingSessionId: string;
  setStreamingSessionId: (id: string) => void;
  pendingApprovalSessionId: string;
  setPendingApprovalSessionId: (id: string) => void;
  /** All sessions with active streams (supports multi-session streaming) */
  activeStreamingSessions: Set<string>;
  /** All sessions with pending permission approval */
  pendingApprovalSessionIds: Set<string>;
  /**
   * Primary preview source (new API). Use this for all new callers —
   * especially Phase 2 (Artifact .jsx/.tsx preview) and Phase 5.4
   * (table Artifact) which need `inline-*` kinds.
   */
  previewSource: PreviewSource | null;
  setPreviewSource: (source: PreviewSource | null) => void;

  /**
   * Legacy file-only API — preserved as a derived adapter.
   *
   * `previewFile` is non-null only when `previewSource.kind === 'file'`,
   * so reading it stays backward-compatible for existing callers like
   * FileTreePanel's toggle logic.
   *
   * `setPreviewFile(path)` is a thin wrapper that produces
   * `setPreviewSource(path ? { kind: 'file', filePath: path } : null)`.
   * Note: this adapter is one-way — you cannot set an inline-* source
   * through setPreviewFile; use setPreviewSource directly.
   */
  previewFile: string | null;
  setPreviewFile: (path: string | null) => void;

  previewViewMode: PreviewViewMode;
  setPreviewViewMode: (mode: PreviewViewMode) => void;
}

export const PanelContext = createContext<PanelContextValue | null>(null);

export function usePanel(): PanelContextValue {
  const ctx = useContext(PanelContext);
  if (!ctx) {
    throw new Error("usePanel must be used within a PanelProvider");
  }
  return ctx;
}
