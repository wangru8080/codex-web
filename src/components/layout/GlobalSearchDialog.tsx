'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { ChatCircleText, NotePencil, Folder, File, UserCircle, Sparkle, Wrench, CaretDown, CaretRight } from '@/components/ui/icon';
import type { IconComponent } from '@/types';
import type { TranslationKey } from '@/i18n';

interface SearchResultSession {
  type: 'session';
  id: string;
  title: string;
  projectName: string;
  updatedAt: string;
}

interface SearchResultMessage {
  type: 'message';
  sessionId: string;
  sessionTitle: string;
  messageId: string;
  role: 'user' | 'assistant';
  snippet: string;
  createdAt: string;
  contentType: 'user' | 'assistant' | 'tool';
}

interface SearchResultFile {
  type: 'file';
  sessionId: string;
  sessionTitle: string;
  path: string;
  name: string;
  nodeType: 'file' | 'directory';
}

interface SearchResponse {
  sessions: SearchResultSession[];
  messages: SearchResultMessage[];
  files: SearchResultFile[];
}

interface GlobalSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SearchScope = 'all' | 'sessions' | 'messages' | 'files';

const TYPE_ICONS: Record<string, IconComponent> = {
  sessions: ChatCircleText,
  messages: NotePencil,
  files: Folder,
};

const TYPE_LABEL_KEYS: Record<keyof SearchResponse, TranslationKey> = {
  sessions: 'globalSearch.sessions',
  messages: 'globalSearch.messages',
  files: 'globalSearch.files',
};

const CONTENT_TYPE_ICONS: Record<SearchResultMessage['contentType'], IconComponent> = {
  user: UserCircle,
  assistant: Sparkle,
  tool: Wrench,
};

export function GlobalSearchDialog({ open, onOpenChange }: GlobalSearchDialogProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResponse>({ sessions: [], messages: [], files: [] });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
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

  const performSearch = useCallback(async (q: string) => {
    if (composingRef.current) return;
    if (abortRef.current) {
      abortRef.current.abort();
    }
    if (!q.trim()) {
      abortRef.current = null;
      setResults({ sessions: [], messages: [], files: [] });
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Search failed');
      const data: SearchResponse = await res.json();
      if (!controller.signal.aborted) {
        setResults(data);
      }
    } catch {
      if (!controller.signal.aborted) {
        setResults({ sessions: [], messages: [], files: [] });
      }
    } finally {
      if (!controller.signal.aborted) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(query);
    }, 150);
    return () => clearTimeout(timer);
  }, [query, performSearch]);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setQuery('');
      setResults({ sessions: [], messages: [], files: [] });
      setCollapsedGroups(new Set());
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const toggleGroup = useCallback((sessionId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (item: SearchResultSession | SearchResultMessage | SearchResultFile) => {
      onOpenChange(false);
      const qParam = query.trim() ? `&q=${encodeURIComponent(query.trim())}` : '';
      if (item.type === 'session') {
        router.push(`/chat/${item.id}`);
      } else if (item.type === 'message') {
        router.push(`/chat/${item.sessionId}?message=${item.messageId}${qParam}`);
      } else if (item.type === 'file') {
        const seek = Date.now().toString(36);
        router.push(`/chat/${item.sessionId}?file=${encodeURIComponent(item.path)}&seek=${seek}${qParam}`);
      }
    },
    [router, onOpenChange, query],
  );

  const hasResults =
    results.sessions.length > 0 ||
    results.messages.length > 0 ||
    results.files.length > 0;

  const groupedMessages = useMemo(() => {
    const groups: Record<string, { sessionTitle: string; messages: SearchResultMessage[] }> = {};
    for (const msg of results.messages) {
      if (!groups[msg.sessionId]) {
        groups[msg.sessionId] = { sessionTitle: msg.sessionTitle, messages: [] };
      }
      groups[msg.sessionId].messages.push(msg);
    }
    return Object.values(groups);
  }, [results.messages]);

  const renderHighlightedSnippet = (snippet: string, searchTerm: string) => {
    if (!searchTerm) return <span>{snippet}</span>;
    const lowerSnippet = snippet.toLowerCase();
    const lowerTerm = searchTerm.toLowerCase();
    const idx = lowerSnippet.indexOf(lowerTerm);
    if (idx === -1) return <span>{snippet}</span>;
    return (
      <span>
        {snippet.slice(0, idx)}
        <mark className="rounded bg-primary/25 px-0.5 text-foreground">
          {snippet.slice(idx, idx + searchTerm.length)}
        </mark>
        {snippet.slice(idx + searchTerm.length)}
      </span>
    );
  };

  const renderGroup = (
    key: keyof SearchResponse,
    items: (SearchResultSession | SearchResultFile)[],
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
      title="Global Search"
      description="Search across sessions, messages, and files"
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
        {normalizedQuery && !loading && !hasResults && (
          <CommandEmpty>{t('globalSearch.noResults')}</CommandEmpty>
        )}
        {normalizedQuery && renderGroup('sessions', results.sessions)}

        {normalizedQuery && groupedMessages.map((group, groupIdx) => {
          const isCollapsed = collapsedGroups.has(group.messages[0]?.sessionId || `group-${groupIdx}`);
          const sessionId = group.messages[0]?.sessionId || `group-${groupIdx}`;
          return (
            <CommandGroup key={`msg-group-${groupIdx}`}>
              <CommandItem
                value={`message-group-${sessionId}`}
                onSelect={() => toggleGroup(sessionId)}
                className="flex w-full items-center gap-1.5 rounded bg-muted/40 px-1 py-1 text-left font-medium text-foreground"
                aria-expanded={!isCollapsed}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  {isCollapsed ? (
                    <CaretRight size={14} className="shrink-0 text-muted-foreground" />
                  ) : (
                    <CaretDown size={14} className="shrink-0 text-muted-foreground" />
                  )}
                  <NotePencil size={14} className="shrink-0 text-muted-foreground" />
                  <span className="truncate max-w-[280px]" title={group.sessionTitle.replace(/\n/g, ' ')}>
                    {group.sessionTitle.replace(/\n/g, ' ')}
                  </span>
                  <span className="ml-1 rounded-full bg-muted px-1.5 py-0 text-[10px] text-muted-foreground">
                    {group.messages.length}
                  </span>
                </div>
              </CommandItem>
              {!isCollapsed && group.messages.map((item, idx) => {
                const Icon = CONTENT_TYPE_ICONS[item.contentType];
                const labelKey: TranslationKey =
                  item.contentType === 'user'
                    ? 'messageList.userLabel'
                    : item.contentType === 'tool'
                      ? ('globalSearch.toolLabel' as TranslationKey)
                      : 'messageList.assistantLabel';
                return (
                  <CommandItem
                    key={`message-${groupIdx}-${idx}`}
                    value={`message-${groupIdx}-${idx}-${item.messageId}`}
                    onSelect={() => handleSelect(item)}
                    className="flex items-start gap-2 py-2"
                  >
                    <Icon size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{renderHighlightedSnippet(item.snippet, searchTerm)}</p>
                      <p className="truncate text-xs text-muted-foreground">{t(labelKey)}</p>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          );
        })}

        {normalizedQuery && renderGroup('files', results.files)}
        {loading && (
          <div className="py-4 text-center text-sm text-muted-foreground">{t('globalSearch.searching')}</div>
        )}
      </CommandList>
    </CommandDialog>
  );
}
