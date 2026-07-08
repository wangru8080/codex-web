"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { FileTreeNode } from "@/types";
import {
  FileTree as AIFileTree,
  FileTreeFolder,
  FileTreeFile,
} from "@/components/ai-elements/file-tree";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import type { ReactNode } from "react";

interface FileTreeProps {
  workingDirectory: string;
  onFileSelect: (path: string) => void;
  onFileAdd?: (path: string, nodeType: 'file' | 'directory') => void;
  /** Path of the currently-selected folder (for highlight + create target). */
  selectedFolderPath?: string;
  /** Called when the user clicks a folder row — selects the folder + toggles. */
  onSelectFolder?: (folderPath: string) => void;
  /** Path of the currently-selected file (for highlight). */
  selectedFilePath?: string;
  highlightPath?: string;
  highlightSeek?: string;
}

function getFileIcon(extension?: string): ReactNode {
  switch (extension) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "py":
    case "rb":
    case "rs":
    case "go":
    case "java":
    case "c":
    case "cpp":
    case "h":
    case "hpp":
    case "cs":
    case "swift":
    case "kt":
    case "dart":
    case "lua":
    case "php":
    case "zig":
      return <CodexWebIcon name="file_code" size="md" className="text-muted-foreground" aria-hidden />;
    case "json":
    case "yaml":
    case "yml":
    case "toml":
      return <CodexWebIcon name="code" size="md" className="text-muted-foreground" aria-hidden />;
    case "md":
    case "mdx":
    case "txt":
    case "csv":
      return <CodexWebIcon name="file" size="md" className="text-muted-foreground" aria-hidden />;
    default:
      return <CodexWebIcon name="file" size="md" className="text-muted-foreground" aria-hidden />;
  }
}

function containsMatch(node: FileTreeNode, query: string): boolean {
  const q = query.toLowerCase();
  if (node.name.toLowerCase().includes(q)) return true;
  if (node.children) {
    return node.children.some((child) => containsMatch(child, q));
  }
  return false;
}

function filterTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  if (!query) return nodes;
  return nodes
    .filter((node) => containsMatch(node, query))
    .map((node) => ({
      ...node,
      children: node.children ? filterTree(node.children, query) : undefined,
    }));
}

function RenderTreeNodes({ nodes, searchQuery, highlightPath }: { nodes: FileTreeNode[]; searchQuery: string; highlightPath?: string }) {
  const filtered = searchQuery ? filterTree(nodes, searchQuery) : nodes;

  return (
    <>
      {filtered.map((node) => {
        if (node.type === "directory") {
          const isHighlighted = node.path === highlightPath;
          return (
            <FileTreeFolder
              key={node.path}
              path={node.path}
              name={node.name}
              className={cn(isHighlighted && "file-tree-flash")}
              id={isHighlighted ? `file-tree-highlight` : undefined}
            >
              {node.children && (
                <RenderTreeNodes nodes={node.children} searchQuery={searchQuery} highlightPath={highlightPath} />
              )}
            </FileTreeFolder>
          );
        }
        const isHighlighted = node.path === highlightPath;
        return (
          <FileTreeFile
            key={node.path}
            path={node.path}
            name={node.name}
            icon={getFileIcon(node.extension)}
            className={cn(isHighlighted && "file-tree-flash")}
            id={isHighlighted ? `file-tree-highlight` : undefined}
          />
        );
      })}
    </>
  );
}

function getParentPaths(filePath: string): string[] {
  const parents: string[] = [];
  let current = filePath;
  while (true) {
    const parent = current.substring(0, current.lastIndexOf('/'));
    if (!parent || parent === current) break;
    parents.push(parent);
    current = parent;
  }
  return parents;
}

export function FileTree({ workingDirectory, onFileSelect, onFileAdd, selectedFolderPath, onSelectFolder, selectedFilePath, highlightPath, highlightSeek }: FileTreeProps) {
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const { t } = useTranslation();
  const seekKeyRef = useRef<string | null>(null);

  // Clear stale tree data when switching projects to avoid cross-session seek races.
  useEffect(() => {
    setTree([]);
    setError(null);
    seekKeyRef.current = null;
  }, [workingDirectory]);

  const fetchTree = useCallback(async () => {
    // Always cancel in-flight request first — even when clearing directory,
    // otherwise a stale response from the old project can arrive and repopulate the tree.
    if (abortRef.current) {
      abortRef.current.abort();
    }

    if (!workingDirectory) {
      abortRef.current = null;
      setTree([]);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/files?dir=${encodeURIComponent(workingDirectory)}&baseDir=${encodeURIComponent(workingDirectory)}&depth=4&_t=${Date.now()}`,
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      if (res.ok) {
        const data = await res.json();
        if (controller.signal.aborted) return;
        setTree(data.tree || []);
      } else {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        setTree([]);
        setError(errData.error || `Failed to load (${res.status})`);
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setTree([]);
      setError('Failed to load file tree');
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [workingDirectory]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  // Auto-refresh when AI finishes streaming
  useEffect(() => {
    const handler = () => fetchTree();
    window.addEventListener('refresh-file-tree', handler);
    return () => window.removeEventListener('refresh-file-tree', handler);
  }, [fetchTree]);

  // Controlled expansion state for search-driven highlighting
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // Sync expanded paths when highlightPath changes
  useEffect(() => {
    if (highlightPath) {
      const next = new Set<string>();
      for (const parent of getParentPaths(highlightPath)) {
        next.add(parent);
      }
      next.add(highlightPath);
      setExpandedPaths(next);
    } else {
      setExpandedPaths(new Set());
    }
  }, [highlightPath, highlightSeek]);

  // Scroll to and flash highlighted file from search results.
  // Guarded by seekKeyRef so tree auto-refreshes don't re-trigger the scroll.
  useEffect(() => {
    if (!workingDirectory || !highlightPath || tree.length === 0) return;
    const seekTargetKey = `${workingDirectory}::${highlightPath}::${highlightSeek || ''}`;
    if (seekKeyRef.current === seekTargetKey) return;

    let attempts = 0;
    const maxAttempts = 15;
    const interval = setInterval(() => {
      attempts++;
      const el = document.getElementById('file-tree-highlight');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        seekKeyRef.current = seekTargetKey;
        clearInterval(interval);
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [workingDirectory, highlightPath, highlightSeek, tree]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Search row — full-width, dedicated. The Refresh button used to
          live here on the right; it moved up to the action icons row in
          FileTreePanel, which now dispatches `filetree-refresh` window
          events that the effect below catches. */}
      <div className="px-3 pb-2 shrink-0">
        <div className="relative">
          <CodexWebIcon name="search" size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden />
          <Input
            placeholder={t('fileTree.filterFiles')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-auto">
        {loading && tree.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <CodexWebIcon name="refresh" size="md" className="animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : tree.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {error ? error : workingDirectory ? t('fileTree.noFiles') : t('fileTree.selectFolder')}
          </p>
        ) : (
          <AIFileTree
            expanded={expandedPaths}
            onExpandedChange={setExpandedPaths}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI Elements FileTree onSelect type conflicts with HTMLAttributes.onSelect
            onSelect={onFileSelect as any}
            onAdd={onFileAdd}
            addLabel={t('fileTree.addToChat' as TranslationKey)}
            selectedPath={selectedFilePath}
            selectedFolderPath={selectedFolderPath}
            onSelectFolder={onSelectFolder}
            className="border-0 rounded-none"
          >
            <RenderTreeNodes nodes={tree} searchQuery={searchQuery} highlightPath={highlightPath} />
          </AIFileTree>
        )}
      </div>
    </div>
  );
}
