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
  sideChat: SideChatState | null;
  openSideChat: (title: string) => void;
  closeSideChat: () => Promise<void>;
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
  const [sideChat, setSideChat] = useState<SideChatState | null>(null);
  const sideChatRef = useRef<SideChatState | null>(null);
  const sideChatOperationRef = useRef(0);
  const { startSideChat, unsubscribeThread, interruptTurn } = useAppServerActions();

  useEffect(() => {
    sideChatRef.current = sideChat;
  }, [sideChat]);

  // Hydrate from storage when the scope (workspace + session) changes.
  // Without this, switching chats inside the same workspace would keep
  // the previous chat's dynamic Tabs around.
  useEffect(() => {
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

  const openSideChat = useCallback((title: string) => {
    setState((prev) => pureOpen(prev, {
      id: 'side-chat',
      kind: 'side-chat',
      key: 'side-chat',
      title,
    }));
    if (!sessionId) {
      setSideChat({ parentThreadId: '', threadId: null, status: 'error', error: '请先发送一条消息，再打开侧边聊天。' });
      return;
    }
    const current = sideChatRef.current;
    if (current?.parentThreadId === sessionId && current.status !== 'error') return;

    const operationId = ++sideChatOperationRef.current;
    const creating: SideChatState = { parentThreadId: sessionId, threadId: null, status: 'creating', error: null };
    sideChatRef.current = creating;
    setSideChat(creating);
    void startSideChat(sessionId)
      .then((response) => {
        if (sideChatOperationRef.current !== operationId) {
          void unsubscribeThread(response.thread.id).catch(() => undefined);
          return;
        }
        const ready: SideChatState = {
          parentThreadId: sessionId,
          threadId: response.thread.id,
          status: 'ready',
          error: null,
        };
        sideChatRef.current = ready;
        setSideChat(ready);
      })
      .catch((error) => {
        if (sideChatOperationRef.current !== operationId) return;
        const failed: SideChatState = {
          parentThreadId: sessionId,
          threadId: null,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
        sideChatRef.current = failed;
        setSideChat(failed);
      });
  }, [sessionId, startSideChat, unsubscribeThread]);

  const closeSideChat = useCallback(async () => {
    const current = sideChatRef.current;
    ++sideChatOperationRef.current;
    if (current?.threadId) {
      await interruptTurn({ threadId: current.threadId });
      await unsubscribeThread(current.threadId);
    }
    sideChatRef.current = null;
    setSideChat(null);
    setState((prev) => pureClose(prev, 'side-chat'));
  }, [interruptTurn, unsubscribeThread]);

  // 切换主会话或关闭应用壳时，临时侧聊不应继续占用 app-server 订阅。
  useEffect(() => () => {
    ++sideChatOperationRef.current;
    const threadId = sideChatRef.current?.threadId;
    if (threadId) void unsubscribeThread(threadId).catch(() => undefined);
    sideChatRef.current = null;
  }, [key, unsubscribeThread]);

  const value = useMemo(
    () => ({ state, openTab, closeTab, setActiveTab, setOpen, setWidth, sideChat, openSideChat, closeSideChat }),
    [state, openTab, closeTab, setActiveTab, setOpen, setWidth, sideChat, openSideChat, closeSideChat],
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
