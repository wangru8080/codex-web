"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { X } from "@/components/ui/icon";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import { FileTree } from "@/components/project/FileTree";
import { useWorkspaceSidebarOptional } from "@/hooks/useWorkspaceSidebar";
import { useAppServerActions } from "@/codex-web/AppServerProvider";
import { directoryContainsName, utf8ToBase64 } from "@/codex-web/app-server-files";

// Width state moved to PanelZone (Phase 7c-D); these constants now
// live there alongside the CardFrame width prop wiring.

type NewItemMode = "file" | "folder";

/**
 * @param variant
 *   - `'legacy'` (default): the standalone right-rail panel with its
 *     own ResizeHandle, panel title, Pin-to-sidebar action, and Close
 *     button. This is what the topbar's File Tree toggle opens.
 *   - `'sidebar'`: rendered as the content of the Workspace Sidebar's
 *     `files-pinned` Tab. Skips the outer ResizeHandle / width chrome,
 *     and hides the Pin button (already pinned) + Close button (the
 *     Tab strip's X handles closing). Avoids the "half-migrated" look
 *     where the sidebar Tab body still showed the legacy chrome.
 */
export function FileTreePanel({
  variant = 'legacy',
  focusPath,
  focusSeek,
}: {
  variant?: 'legacy' | 'sidebar';
  focusPath?: string;
  focusSeek?: number;
} = {}) {
  const { workingDirectory, previewFile, setPreviewFile, setFileTreeOpen } = usePanel();
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  // Pin to Workspace Sidebar — only available when the new sidebar
  // provider is mounted (i.e. inside the chat detail route). Outside
  // that context the button is hidden.
  const ws = useWorkspaceSidebarOptional();
  const { createDirectory, readDirectory, writeFile } = useAppServerActions();

  // VS-Code-like "new item" flow.
  // newItemMode gates the input row: null = hidden, 'file' = creating a
  // Markdown file, 'folder' = creating a directory. newItemTargetDir is
  // the parent directory (workspace root or a folder clicked via the
  // hover "+" on a tree row).
  const [newItemMode, setNewItemMode] = useState<NewItemMode | null>(null);
  const [newItemTargetDir, setNewItemTargetDir] = useState<string>("");
  const [newItemName, setNewItemName] = useState("");
  const [newItemError, setNewItemError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [treeReloadKey, setTreeReloadKey] = useState(0);
  const newItemInputRef = useRef<HTMLInputElement | null>(null);

  // Folder selection drives the "create inside this folder" default when
  // the user clicks the top-level New File / New Folder icons — if a
  // folder is selected, new items go inside it; otherwise they go at
  // the workspace root. Independent of file selection so clicking a
  // file doesn't clobber the current folder target.
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);

  // On open: focus the input and pre-select the stem (everything before
  // the last dot) for file mode, or the whole name for folder mode.
  useEffect(() => {
    if (newItemMode && newItemInputRef.current) {
      const input = newItemInputRef.current;
      input.focus();
      if (newItemMode === "file") {
        const dot = input.value.lastIndexOf(".");
        input.setSelectionRange(0, dot >= 0 ? dot : input.value.length);
      } else {
        input.select();
      }
    }
  }, [newItemMode]);

  const highlightPath = searchParams.get("file") || undefined;
  const highlightSeek = searchParams.get("seek") || undefined;

  const handleFileAdd = useCallback((path: string, nodeType: 'file' | 'directory') => {
    if (nodeType === 'directory') {
      // Folders go through their own attach event so the composer can
      // render them as green capsule chips (same affordance as file
      // attachments) instead of writing `@path/` text into the textarea
      // — that would duplicate the chip visually and create two
      // different display styles for + clicked file vs + clicked folder.
      window.dispatchEvent(
        new CustomEvent('attach-directory-to-chat', { detail: { path } }),
      );
    } else {
      window.dispatchEvent(new CustomEvent('attach-file-to-chat', { detail: { path } }));
    }
  }, []);

  /**
   * Open the new-item input in the given mode, targeting a specific
   * directory (or the workspace root when targetDir is undefined).
   * Toggling the same mode + same target closes the input — matches the
   * VS Code affordance where clicking New File twice returns to the
   * tree without creating anything.
   */
  const openNewItem = useCallback(
    (mode: NewItemMode, targetDir?: string) => {
      // Precedence: explicit targetDir (from hover "+" on a folder row) →
      // currently-selected folder (from click on folder row) → workspace
      // root. This matches the VS-Code feel: click folder, then click
      // New File, new file lands in that folder.
      const effectiveTarget = targetDir ?? selectedFolderPath ?? workingDirectory;
      setNewItemMode((cur) => {
        const sameAsCurrent =
          cur === mode && newItemTargetDir === effectiveTarget;
        if (sameAsCurrent) return null;
        return mode;
      });
      setNewItemTargetDir(effectiveTarget);
      setNewItemName(mode === "file" ? "untitled.md" : "new-folder");
      setNewItemError(null);
    },
    [workingDirectory, selectedFolderPath, newItemTargetDir],
  );

  const handleCreateItem = useCallback(async () => {
    setNewItemError(null);
    const trimmed = newItemName.trim();
    if (!trimmed) {
      setNewItemError(t("fileTree.newFileErrorEmpty"));
      return;
    }
    if (!workingDirectory) {
      setNewItemError(t("fileTree.newFileErrorNoWorkspace"));
      return;
    }
    const targetDir = newItemTargetDir || workingDirectory;
    setCreating(true);
    try {
      const separator = targetDir.includes("\\") ? "\\" : "/";
      const targetPath = `${targetDir}${separator}${trimmed}`;
      const parent = await readDirectory(targetDir);
      if (directoryContainsName(targetDir, parent.entries, trimmed)) {
        setNewItemError(t("fileTree.newFileErrorExists" as TranslationKey));
        return;
      }
      if (newItemMode === "folder") {
        await createDirectory(targetPath, false);
      } else {
        await writeFile(
          targetPath,
          utf8ToBase64(`# ${trimmed.replace(/\.[^.]+$/, "")}\n\n`),
        );
      }
      setNewItemMode(null);
      setNewItemName("");
      setTreeReloadKey((k) => k + 1);
      // Only open a preview for files — folders have nothing to preview.
      // setPreviewFile flows through AppShell.setPreviewSource which on
      // chat-detail routes dispatches a workspace-tab-open event; an
      // explicit setPreviewOpen(true) here would double-render the
      // legacy PanelZone PreviewPanel alongside the sidebar Tab.
      if (newItemMode === "file") {
        setPreviewFile(targetPath);
      }
    } catch (err) {
      setNewItemError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }, [createDirectory, newItemMode, newItemName, newItemTargetDir, readDirectory, workingDirectory, t, setPreviewFile, writeFile]);

  const handleFileSelect = useCallback((path: string) => {
    const ext = path.split(".").pop()?.toLowerCase() || "";
    const NON_PREVIEWABLE = new Set([
      "zip", "tar", "gz", "rar", "7z", "bz2",
      "ppt", "pptx",
      "exe", "dll", "so", "dylib", "bin", "dmg", "iso",
      "woff", "woff2", "ttf", "otf", "eot",
      "flv", "wmv", "wma",
    ]);
    if (NON_PREVIEWABLE.has(ext)) return;
    // Selecting a file clears folder selection so the next New File /
    // New Folder click lands at workspace root (not the previously-
    // selected folder) unless the user reselects one.
    setSelectedFolderPath(null);
    // Phase 1 sidebar wiring: setPreviewFile flows through AppShell's
    // `setPreviewSource`, which on chat-detail routes dispatches a
    // workspace-tab-open event (Workspace Sidebar opens / focuses the
    // matching dynamic Tab) and on other routes opens the legacy
    // PreviewPanel. Calling `setPreviewOpen(true)` here would force the
    // legacy panel open ON TOP OF the sidebar Tab → double render +
    // shared `previewSource` context that goes blank when one is
    // closed. We let `setPreviewSource` own the open/close gating.
    if (previewFile === path) {
      // Toggle off — clear the source. AppShell will close the legacy
      // panel; the Workspace Sidebar Tab stays (user closes via Tab X).
      setPreviewFile(null);
    } else {
      setPreviewFile(path);
    }
  }, [previewFile, setPreviewFile]);

  const handleSelectFolder = useCallback((folderPath: string) => {
    // Clicking the same folder again deselects (easy way to reset the
    // create target back to workspace root without clicking away).
    setSelectedFolderPath((cur) => (cur === folderPath ? null : folderPath));
  }, []);

  // Relative path hint for the new-item breadcrumb. When target is the
  // workspace root we show "./", otherwise the relative nested path.
  const targetBreadcrumb =
    !newItemTargetDir || newItemTargetDir === workingDirectory
      ? "./"
      : `./${newItemTargetDir.replace(workingDirectory, "").replace(/^[/\\]/, "")}/`;

  // The body (action row + new-item input + tree) is identical across
  // both variants. Only the outer chrome (resize handle, title bar,
  // pin / close) differs, so we build the body once and wrap it
  // depending on `variant` at the bottom of this function.
  const body = (
    <>
        {/* Body — Action icons row → (optional new-item input) →
            FileTree (which now hosts the search input on its own row).
            April 2026 layout fix:
              - The duplicate "文件" section title above the action bar
                was redundant with the panel header — removed.
              - New File / New Folder / Refresh now sit together on the
                left as one larger-icon group; previously refresh lived
                inside the FileTree's search row, fighting the input.
              - Search input gets its own dedicated row (in FileTree),
                no longer sharing horizontal space with refresh. */}
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {/* Action icons row. Left-aligned, single group so the user
              reads them as "the things I can do to this tree". Refresh
              dispatches the existing `refresh-file-tree` window event
              that FileTree already listens for (no state lift needed). */}
          <div className="flex shrink-0 items-center gap-0.5 px-2 pb-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => openNewItem("file")}
              disabled={!workingDirectory}
              title={t("fileTree.newMarkdown")}
              aria-label={t("fileTree.newMarkdown")}
            >
              <CodexWebIcon name="note" size="md" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => openNewItem("folder")}
              disabled={!workingDirectory}
              title={t("fileTree.newFolder")}
              aria-label={t("fileTree.newFolder")}
            >
              <CodexWebIcon name="folder_add" size="md" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => window.dispatchEvent(new Event("refresh-file-tree"))}
              disabled={!workingDirectory}
              title={t("fileTree.refresh")}
              aria-label={t("fileTree.refresh")}
            >
              <CodexWebIcon name="refresh" size="md" aria-hidden />
            </Button>
          </div>

          {/* Inline new-item input. Esc cancels, Enter submits. */}
          {newItemMode && (
            <div className="shrink-0 border-y border-border/40 bg-muted/30 px-3 py-2 space-y-1">
              <p className="truncate text-[10px] text-muted-foreground/60 font-mono">
                {targetBreadcrumb}
              </p>
              <div className="flex items-center gap-1.5">
                <Input
                  ref={newItemInputRef}
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (!creating) void handleCreateItem();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setNewItemMode(null);
                      setNewItemError(null);
                    }
                  }}
                  placeholder={newItemMode === "folder" ? "new-folder" : "untitled.md"}
                  className="h-7 text-xs font-mono"
                  disabled={creating}
                />
                <Button
                  size="xs"
                  onClick={() => void handleCreateItem()}
                  disabled={creating || !newItemName.trim()}
                >
                  {creating ? "…" : t("fileTree.createButton")}
                </Button>
              </div>
              {newItemError && (
                <p className="text-[11px] text-destructive">{newItemError}</p>
              )}
              <p className="text-[10px] text-muted-foreground/60">
                {t("fileTree.newFileHint")}
              </p>
            </div>
          )}

          {/* File tree. treeReloadKey bumps on every successful create
              so the directory scan reloads and the new file appears. */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <FileTree
              key={treeReloadKey}
              workingDirectory={workingDirectory}
              onFileSelect={handleFileSelect}
              onFileAdd={handleFileAdd}
              selectedFolderPath={selectedFolderPath ?? undefined}
              onSelectFolder={handleSelectFolder}
              selectedFilePath={previewFile ?? undefined}
              highlightPath={focusPath ?? highlightPath}
              highlightSeek={focusSeek?.toString() ?? highlightSeek}
            />
          </div>
        </div>
    </>
  );

  // sidebar variant: stripped chrome — Workspace Sidebar shell owns
  // the resize, title, and close affordances. We deliberately also
  // skip the Pin button because the Tab is *already pinned*.
  if (variant === 'sidebar') {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden">
        {body}
      </div>
    );
  }

  // legacy variant: inner content only. Phase 7c-D moved the
  // ResizeHandle + CardFrame + CardSurface to PanelZone, which now
  // owns the file-tree card chrome geometry. This component is just
  // the header (Files label + pin / close buttons) + body.
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("panel.files")}
        </span>
        <div className="flex items-center gap-0.5">
          {ws && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                // Close the lightweight panel and surface the same
                // tree as a Files Tab inside the Workspace Sidebar.
                // The Tab is closable; closing it doesn't bring the
                // lightweight panel back.
                ws.openTab({
                  id: 'files-pinned',
                  kind: 'files-pinned',
                  key: 'files',
                  title: t('panel.files' as TranslationKey),
                });
                setFileTreeOpen(false);
              }}
              title={t('workspaceSidebar.pinFiles' as TranslationKey)}
              aria-label={t('workspaceSidebar.pinFiles' as TranslationKey)}
            >
              <CodexWebIcon name="pin" size="sm" aria-hidden />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setFileTreeOpen(false)}
          >
            <X size={14} />
            <span className="sr-only">{t("panel.closePanel")}</span>
          </Button>
        </div>
      </div>
      {body}
    </div>
  );
}
