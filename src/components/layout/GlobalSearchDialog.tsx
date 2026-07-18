'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { usePanel } from '@/hooks/usePanel';
import { useAppServerActions, useAppServerState } from '@/codex-web/AppServerProvider';
import {
  buildGlobalFileSearchRoots,
  buildGlobalThreadSearchParams,
  fuzzyFileToGlobalSearchResult,
  threadToGlobalSearchSession,
  type GlobalSearchFile,
  type GlobalSearchSession,
} from '@/codex-web/global-search-adapter';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { ChatCircleText, NotePencil, Folder, File } from '@/components/ui/icon';
import type { IconComponent } from '@/types';
import type { TranslationKey } from '@/i18n';

interface SearchResults {
  sessions: GlobalSearchSession[];
  files: GlobalSearchFile[];
}

interface GlobalSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SearchScope = 'all' | 'sessions' | 'messages' | 'files';

const TYPE_ICONS: Record<string, IconComponent> = {
  sessions: ChatCircleText,
  files: Folder,
};

const TYPE_LABEL_KEYS: Record<Exclude<SearchScope, 'all'>, TranslationKey> = {
  sessions: 'globalSearch.sessions',
  messages: 'globalSearch.messages',
  files: 'globalSearch.files',
};

export function GlobalSearchDialog({ open, onOpenChange }: GlobalSearchDialogProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { workingDirectory, sessionId, sessionTitle } = usePanel();
  const appServerState = useAppServerState();
  const { listThreads, fuzzyFileSearch } = useAppServerActions();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [results, setResults] = useState<SearchResults>({ sessions: [], files: [] });
  const [compositionRevision, setCompositionRevision] = useState(0);
  const searchSequenceRef = useRef(0);
  const composingRef = useRef(false);
  const normalizedQuery = query.trim();
  const parsedQuery = useMemo<{ scope: SearchScope; term: string; prefix: string | null }>(() => {
    const trimmed = query.trim();
    const lower = trimmed.toLowerCase();

    const parsePrefix = (single: string, plural: string, scope: Exclude<SearchScope, 'all'>) => {
      if (lower.startsWith(`${single}:`)) {
        return { scope, term: trimmed.slice(single.length + 1).trim(), prefix: `${single}:` };
      }
      if (lower.startsWith(`${plural}:`)) {
        return { scope, term: trimmed.slice(plural.length + 1).trim(), prefix: `${single}:` };
      }
      return null;
    };

    return (
      parsePrefix('session', 'sessions', 'sessions') ??
      parsePrefix('message', 'messages', 'messages') ??
      parsePrefix('file', 'files', 'files') ??
      { scope: 'all', term: trimmed, prefix: null }
    );
  }, [query]);
  const searchTerm = parsedQuery.term;
  const activeScope = parsedQuery.scope;
  const activePrefix = parsedQuery.prefix;
  const searchesMessages = activeScope === 'all' || activeScope === 'messages';
  const knownThreads = useMemo(
    () => appServerState.threads?.data.data ?? [],
    [appServerState.threads],
  );
  const fileSearchRoots = useMemo(
    () => buildGlobalFileSearchRoots(workingDirectory, knownThreads),
    [knownThreads, workingDirectory],
  );
  const activeThread = useMemo(
    () => sessionId && workingDirectory
      ? { id: sessionId, title: sessionTitle || 'Codex 会话', cwd: workingDirectory }
      : null,
    [sessionId, sessionTitle, workingDirectory],
  );

  const performSearch = useCallback(async (term: string, scope: SearchScope) => {
    if (composingRef.current) return;
    searchSequenceRef.current += 1;
    const sequence = searchSequenceRef.current;
    if (!term) {
      setResults({ sessions: [], files: [] });
      setSearchFailed(false);
      setLoading(false);
      return;
    }

    const searchesSessions = scope === 'all' || scope === 'sessions';
    const searchesFiles = scope === 'all' || scope === 'files';
    if (!searchesSessions && !searchesFiles) {
      setResults({ sessions: [], files: [] });
      setSearchFailed(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setSearchFailed(false);

    const sessionRequest = searchesSessions
      ? listThreads(buildGlobalThreadSearchParams(term))
      : Promise.resolve(null);
    const fileRequest = searchesFiles && fileSearchRoots.length > 0
      ? fuzzyFileSearch({
          query: term,
          roots: fileSearchRoots,
          cancellationToken: 'global-search-dialog',
        })
      : Promise.resolve(null);
    const [sessionResult, fileResult] = await Promise.allSettled([sessionRequest, fileRequest]);
    if (sequence !== searchSequenceRef.current) return;

    setResults({
      sessions: sessionResult.status === 'fulfilled' && sessionResult.value
        ? sessionResult.value.data.map(threadToGlobalSearchSession)
        : [],
      files: fileResult.status === 'fulfilled' && fileResult.value
        ? fileResult.value.files
            .map((file) => fuzzyFileToGlobalSearchResult(file, knownThreads, activeThread))
            .filter((file): file is GlobalSearchFile => file !== null)
        : [],
    });
    setSearchFailed(sessionResult.status === 'rejected' || fileResult.status === 'rejected');
    setLoading(false);
  }, [activeThread, fileSearchRoots, fuzzyFileSearch, knownThreads, listThreads]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void performSearch(searchTerm, activeScope);
    }, 150);
    return () => clearTimeout(timer);
  }, [activeScope, compositionRevision, performSearch, searchTerm]);

  useEffect(() => {
    if (!open) {
      searchSequenceRef.current += 1;
      setQuery('');
      setResults({ sessions: [], files: [] });
      setSearchFailed(false);
      setLoading(false);
    }
  }, [open]);

  useEffect(() => () => {
    searchSequenceRef.current += 1;
  }, []);

  const handleSelect = useCallback(
    (item: GlobalSearchSession | GlobalSearchFile) => {
      onOpenChange(false);
      const qParam = query.trim() ? `&q=${encodeURIComponent(query.trim())}` : '';
      if (item.type === 'session') {
        router.push(`/chat/${item.id}`);
      } else {
        const seek = Date.now().toString(36);
        router.push(`/chat/${item.sessionId}?file=${encodeURIComponent(item.path)}&seek=${seek}${qParam}`);
      }
    },
    [router, onOpenChange, query],
  );

  const hasResults = results.sessions.length > 0 || results.files.length > 0;

  const renderGroup = (
    key: keyof SearchResults,
    items: (GlobalSearchSession | GlobalSearchFile)[],
  ) => {
    if (items.length === 0) return null;
    const Icon = TYPE_ICONS[key];
    return (
      <CommandGroup key={key} heading={t(TYPE_LABEL_KEYS[key])}>
        {items.map((item, idx) => (
          <CommandItem
            key={`${key}-${idx}`}
            value={`${key}-${idx}-${item.type === 'session' ? item.id : item.path}`}
            onSelect={() => handleSelect(item)}
            className="flex items-start gap-2 py-2"
          >
            {item.type === 'file' ? (
              item.nodeType === 'directory' ? (
                <Folder size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
              ) : (
                <File size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
              )
            ) : (
              <Icon size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              {item.type === 'session' && (
                <>
                  <p className="truncate text-sm max-w-[360px]">{item.title}</p>
                  {item.projectName && (
                    <p className="truncate text-xs text-muted-foreground max-w-[360px]">{item.projectName}</p>
                  )}
                </>
              )}
              {item.type === 'file' && (
                <>
                  <p className="truncate text-sm max-w-[360px]">{item.name}</p>
                  <p className="truncate text-xs text-muted-foreground max-w-[360px]">{item.sessionTitle}</p>
                </>
              )}
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
    );
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('globalSearch.title')}
      description={t('globalSearch.description')}
      className="sm:max-w-3xl h-[min(80vh,520px)] flex flex-col overflow-hidden"
      showCloseButton={false}
      shouldFilter={false}
    >
      <CommandInput
        placeholder={t('globalSearch.placeholder')}
        value={query}
        onValueChange={setQuery}
        className="h-12 shrink-0"
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={(e) => {
          composingRef.current = false;
          const value = (e.target as HTMLInputElement).value;
          setQuery(value);
          setCompositionRevision((current) => current + 1);
        }}
      />
      {normalizedQuery && activeScope !== 'all' && (
        <div className="flex items-center justify-between bg-primary/5 px-3 py-1.5 text-xs">
          <span className="inline-flex items-center gap-1.5 text-primary">
            <span className="size-1.5 rounded-full bg-primary" />
            {t('globalSearch.activeScope', { scope: t(TYPE_LABEL_KEYS[activeScope]) })}
          </span>
          <code className="rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary">
            {activePrefix}
          </code>
        </div>
      )}
      <CommandList className="flex-1 min-h-0 overflow-y-auto max-h-none">
        {!query && !loading && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <p>{t('globalSearch.hint')}</p>
            <p className="mt-1 text-xs">
              {t('globalSearch.hintPrefix')}{' '}
              <code className="rounded bg-muted px-1">session:</code>{' '}
              <code className="rounded bg-muted px-1">message:</code>{' '}
              <code className="rounded bg-muted px-1">file:</code>{' '}
              {t('globalSearch.toNarrowScope')}
            </p>
          </div>
        )}
        {normalizedQuery && !loading && !hasResults && activeScope !== 'messages' && !searchFailed && (
          <CommandEmpty>{t('globalSearch.noResults')}</CommandEmpty>
        )}
        {normalizedQuery && searchFailed && (
          <div className="px-4 py-3 text-sm text-destructive">{t('globalSearch.searchFailed')}</div>
        )}
        {normalizedQuery && renderGroup('sessions', results.sessions)}
        {normalizedQuery && searchesMessages && (
          <div className="flex items-start gap-2 border-y border-border/60 px-4 py-3 text-sm text-muted-foreground">
            <NotePencil size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-foreground">{t('globalSearch.messages')}</p>
              <p className="mt-0.5 text-xs">{t('globalSearch.messagesUnsupported')}</p>
            </div>
          </div>
        )}
        {normalizedQuery && activeScope === 'files' && fileSearchRoots.length === 0 && (
          <div className="px-4 py-3 text-sm text-muted-foreground">{t('globalSearch.noFileRoots')}</div>
        )}
        {normalizedQuery && renderGroup('files', results.files)}
        {loading && (
          <div className="py-4 text-center text-sm text-muted-foreground">{t('globalSearch.searching')}</div>
        )}
      </CommandList>
    </CommandDialog>
  );
}
