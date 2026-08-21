'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  initialState,
  openDynamicTab as pureOpen,
  closeTab as pureClose,
  setActiveTab as pureSetActive,
  setOpen as pureSetOpen,
  setWidth as pureSetWidth,
  parse,
  serialize,
  storageKey,
  createSideChatTab,
  WORKSPACE_HOME_TAB_ID,
  tabFromPreviewSource,
  type DynamicTab,
  type WorkspaceSidebarState,
} from '@/lib/workspace-sidebar';
import type { PreviewSource } from '@/hooks/usePanel';
import { useAppServerActions } from '@/codex-web/AppServerProvider';

/**
 * Window event other parts of the app dispatch to ask the sidebar to
 * open or focus a Tab for a given PreviewSource. Lets AppShell /
 * MessageItem / FileTreePanel stay decoupled from the sidebar's
 * imperative API while still routing previews through it.
 */
export const WORKSPACE_TAB_OPEN_EVENT = 'workspace-tab-open-request';

export interface WorkspaceTabOpenDetail {
  source: PreviewSource;
}

interface WorkspaceSidebarContextValue {
  state: WorkspaceSidebarState;
  openTab: (tab: DynamicTab) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setOpen: (open: boolean) => void;
  setWidth: (width: number) => void;
  sideChats: Record<string, SideChatState>;
  openSideChat: (title: string) => void;
  retrySideChat: (id: string) => void;
  closeSideChat: (id: string) => Promise<void>;
}

export interface SideChatState {
  parentThreadId: string;
  threadId: string | null;
  status: 'creating' | 'ready' | 'error';
  error: string | null;
}

export const WorkspaceSidebarContext = createContext<WorkspaceSidebarContextValue | null>(null);

interface ProviderProps {
  workingDirectory: string;
  sessionId: string;
  children: React.ReactNode;
}

/**
 * Provider for the right-side Workspace Sidebar. Persists the
 * (open, width, activeTabId, dynamicTabs) tuple to localStorage
 * keyed by `workspace::cwd::sessionId`, so two projects (or two
 * sessions in the same project) don't share Tab lists.
 *
 * SSR safety: localStorage isn't read until after mount, so the
 * server and the client's first paint both see `initialState()`
 * (closed, fixed Tabs only). The persisted state then hydrates in
 * a follow-up effect — this matches React's "don't read browser
 * state during render" rule and avoids hydration mismatches.
 */
