"use client";

/**
 * PanelZone — light right-rail container.
 *
 * Mounts the independent FileTreePanel. The file tree is a high-frequency
 * deterministic tool, kept out of the Workspace Sidebar so a quick file lookup
 * doesn't drag the user into the full Tab shell.
 *
 * The Git / Widget / Markdown / Artifact / file-preview surfaces all
 * live inside `<WorkspaceSidebar>` as fixed or dynamic Tabs and never
 * render here.
 *
 * v13 — FileTreePanel and the Workspace Sidebar are additive: both
 * can be open simultaneously and the chat area shrinks accordingly.
 * Each topbar toggle (UnifiedTopBar) flips its own panel only, with
 * no auto-close of the other. Earlier rounds (and v11) treated them
 * as mutually exclusive; that direction was reversed after the user
 * pointed out the actual product wish was coexistence — see the
 * Phase 3 archive's v13 entry for the full rationale.
 *
 * Phase 7c-D — width state for the file tree moved up here from
 * FileTreePanel so PanelZone can pass it to the new CardFrame's
 * `width` prop and pair it with a ResizeHandle sibling. FileTreePanel
 * now renders only the inner content (header + body).
 */

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { usePanel } from "@/hooks/usePanel";
import { CardFrame, CardSurface, ResizeGutter } from "./card-primitives";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

const FileTreePanel = dynamic(
  () => import("./panels/FileTreePanel").then((m) => ({ default: m.FileTreePanel })),
  { ssr: false },
);

const TREE_MIN_WIDTH = 220;
const TREE_MAX_WIDTH = 500;
const TREE_DEFAULT_WIDTH = 280;

export function PanelZone({ compactViewport }: { compactViewport: boolean }) {
  const { fileTreeOpen, setFileTreeOpen } = usePanel();
  const [treeWidth, setTreeWidth] = useState(TREE_DEFAULT_WIDTH);

  const handleTreeResize = useCallback((delta: number) => {
    // Dragging right on a right-rail handle → narrower tree, so subtract.
    setTreeWidth((w) => Math.min(TREE_MAX_WIDTH, Math.max(TREE_MIN_WIDTH, w - delta)));
  }, []);

  if (!fileTreeOpen) return null;

  if (compactViewport) {
    return (
      <Sheet open onOpenChange={setFileTreeOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-[min(92vw,420px)] max-w-none gap-0 p-0"
        >
          <SheetTitle className="sr-only">Files</SheetTitle>
          <SheetDescription className="sr-only">
            在移动端显示当前工作区的文件树。
          </SheetDescription>
          <CardSurface kind="fileTree">
            <FileTreePanel />
          </CardSurface>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <>
      {fileTreeOpen && (
        <>
          <ResizeGutter
            onResize={handleTreeResize}
            onReset={() => setTreeWidth(TREE_DEFAULT_WIDTH)}
          />
          <CardFrame kind="fileTree" width={treeWidth}>
            <CardSurface kind="fileTree">
              <FileTreePanel />
            </CardSurface>
          </CardFrame>
        </>
      )}
    </>
  );
}
