'use client';

import { useEffect, useState, useRef, use } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Message, MessagesResponse, ChatSession, PermissionProfile } from '@/types';
import { ChatView } from '@/components/chat/ChatView';
import { SpinnerGap } from "@/components/ui/icon";
import { usePanel } from '@/hooks/usePanel';
import { useWorkspaceSidebarOptional } from '@/hooks/useWorkspaceSidebar';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppServerActions, useAppServerState } from '@/codex-web/AppServerProvider';
import {
  selectVisibleActiveTurn,
  type LatestHistoryTurn,
} from '@/codex-web/active-turn-visibility-adapter';
import { approvalRequestMatchesThread, firstApproval } from '@/codex-web/approval-queue-adapter';
import { threadToChatSession, threadToMessages } from '@/codex-web/thread-history-adapter';
import {
  applyTurnSnapshotsToMessages,
  latestHistoryTurnFromPage,
  mergeThreadTurnMessages,
  threadTurnsPageToMessages,
} from '@/codex-web/thread-turns-page-adapter';
import type { Thread } from '@/codex/protocol/generated/v2/Thread';

function safeDecodeSessionId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

interface ChatSessionPageProps {
  params: Promise<{ id: string }>;
}

export default function ChatSessionPage({ params }: ChatSessionPageProps) {
  const rawParams = use(params);
  const id = safeDecodeSessionId(rawParams.id);
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionModel, setSessionModel] = useState<string>('');
  const [sessionProviderId, setSessionProviderId] = useState<string>('');
  // Phase 2 Step 3b: session's runtime pin (chat-runtime label form).
  // '' = follow global; 'claude_code' / 'codepilot_runtime' = pinned.
  // Threaded into ChatView so the picker filters per-session, not per
  // global agent_runtime.
  const [sessionRuntimePin, setSessionRuntimePin] = useState<string>('');
  const [sessionInfoLoaded, setSessionInfoLoaded] = useState(false);
  const [sessionPermissionProfile, setSessionPermissionProfile] = useState<PermissionProfile>('request_approval');
  const [sessionMode, setSessionMode] = useState<'code' | 'plan'>('code');
  const [sessionHasSummary, setSessionHasSummary] = useState(false);
  const [sessionReadOnly, setSessionReadOnly] = useState(false);
  const [sessionWorkingDirectory, setSessionWorkingDirectory] = useState('');
  const [sessionProjectName, setSessionProjectName] = useState('');
  const [resumedThreadId, setResumedThreadId] = useState<string | null>(null);
  const [resumedModel, setResumedModel] = useState<string>('');
  const [resumedCwd, setResumedCwd] = useState<string>('');
  const [appServerThread, setAppServerThread] = useState<Thread | null>(null);
  const [turnsNextCursor, setTurnsNextCursor] = useState<string | null>(null);
  const [latestHistoryTurn, setLatestHistoryTurn] = useState<LatestHistoryTurn | null>(null);
  const [paginationNotice, setPaginationNotice] = useState<{ message: string; description?: string } | null>(null);
  const { setWorkingDirectory, setSessionId, setSessionTitle: setPanelSessionTitle, setFileTreeOpen } = usePanel();
  const appServerState = useAppServerState();
  const { readThread, listThreadTurns, resumeThread, sendTurnInThread, interruptTurn, respondToApproval } = useAppServerActions();
  const ws = useWorkspaceSidebarOptional();
  const targetFilePath = searchParams.get('file') || undefined;
  const { t } = useTranslation();
  const defaultPanelAppliedRef = useRef(false);
  const turnSnapshotsRef = useRef(appServerState.turnSnapshots);

  useEffect(() => {
    turnSnapshotsRef.current = appServerState.turnSnapshots;
  }, [appServerState.turnSnapshots]);

  useEffect(() => {
    // Reset state when switching sessions
    defaultPanelAppliedRef.current = false;
    setLoading(true);
    setError(null);
    setMessages([]);
    setHasMore(false);
    setWorkingDirectory('');
    setSessionModel('');
    setSessionProviderId('');
    setSessionRuntimePin('');
    setSessionReadOnly(false);
    setSessionWorkingDirectory('');
    setSessionProjectName('');
    setResumedThreadId(null);
    setResumedModel('');
    setResumedCwd('');
    setAppServerThread(null);
    setTurnsNextCursor(null);
    setLatestHistoryTurn(null);
    setPaginationNotice(null);
    setSessionInfoLoaded(false);

    let cancelled = false;

    async function loadSessionAndMessages() {
      try {
        const encodedId = encodeURIComponent(id);
        if (appServerState.connection.data === 'connected') {
          const response = await readThread(id, { includeTurns: false });
          if (cancelled) return;
          setAppServerThread(response.thread);
          const session = threadToChatSession(response.thread);
          applySession(session);
          try {
            const turnsPage = await listThreadTurns({
              threadId: id,
              cursor: null,
              limit: 30,
              sortDirection: "desc",
              itemsView: "full",
            });
            if (cancelled) return;
            setMessages(
              threadTurnsPageToMessages(response.thread, turnsPage.data, "desc", turnSnapshotsRef.current),
            );
            setLatestHistoryTurn(
              latestHistoryTurnFromPage(
                turnsPage.data,
                "desc",
                "app-server.thread/turns/list",
              ),
            );
            setHasMore(!!turnsPage.nextCursor);
            setTurnsNextCursor(turnsPage.nextCursor);
          } catch (pageError) {
            if (cancelled) return;
            let fallbackThread = response.thread;
            try {
              const fallbackResponse = await readThread(id, { includeTurns: true });
              if (cancelled) return;
              fallbackThread = fallbackResponse.thread;
              setAppServerThread(fallbackThread);
            } catch {
              // 保留 metadata-only thread；错误 banner 会说明分页失败。
            }
            const result = threadToMessages(fallbackThread);
            const snapshotMessages = applyTurnSnapshotsToMessages(
              fallbackThread,
              result.messages,
              turnSnapshotsRef.current,
            );
            setLatestHistoryTurn(
              latestHistoryTurnFromPage(
                fallbackThread.turns,
                "asc",
                "app-server.thread/read",
              ),
            );
            setMessages(snapshotMessages);
            setHasMore(false);
            setTurnsNextCursor(null);
            setPaginationNotice({
              message: "历史分页暂不可用",
              description:
                pageError instanceof Error ? pageError.message : String(pageError),
            });
            if (result.unsupportedItemCount > 0) {
              console.info(`Phase 5A 暂未渲染 ${result.unsupportedItemCount} 个历史工具 item`);
            }
          }
          return;
        }

        const sessionRes = await fetch(`/api/chat/sessions/${encodedId}`);
        if (cancelled) return;
        if (sessionRes.ok) {
          const data: { session: ChatSession } = await sessionRes.json();
          if (cancelled) return;
          applySession(data.session);
          const { resolveSessionModel } = await import('@/lib/resolve-session-model');
          if (cancelled) return;
          const resolved = await resolveSessionModel(data.session.model || '', data.session.provider_id || '');
          if (cancelled) return;
          setSessionModel(resolved.model);
          setSessionProviderId(resolved.providerId);
          setSessionRuntimePin(data.session.runtime_pin || '');
          setSessionPermissionProfile(data.session.permission_profile || 'request_approval');
          setSessionMode((data.session.mode as 'code' | 'plan') || 'code');
          setSessionHasSummary(!!data.session.context_summary);
          setSessionReadOnly(!!data.session.read_only);
        }

        const messageUrl = `/api/chat/sessions/${encodedId}/messages?limit=30`;
        const res = await fetch(messageUrl);
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 404) {
            setError('Session not found');
            return;
          }
          throw new Error('Failed to load messages');
        }
        const data: MessagesResponse = await res.json();
        if (cancelled) return;
        setMessages(data.messages);
        setHasMore(data.hasMore ?? false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load messages');
      } finally {
        if (!cancelled) {
          setSessionInfoLoaded(true);
          setLoading(false);
        }
      }
    }

    function applySession(session: ChatSession) {
      if (session.working_directory) {
        setSessionWorkingDirectory(session.working_directory);
        setWorkingDirectory(session.working_directory);
        localStorage.setItem("codepilot:last-working-directory", session.working_directory);
        window.dispatchEvent(new Event('refresh-file-tree'));
      }
      setSessionProjectName(session.project_name || '');
      setSessionId(id);
      setPanelSessionTitle(session.title || t('chat.newConversation'));
      setSessionProviderId(session.provider_id || '');
      setSessionRuntimePin(session.runtime_pin || '');
      setSessionPermissionProfile(session.permission_profile || 'request_approval');
      setSessionMode((session.mode as 'code' | 'plan') || 'code');
      setSessionHasSummary(!!session.context_summary);
      setSessionReadOnly(!!session.read_only);
      setSessionInfoLoaded(true);
    }

    loadSessionAndMessages();

    return () => { cancelled = true; };
  }, [appServerState.connection.data, id, readThread, listThreadTurns, setWorkingDirectory, setSessionId, setPanelSessionTitle, t]);

  // Auto-open file tree when jumping from a file search result
  useEffect(() => {
    if (targetFilePath) {
      setFileTreeOpen(true);
    }
  }, [targetFilePath, setFileTreeOpen]);

  // Auto-open default panel the first time a session is ever opened.
  // Uses sessionStorage to track which sessions have already been initialized,
  // so re-opening an untouched (zero-message) session won't override the layout.
  useEffect(() => {
    if (defaultPanelAppliedRef.current) return;
    defaultPanelAppliedRef.current = true;

    const storageKey = `codepilot:panel-init:${id}`;
    if (typeof window !== 'undefined' && sessionStorage.getItem(storageKey)) return;

    if (typeof window !== 'undefined') {
      sessionStorage.setItem(storageKey, '1');
    }

    (async () => {
      try {
        if (targetFilePath) {
          // Preserve explicit deep-link intent from global search —
          // file tree opens lightweight; sidebar stays as the user
          // last left it (they're independent inputs per Phase 2).
          setFileTreeOpen(true);
          return;
        }
        const res = await fetch('/api/settings/app');
        if (!res.ok) return;
        const data = await res.json();
        const panel = data.settings?.default_panel || 'file_tree';
        // Phase 2 (2026-04-30) migration: 'git' and 'dashboard'
        // defaults used to flip dedicated PanelZone panels — those
        // panels were folded into the Workspace Sidebar as fixed Tabs.
        // Translate the legacy setting into "open the sidebar with
        // that Tab active". 'file_tree' still opens the lightweight
        // panel; 'none' opens nothing. Mutual exclusion (sidebar vs
        // file tree) is enforced as side-effect: opening one path
        // means we don't open the other.
        if (panel === 'none') {
          setFileTreeOpen(false);
          if (ws) ws.setOpen(false);
        } else if (panel === 'file_tree') {
          setFileTreeOpen(true);
          if (ws) ws.setOpen(false);
        } else if (panel === 'git' && ws) {
          setFileTreeOpen(false);
          ws.setActiveTab('git');  // setActiveTab also flips open=true
        } else if (panel === 'dashboard' && ws) {
          setFileTreeOpen(false);
          ws.setActiveTab('widget');
        } else {
          // Unknown setting or sidebar provider missing → safe default.
          setFileTreeOpen(true);
        }
      } catch {
        setFileTreeOpen(true);
      }
    })();
    // ws.setActiveTab / ws.setOpen are stable callbacks from the
    // provider; intentionally tracked via the `ws` reference identity
    // rather than the inner functions to avoid noisy re-runs on every
    // sidebar state change. (deps are complete — no suppression needed.)
  }, [id, targetFilePath, setFileTreeOpen, ws]);

  if (loading || !sessionInfoLoaded) {
    return (
      <div className="flex h-full items-center justify-center">
        <SpinnerGap size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-destructive font-medium">{error}</p>
          <Link href="/chat" className="text-sm text-muted-foreground hover:underline">
            Start a new chat
          </Link>
        </div>
      </div>
    );
  }

  const isAppServerThread = appServerState.connection.data === 'connected';
  const messageApiBase = `/api/chat/sessions/${encodeURIComponent(id)}`;
  const activeAppServerTurn = appServerState.activeTurn?.data ?? null;
  const activeTurnVisibility = isAppServerThread
    ? selectVisibleActiveTurn({
        activeTurn: activeAppServerTurn,
        routeThreadId: id,
        resumedThreadId,
        thread: appServerThread,
        latestHistoryTurn,
      })
    : { visibleTurn: null, notice: null };
  const appServerTurn = activeTurnVisibility.visibleTurn;
  const appServerNotice = activeTurnVisibility.notice ?? paginationNotice;
  const appServerApproval = isAppServerThread
    ? firstApproval(appServerState.pendingApprovals, (approval) =>
        approvalRequestMatchesThread(approval, [id, resumedThreadId]),
      )
    : null;
  const defaultAppServerModel =
    appServerState.models?.data.data.find((model) => !model.hidden && model.isDefault)?.id ||
    appServerState.models?.data.data.find((model) => !model.hidden)?.id ||
    '';
  const canResumeAppServerThread = isAppServerThread && !!sessionWorkingDirectory;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatView
        key={id}
        sessionId={id}
        initialMessages={messages}
        initialHasMore={hasMore}
        modelName={sessionModel}
        providerId={sessionProviderId}
        runtimePin={sessionRuntimePin}
        initialPermissionProfile={sessionPermissionProfile}
        initialMode={sessionMode}
        initialHasSummary={sessionHasSummary}
        readOnly={!isAppServerThread && sessionReadOnly}
        readOnlyReason="这是只读历史会话，当前版本不能继续发送。"
        messageApiBase={messageApiBase}
        workingDirectory={sessionWorkingDirectory}
        projectName={sessionProjectName}
        appServerTurn={appServerTurn}
        appServerApproval={appServerApproval}
        appServerNotice={appServerNotice}
        onAppServerApprovalDecision={(decision) =>
          appServerApproval ? respondToApproval(decision, appServerApproval.requestId) : respondToApproval(decision)
        }
        appServerInterrupt={appServerTurn ? async () => {
          await interruptTurn({
            threadId: appServerTurn.threadId || resumedThreadId || id,
            turnId: appServerTurn.turnId,
          });
        } : undefined}
        appServerSend={canResumeAppServerThread ? async ({ content, cwd, model, onAccepted }) => {
          const nextModel = resumedModel || model || sessionModel || defaultAppServerModel;
          let threadId = resumedThreadId;
          let turnCwd = resumedCwd || cwd || sessionWorkingDirectory;
          let turnModel = nextModel;

          if (!threadId) {
            const resume = await resumeThread({
              threadId: id,
              cwd: turnCwd,
              model: nextModel,
            });
            threadId = resume.thread.id;
            turnCwd = resume.cwd || turnCwd;
            turnModel = resume.model || turnModel;
            setResumedThreadId(threadId);
            setResumedCwd(turnCwd);
            setResumedModel(turnModel);
            setSessionModel(turnModel);
          }

          return sendTurnInThread({
            threadId,
            content,
            cwd: turnCwd,
            model: turnModel,
            onAccepted,
          });
        } : undefined}
        appServerLoadEarlier={isAppServerThread && appServerThread && turnsNextCursor ? async () => {
          try {
            const turnsPage = await listThreadTurns({
              threadId: appServerThread.id,
              cursor: turnsNextCursor,
              limit: 30,
              sortDirection: "desc",
              itemsView: "full",
            });
            const incoming = threadTurnsPageToMessages(
              appServerThread,
              turnsPage.data,
              "desc",
              turnSnapshotsRef.current,
            );
            const mergedMessages = mergeThreadTurnMessages(messages, incoming, "prepend");
            setMessages(mergedMessages);
            setHasMore(!!turnsPage.nextCursor);
            setTurnsNextCursor(turnsPage.nextCursor);
            setPaginationNotice(null);
            return { messages: mergedMessages, hasMore: !!turnsPage.nextCursor };
          } catch (pageError) {
            setHasMore(false);
            setTurnsNextCursor(null);
            setPaginationNotice({
              message: "历史分页暂不可用",
              description: pageError instanceof Error ? pageError.message : String(pageError),
            });
            return { messages, hasMore: false };
          }
        } : undefined}
      />
    </div>
  );
}