export function WorkspaceSidebarProvider({ workingDirectory, sessionId, children }: ProviderProps) {
  const key = storageKey(workingDirectory, sessionId);
  const [state, setState] = useState<WorkspaceSidebarState>(() => initialState());
  const [sideChats, setSideChats] = useState<Record<string, SideChatState>>({});
  const sideChatsRef = useRef<Record<string, SideChatState>>({});
  const sideChatOrdinalRef = useRef(0);
  const sideChatOperationSequenceRef = useRef(0);
  const sideChatOperationsRef = useRef<Map<string, number>>(new Map());
  const { startSideChat, unsubscribeThread, interruptTurn } = useAppServerActions();

  const storeSideChat = useCallback((id: string, sideChat: SideChatState) => {
    const next = { ...sideChatsRef.current, [id]: sideChat };
    sideChatsRef.current = next;
    setSideChats(next);
  }, []);

  const removeSideChat = useCallback((id: string) => {
    const { [id]: _removed, ...next } = sideChatsRef.current;
    sideChatsRef.current = next;
    setSideChats(next);
  }, []);

  // Hydrate from storage when the scope (workspace + session) changes.
  // Without this, switching chats inside the same workspace would keep
  // the previous chat's dynamic Tabs around.
  useEffect(() => {
    sideChatsRef.current = {};
    setSideChats({});
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
      setState(parse(raw));
    } catch {
      setState(initialState());
    }
  }, [key]);

  // Persist on every change. JSON.stringify is cheap relative to user
  // interaction frequency; the alternative (debounce) would let an
  // accidental refresh lose the latest Tab.
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(serialize(state)));
    } catch {
      // Quota / disabled storage: ignore. The in-memory state still works.
    }
  }, [key, state]);

  const openTab = useCallback((tab: DynamicTab) => {
    setState((prev) => pureOpen(prev, tab));
  }, []);

  // Bridge: callers who only know about PreviewSource (AppShell's
  // setPreviewSource, the file-tree click path, the DiffSummary card)
  // dispatch a window event; we translate it into an openTab call so
  // they don't need to import this hook directly.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<WorkspaceTabOpenDetail>).detail;
      if (!detail || !detail.source) return;
      try {
        const tab = tabFromPreviewSource(detail.source);
        setState((prev) => pureOpen(prev, tab));
      } catch {
        // Defensive — a malformed source should never break the chat.
      }
    };
    window.addEventListener(WORKSPACE_TAB_OPEN_EVENT, handler);
    return () => window.removeEventListener(WORKSPACE_TAB_OPEN_EVENT, handler);
  }, []);

  const closeTab = useCallback((id: string) => {
    setState((prev) => pureClose(prev, id));
  }, []);
  const setActiveTab = useCallback((id: string) => {
    setState((prev) => pureSetActive(prev, id));
  }, []);
  const setOpen = useCallback((open: boolean) => {
    setState((prev) => {
      const next = pureSetOpen(prev, open);
      if (open && !prev.open) {
        return { ...next, activeTabId: WORKSPACE_HOME_TAB_ID };
      }
      return next;
    });
  }, []);
  const setWidth = useCallback((width: number) => {
    setState((prev) => pureSetWidth(prev, width));
  }, []);

  const startSideChatForTab = useCallback((id: string) => {
    const operationId = ++sideChatOperationSequenceRef.current;
    sideChatOperationsRef.current.set(id, operationId);
    if (!sessionId) {
      storeSideChat(id, { parentThreadId: '', threadId: null, status: 'error', error: '请先发送一条消息，再打开侧边聊天。' });
      return;
    }
    const creating: SideChatState = { parentThreadId: sessionId, threadId: null, status: 'creating', error: null };
    storeSideChat(id, creating);
    void startSideChat(sessionId)
      .then((response) => {
        if (sideChatOperationsRef.current.get(id) !== operationId) {
          void unsubscribeThread(response.thread.id).catch(() => undefined);
          return;
        }
        const ready: SideChatState = {
          parentThreadId: sessionId,
          threadId: response.thread.id,
          status: 'ready',
          error: null,
        };
        storeSideChat(id, ready);
      })
      .catch((error) => {
        if (sideChatOperationsRef.current.get(id) !== operationId) return;
        const failed: SideChatState = {
          parentThreadId: sessionId,
          threadId: null,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
        storeSideChat(id, failed);
      });
  }, [sessionId, startSideChat, storeSideChat, unsubscribeThread]);

  const openSideChat = useCallback((title: string) => {
    const tab = createSideChatTab(title, ++sideChatOrdinalRef.current);
    setState((prev) => pureOpen(prev, tab));
    startSideChatForTab(tab.id);
  }, [startSideChatForTab]);

  const retrySideChat = useCallback((id: string) => {
    if (!sideChatsRef.current[id]) return;
    startSideChatForTab(id);
  }, [startSideChatForTab]);

  const closeSideChat = useCallback(async (id: string) => {
    const current = sideChatsRef.current[id];
    sideChatOperationsRef.current.delete(id);
    if (current?.threadId) {
      await interruptTurn({ threadId: current.threadId });
      await unsubscribeThread(current.threadId);
    }
    removeSideChat(id);
    setState((prev) => pureClose(prev, id));
  }, [interruptTurn, removeSideChat, unsubscribeThread]);

  // 切换主会话或关闭应用壳时，临时侧聊不应继续占用 app-server 订阅。
  useEffect(() => () => {
    sideChatOperationsRef.current.clear();
    for (const sideChat of Object.values(sideChatsRef.current)) {
      if (sideChat.threadId) void unsubscribeThread(sideChat.threadId).catch(() => undefined);
    }
    sideChatsRef.current = {};
  }, [key, unsubscribeThread]);

  const value = useMemo(
    () => ({ state, openTab, closeTab, setActiveTab, setOpen, setWidth, sideChats, openSideChat, retrySideChat, closeSideChat }),
    [state, openTab, closeTab, setActiveTab, setOpen, setWidth, sideChats, openSideChat, retrySideChat, closeSideChat],
  );

  return (
    <WorkspaceSidebarContext.Provider value={value}>
      {children}
    </WorkspaceSidebarContext.Provider>
  );
}

export function useWorkspaceSidebar(): WorkspaceSidebarContextValue {
  const ctx = useContext(WorkspaceSidebarContext);
  if (!ctx) {
    throw new Error('useWorkspaceSidebar must be used inside <WorkspaceSidebarProvider>');
  }
  return ctx;
}

/**
 * Optional variant that returns null when no provider is mounted.
 * Useful for components that may render either inside the chat shell
 * (provider present) or in older surfaces that haven't been migrated.
 */
export function useWorkspaceSidebarOptional(): WorkspaceSidebarContextValue | null {
  return useContext(WorkspaceSidebarContext);
}
