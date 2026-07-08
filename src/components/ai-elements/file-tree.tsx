"use client";

import type { HTMLAttributes, ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { CaretRight } from "@phosphor-icons/react";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

interface FileTreeContextType {
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  /**
   * Add affordance — invoked from the per-row hover "+" button. The
   * nodeType lets the consumer route file vs. directory adds to
   * different downstream pipelines (file → attachment, directory →
   * mention chip).
   */
  onAdd?: (path: string, nodeType: 'file' | 'directory') => void;
  /** Localised label used by the "+" button's `title` and `aria-label`. */
  addLabel?: string;
  /**
   * Separate selected-folder channel from selectedPath so folder and file
   * selection can coexist without one stomping the other. Folder
   * selection is what drives the "create in this folder" default target.
   */
  selectedFolderPath?: string;
  onSelectFolder?: (folderPath: string) => void;
}

// Module-scope immutable empty Set. Inlining `new Set()` as a destructuring
// default parameter (e.g. `defaultExpanded = new Set()`) triggered a production
// ReferenceError under Next.js 16 + Turbopack in v0.50.2 (Sentry NEXT-PA).
const EMPTY_EXPANDED: Set<string> = new Set();

// Default noop for context default value
// oxlint-disable-next-line eslint(no-empty-function)
const noop = () => {};

const FileTreeContext = createContext<FileTreeContextType>({
  // oxlint-disable-next-line eslint-plugin-unicorn(no-new-builtin)
  expandedPaths: new Set(),
  togglePath: noop,
});

export type FileTreeProps = HTMLAttributes<HTMLDivElement> & {
  expanded?: Set<string>;
  defaultExpanded?: Set<string>;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  onAdd?: (path: string, nodeType: 'file' | 'directory') => void;
  /** Localised label for per-row "+" buttons. */
  addLabel?: string;
  selectedFolderPath?: string;
  onSelectFolder?: (folderPath: string) => void;
  onExpandedChange?: (expanded: Set<string>) => void;
};

export const FileTree = ({
  expanded: controlledExpanded,
  defaultExpanded = EMPTY_EXPANDED,
  selectedPath,
  onSelect,
  onAdd,
  addLabel,
  selectedFolderPath,
  onSelectFolder,
  onExpandedChange,
  className,
  children,
  ...props
}: FileTreeProps) => {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const expandedPaths = controlledExpanded ?? internalExpanded;

  const togglePath = useCallback(
    (path: string) => {
      const newExpanded = new Set(expandedPaths);
      if (newExpanded.has(path)) {
        newExpanded.delete(path);
      } else {
        newExpanded.add(path);
      }
      setInternalExpanded(newExpanded);
      onExpandedChange?.(newExpanded);
    },
    [expandedPaths, onExpandedChange]
  );

  const contextValue = useMemo(
    () => ({ expandedPaths, onAdd, addLabel, onSelect, selectedPath, togglePath, selectedFolderPath, onSelectFolder }),
    [expandedPaths, onAdd, addLabel, onSelect, selectedPath, togglePath, selectedFolderPath, onSelectFolder]
  );

  return (
    <FileTreeContext.Provider value={contextValue}>
      <div
        className={cn(
          "rounded-lg border bg-background font-mono text-sm",
          className
        )}
        role="tree"
        {...props}
      >
        <div className="p-2">{children}</div>
      </div>
    </FileTreeContext.Provider>
  );
};

interface FileTreeFolderContextType {
  path: string;
  name: string;
  isExpanded: boolean;
}

const FileTreeFolderContext = createContext<FileTreeFolderContextType>({
  isExpanded: false,
  name: "",
  path: "",
});

export type FileTreeFolderProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  name: string;
};

