'use client';

import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { Folder, FolderOpen, ArrowRight, ArrowUUpLeft, SpinnerGap } from "@/components/ui/icon";
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAppServerActions } from '@/codex-web/AppServerProvider';
import { resolveCodexBridgeHomeDirectory } from '@/codex-web/bridge-url-runtime';
import {
  directoryChildren,
  directoryCompletionQuery,
  directoryParent,
  matchingDirectories,
} from '@/codex-web/directory-browser-adapter';
import { useTranslation } from '@/hooks/useTranslation';

interface FolderEntry {
  name: string;
  path: string;
}

interface FolderPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

export function FolderPicker({ open, onOpenChange, onSelect, initialPath }: FolderPickerProps) {
  const { t } = useTranslation();
  const { readDirectory } = useAppServerActions();
  const [currentDir, setCurrentDir] = useState('');
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [directories, setDirectories] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [drives, setDrives] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<FolderEntry[]>([]);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionLoading, setCompletionLoading] = useState(false);
  const [completionResolved, setCompletionResolved] = useState(false);
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(0);
  const completionRequestRef = useRef(0);
  const completionListId = useId();

  const browse = useCallback(async (dir?: string) => {
    const target = dir?.trim() || '/';
    completionRequestRef.current += 1;
    setCompletionOpen(false);
    setCompletionLoading(false);
    setCompletionResolved(false);
    setSuggestions([]);
    setLoading(true);
    setError('');
    try {
      const response = await readDirectory(target);
      setCurrentDir(target);
      setParentDir(directoryParent(target));
      setDirectories(directoryChildren(target, response.entries));
      setPathInput(target);
      setDrives([]);
    } catch (browseError) {
      setDirectories([]);
      setError(browseError instanceof Error ? browseError.message : String(browseError));
    } finally {
      setLoading(false);
    }
  }, [readDirectory]);

  useEffect(() => {
    const input = pathInput.trim();
    if (!open || !completionOpen || !input || input === currentDir) {
      setCompletionLoading(false);
      setCompletionResolved(false);
      setSuggestions([]);
      return;
    }

    const requestId = completionRequestRef.current + 1;
    completionRequestRef.current = requestId;
    setCompletionLoading(true);
    setCompletionResolved(false);

    const timer = window.setTimeout(async () => {
      const fallbackDirectory = currentDir || initialPath || '/';
      const query = directoryCompletionQuery(input, fallbackDirectory);
      try {
        const response = await readDirectory(query.parentPath);
        if (completionRequestRef.current !== requestId) return;
        setSuggestions(matchingDirectories(input, fallbackDirectory, response.entries).slice(0, 8));
      } catch {
        if (completionRequestRef.current !== requestId) return;
        setSuggestions([]);
      } finally {
        if (completionRequestRef.current === requestId) {
          setCompletionLoading(false);
          setCompletionResolved(true);
        }
      }
    }, 200);

    return () => window.clearTimeout(timer);
  }, [completionOpen, currentDir, initialPath, open, pathInput, readDirectory]);

  useEffect(() => {
    if (!open) return;

    let disposed = false;
    const openInitialDirectory = async () => {
      let target = initialPath?.trim();
      if (!target) {
        try {
          target = await resolveCodexBridgeHomeDirectory();
        } catch {
          target = '/';
        }
      }
      if (!disposed) browse(target);
    };
    void openInitialDirectory();

    return () => {
      disposed = true;
    };
  }, [open, initialPath, browse]);

  const handleNavigate = (dir: string) => {
    browse(dir);
  };

  const handleGoUp = () => {
    if (parentDir) browse(parentDir);
  };

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const suggestion = suggestions[highlightedSuggestion];
    if (completionOpen && suggestion) {
      browse(suggestion.path);
      return;
    }
    if (pathInput.trim()) {
      browse(pathInput.trim());
    }
  };

  const handlePathKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!completionOpen || suggestions.length === 0) {
      if (event.key === 'Escape') setCompletionOpen(false);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedSuggestion((current) => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedSuggestion((current) => (current - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const path = suggestions[highlightedSuggestion].path;
      const separator = path.includes('\\') && !path.includes('/') ? '\\' : '/';
      setPathInput(path.endsWith(separator) ? path : `${path}${separator}`);
      setHighlightedSuggestion(0);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setCompletionOpen(false);
    }
  };

  const handleSelect = () => {
    if (!currentDir) return;
    onSelect(currentDir);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t('folderPicker.title')}</DialogTitle>
        </DialogHeader>

        {/* Path input */}
        <form onSubmit={handlePathSubmit} className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleGoUp}
                disabled={!parentDir}
                aria-label={t('folderPicker.goUp')}
                className="shrink-0 text-muted-foreground"
              >
                <ArrowUUpLeft size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('folderPicker.goUp')}</TooltipContent>
          </Tooltip>
          <div className="relative min-w-0 flex-1">
            <Input
              value={pathInput}
              onChange={(e) => {
                setPathInput(e.target.value);
                setCompletionOpen(true);
                setCompletionResolved(false);
                setHighlightedSuggestion(0);
              }}
              onFocus={() => setCompletionOpen(true)}
              onBlur={() => setCompletionOpen(false)}
              onKeyDown={handlePathKeyDown}
              placeholder="/path/to/project"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={completionOpen && (completionLoading || completionResolved)}
              aria-controls={completionListId}
              aria-activedescendant={suggestions[highlightedSuggestion]
                ? `${completionListId}-${highlightedSuggestion}`
                : undefined}
              className="font-mono text-sm"
            />
            {completionOpen && pathInput.trim() !== currentDir && (completionLoading || completionResolved) && (
              <div
                id={completionListId}
                role="listbox"
                className="absolute inset-x-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
              >
                {completionLoading ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                    <SpinnerGap size={16} className="animate-spin" />
                    {t('folderPicker.loading')}
                  </div>
                ) : suggestions.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    {t('folderPicker.noMatches')}
                  </div>
                ) : suggestions.map((directory, index) => (
                  <button
                    key={directory.path}
                    id={`${completionListId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === highlightedSuggestion}
                    className={`flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm ${
                      index === highlightedSuggestion ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
                    }`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setHighlightedSuggestion(index)}
                    onClick={() => browse(directory.path)}
                  >
                    <Folder size={16} className="shrink-0 text-primary" />
                    <span className="truncate font-mono">{directory.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </form>

        {/* Directory browser */}
        <div className="rounded-md border border-border">
          {/* Current path + go up + drive switcher */}
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
            {drives.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-6 px-1.5 text-xs font-mono shrink-0">
                    {currentDir.charAt(0).toUpperCase()}:
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {drives.map((drive) => {
                    const letter = drive.charAt(0).toUpperCase();
                    const isCurrent = currentDir.toUpperCase().startsWith(letter + ':');
                    return (
                      <DropdownMenuItem
                        key={drive}
                        className="font-mono text-sm gap-2"
                        onClick={() => browse(drive)}
                      >
                        <span className={isCurrent ? 'font-bold' : ''}>{letter}:</span>
                        <span className="text-muted-foreground text-xs">{drive}</span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <span className="min-w-0 overflow-x-auto whitespace-nowrap text-xs font-mono text-muted-foreground">
              {currentDir}
            </span>
          </div>

          {/* Folder list */}
          <ScrollArea className="h-64">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                {t('folderPicker.loading')}
              </div>
            ) : directories.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                {t('folderPicker.noSubdirs')}
              </div>
            ) : (
              <div className="p-1">
                {directories.map((dir) => (
                  <Button
                    key={dir.path}
                    variant="ghost"
                    className="flex w-full items-center gap-2 justify-start px-3 py-1.5 text-sm text-left h-auto"
                    onClick={() => handleNavigate(dir.path)}
                  >
                    <Folder size={16} className="shrink-0 text-primary" />
                    <span className="truncate">{dir.name}</span>
                    <ArrowRight size={12} className="ml-auto shrink-0 text-muted-foreground" />
                  </Button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('folderPicker.cancel')}
          </Button>
          <Button onClick={handleSelect} disabled={!currentDir || loading || !!error} className="gap-2">
            <FolderOpen size={16} />
            {t('folderPicker.select')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
