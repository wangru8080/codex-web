'use client';

import { useMemo, useState } from 'react';
import { MagnifyingGlass, X } from '@/components/ui/icon';
import { CodexWebIcon } from '@/components/ui/semantic-icon';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { cn } from '@/lib/utils';

interface NewChatProjectSelectorProps {
  currentProject: string;
  projects: readonly string[];
  onSelectProject: (path: string) => void;
  onClearProject: () => void;
  onCreateProject: () => void;
}

function projectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function NewChatProjectSelector({
  currentProject,
  projects,
  onSelectProject,
  onClearProject,
  onCreateProject,
}: NewChatProjectSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [clearHovered, setClearHovered] = useState(false);

  const uniqueProjects = useMemo(
    () => Array.from(new Set(projects.filter((path) => path.trim()))),
    [projects],
  );
  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return uniqueProjects;
    return uniqueProjects.filter((path) =>
      `${projectName(path)} ${path}`.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [query, uniqueProjects]);

  const openProjectPicker = () => setOpen(true);
  const handleSelect = (path: string) => {
    setOpen(false);
    setQuery('');
    onSelectProject(path);
  };
  const handleCreateProject = () => {
    setOpen(false);
    setQuery('');
    onCreateProject();
  };

  return (
    <div
      data-testid="new-chat-project-selector"
      data-current-project={currentProject || undefined}
      className="relative z-10 mx-7 mb-[-8px]"
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="flex min-h-10 items-center rounded-2xl bg-muted/70 px-3 text-sm">
            {currentProject ? (
              <>
                <button
                  type="button"
                  aria-label={t('newChat.projectSelector.clear' as TranslationKey)}
                  title={t('newChat.projectSelector.clear' as TranslationKey)}
                  className="group flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted-foreground/15 hover:text-foreground"
                  onClick={onClearProject}
                  onMouseEnter={() => setClearHovered(true)}
                  onMouseLeave={() => setClearHovered(false)}
                  onFocus={() => setClearHovered(true)}
                  onBlur={() => setClearHovered(false)}
                >
                  {clearHovered ? (
                    <X size={12} weight="bold" />
                  ) : (
                    <CodexWebIcon name="folder" size="sm" aria-hidden />
                  )}
                </button>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center rounded-lg py-1 text-left text-foreground hover:text-primary"
                  onClick={openProjectPicker}
                  aria-label={t('newChat.projectSelector.change' as TranslationKey)}
                >
                  <span className="truncate">{projectName(currentProject)}</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-muted-foreground hover:text-foreground"
                onClick={openProjectPicker}
              >
                <CodexWebIcon name="folder" size="sm" aria-hidden />
                <span>{t('newChat.projectSelector.select' as TranslationKey)}</span>
              </button>
            )}
          </div>
        </PopoverAnchor>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={6}
          className="w-72 gap-0 overflow-hidden rounded-2xl p-0"
        >
          <div className="flex h-10 items-center gap-2 border-b px-3">
            <MagnifyingGlass size={15} className="shrink-0 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('newChat.projectSelector.search' as TranslationKey)}
              className="h-8 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filteredProjects.length > 0 ? (
              filteredProjects.map((path) => {
                const selected = path === currentProject;
                return (
                  <button
                    key={path}
                    type="button"
                    data-project-path={path}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent',
                      selected && 'bg-accent/70 text-foreground',
                    )}
                    onClick={() => handleSelect(path)}
                  >
                    <CodexWebIcon name="folder" size="sm" className="shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{projectName(path)}</span>
                    <span className="max-w-28 truncate text-xs text-muted-foreground">{path}</span>
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {t('newChat.projectSelector.noResults' as TranslationKey)}
              </div>
            )}
          </div>
          <div className="border-t p-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent"
              onClick={handleCreateProject}
            >
              <CodexWebIcon name="folder_add" size="sm" className="text-muted-foreground" aria-hidden />
              <span>{t('newChat.projectSelector.newProject' as TranslationKey)}</span>
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