export const FileTreeFolder = ({
  path,
  name,
  className,
  children,
  ...props
}: FileTreeFolderProps) => {
  const { expandedPaths, togglePath, selectedFolderPath, onSelectFolder, onAdd, addLabel } =
    useContext(FileTreeContext);
  const isExpanded = expandedPaths.has(path);
  const isSelected = selectedFolderPath === path;

  const handleToggle = useCallback(() => {
    togglePath(path);
    // Clicking a folder row both toggles expand/collapse and marks it
    // selected — matches VS Code's Explorer behavior. Selection drives
    // the "create inside this folder" default target in the panel's
    // new-item flow.
    onSelectFolder?.(path);
  }, [togglePath, onSelectFolder, path]);

  const handleAddFolder = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onAdd?.(path, 'directory');
    },
    [onAdd, path],
  );

  const folderContextValue = useMemo(
    () => ({ isExpanded, name, path }),
    [isExpanded, name, path]
  );

  return (
    <FileTreeFolderContext.Provider value={folderContextValue}>
      <Collapsible onOpenChange={handleToggle} open={isExpanded}>
        <div
          className={cn("", className)}
          role="treeitem"
          {...props}
        >
          <CollapsibleTrigger asChild>
            <div
              className={cn(
                "group/folder flex w-full cursor-pointer items-center gap-1 rounded px-2 py-1 text-left transition-colors hover:bg-muted/50",
                isSelected && "bg-muted",
              )}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleToggle();
                }
              }}
            >
              <span className="shrink-0 rounded p-0.5">
                <CaretRight
                  size={16}
                  className={cn(
                    "text-muted-foreground transition-transform",
                    isExpanded && "rotate-90"
                  )}
                />
              </span>
              <FileTreeIcon>
                {isExpanded ? (
                  <CodexWebIcon name="folder_open" size="md" className="text-muted-foreground" aria-hidden />
                ) : (
                  <CodexWebIcon name="folder" size="md" className="text-muted-foreground" aria-hidden />
                )}
              </FileTreeIcon>
              <FileTreeName>{name}</FileTreeName>
              {onAdd && (
                <button
                  type="button"
                  className="ml-auto flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted group-hover/folder:opacity-100 focus-visible:opacity-100"
                  onClick={handleAddFolder}
                  title={addLabel ?? 'Add to chat'}
                  aria-label={addLabel ?? 'Add to chat'}
                >
                  <CodexWebIcon name="plus" size={12} className="text-muted-foreground" aria-hidden />
                </button>
              )}
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="ml-4 border-l pl-2">{children}</div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </FileTreeFolderContext.Provider>
  );
};

interface FileTreeFileContextType {
  path: string;
  name: string;
}

const FileTreeFileContext = createContext<FileTreeFileContextType>({
  name: "",
  path: "",
});

export type FileTreeFileProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  name: string;
  icon?: ReactNode;
};

export const FileTreeFile = ({
  path,
  name,
  icon,
  className,
  children,
  ...props
}: FileTreeFileProps) => {
  const { selectedPath, onSelect, onAdd, addLabel } = useContext(FileTreeContext);
  const isSelected = selectedPath === path;

  const handleClick = useCallback(() => {
    onSelect?.(path);
  }, [onSelect, path]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        onSelect?.(path);
      }
    },
    [onSelect, path]
  );

  const handleAdd = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onAdd?.(path, 'file');
    },
    [onAdd, path]
  );

  const fileContextValue = useMemo(() => ({ name, path }), [name, path]);

  return (
    <FileTreeFileContext.Provider value={fileContextValue}>
      <div
        className={cn(
          "group/file flex cursor-pointer items-center gap-1 rounded px-2 py-1 transition-colors hover:bg-muted/50",
          isSelected && "bg-muted",
          className
        )}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="treeitem"
        tabIndex={0}
        {...props}
      >
        {children ?? (
          <>
            <FileTreeIcon>
              {icon ?? <CodexWebIcon name="file" size="md" className="text-muted-foreground" aria-hidden />}
            </FileTreeIcon>
            <FileTreeName>{name}</FileTreeName>
            {onAdd && (
              <button
                type="button"
                className="ml-auto flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted group-hover/file:opacity-100 focus-visible:opacity-100"
                onClick={handleAdd}
                title={addLabel ?? 'Add to chat'}
                aria-label={addLabel ?? 'Add to chat'}
              >
                <CodexWebIcon name="plus" size={12} className="text-muted-foreground" aria-hidden />
              </button>
            )}
          </>
        )}
      </div>
    </FileTreeFileContext.Provider>
  );
};

export type FileTreeIconProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeIcon = ({
  className,
  children,
  ...props
}: FileTreeIconProps) => (
  <span className={cn("shrink-0", className)} {...props}>
    {children}
  </span>
);

export type FileTreeNameProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeName = ({
  className,
  children,
  ...props
}: FileTreeNameProps) => (
  <span className={cn("truncate", className)} {...props}>
    {children}
  </span>
);

export type FileTreeActionsProps = HTMLAttributes<HTMLDivElement>;

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

export const FileTreeActions = ({
  className,
  children,
  ...props
}: FileTreeActionsProps) => (
  // biome-ignore lint/a11y/noNoninteractiveElementInteractions: stopPropagation required for nested interactions
  // biome-ignore lint/a11y/useSemanticElements: fieldset doesn't fit this UI pattern
  <div
    className={cn("ml-auto flex items-center gap-1", className)}
    onClick={stopPropagation}
    onKeyDown={stopPropagation}
    role="group"
    {...props}
  >
    {children}
  </div>
);
