'use client';

import { useEffect, useState, useRef, use } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Message, ChatSession, PermissionProfile } from '@/types';
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
import {
  selectActiveTurnByThreadIds,
  selectOtherRunningActiveTurns,
} from '@/codex-web/active-turns-adapter';
import { approvalRequestMatchesThread, firstApproval } from '@/codex-web/approval-queue-adapter';
import {
  historyPaginationFailureNotice,
  preserveMessagesAfterPaginationFailure,
} from '@/codex-web/history-pagination-state';
import { resolveHistoryTurnTarget } from '@/codex-web/history-turn-routing';
import { threadToChatSession, threadToMessages } from '@/codex-web/thread-history-adapter';
import {
  applyTurnSnapshotsToMessages,
  latestHistoryTurnFromPage,
  mergeThreadTurnMessages,
  threadTurnsPageToMessages,
} from '@/codex-web/thread-turns-page-adapter';
import type { Thread } from '@/codex/protocol/generated/v2/Thread';
import type { ReasoningEffort } from '@/codex/protocol/generated/ReasoningEffort';
import { modelSettingsFromResume } from '@/codex-web/thread-model-settings';

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
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionModel, setSessionModel] = useState<string>('');
  const [sessionEffort, setSessionEffort] = useState<ReasoningEffort | null>(null);
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
  const {
    readThread,
    listThreadTurns,
    resumeThread,
    sendOneTurn,
    sendTurnInThread,
    interruptTurn,
    respondToApproval,
    setThreadGoal,
    clearThreadGoal,
    updateThreadPermissions,
    updateThreadModelSettings,
  } = useAppServerActions();
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
    setSessionEffort(null);
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

    if (appServerState.connection.data !== 'connected') {
      if (appServerState.connection.data === 'failed') {
        setError('Codex app-server connection failed');
        setSessionInfoLoaded(true);
        setLoading(false);
      }
      return () => { cancelled = true; };
    }

    async function loadSessionAndMessages() {
      try {
        const response = await readThread(id, { includeTurns: false });
        if (cancelled) return;
        setAppServerThread(response.thread);
        const session = threadToChatSession(response.thread);
        applySession(session);
        const resume = await resumeThread({ threadId: id });
        if (cancelled) return;
        const resumedSettings = modelSettingsFromResume(resume);
        setResumedThreadId(resume.thread.id);
        setResumedCwd(resume.cwd);
        setResumedModel(resumedSettings.model);
        setSessionModel(resumedSettings.model);
        setSessionEffort(resumedSettings.effort);
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
          setPaginationNotice(historyPaginationFailureNotice(pageError));
          if (result.unsupportedItemCount > 0) {
            console.info(`Phase 5A 暂未渲染 ${result.unsupportedItemCount} 个历史工具 item`);
          }
        }
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
  }, [appServerState.connection.data, id, readThread, listThreadTurns, resumeThread, setWorkingDirectory, setSessionId, setPanelSessionTitle, t]);

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

  useEffect(() => {
    const threadId = resumedThreadId || id;
    const settings = appServerState.threadSettingsByThreadId[threadId]?.data;
    if (!settings) return;
    setSessionModel(settings.model);
    setSessionEffort(settings.effort);
  }, [appServerState.threadSettingsByThreadId, id, resumedThreadId]);

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
  const currentThreadIds = [id, resumedThreadId];
  const activeAppServerTurn = selectActiveTurnByThreadIds(appServerState.activeTurnsByThreadId, currentThreadIds);
  const otherActiveTurns = selectOtherRunningActiveTurns(appServerState.activeTurnsByThreadId, currentThreadIds);
  const activeTurnVisibility = isAppServerThread
    ? selectVisibleActiveTurn({
        activeTurn: activeAppServerTurn,
        otherActiveTurns,
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
  const appServerGoal =
    currentThreadIds
      .map((threadId) => (threadId ? appServerState.goalsByThreadId[threadId] : null))
      .find((goal): goal is NonNullable<typeof goal> => !!goal) ?? null;
  const appServerTokenUsage =
    currentThreadIds
      .map((threadId) => (threadId ? appServerState.threadTokenUsageByThreadId[threadId]?.data : null))
      .find((usage): usage is NonNullable<typeof usage> => !!usage) ?? null;
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
        initialEffort={sessionEffort}
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
        appServerThreadId={resumedThreadId || id}
        appServerTokenUsage={appServerTokenUsage}
        appServerGoal={appServerGoal}
        appServerNotice={appServerNotice}
        onAppServerApprovalDecision={(decision) =>
          appServerApproval ? respondToApproval(decision, appServerApproval.requestId) : respondToApproval(decision)
        }
        onAppServerPermissionChange={canResumeAppServerThread ? async (permissionProfile) => {
          let threadId = resumedThreadId;
          let threadCwd = resumedCwd || sessionWorkingDirectory;
          if (!threadId) {
            const resume = await resumeThread({
              threadId: id,
              cwd: threadCwd,
              model: resumedModel || sessionModel || defaultAppServerModel,
              permissionProfile: sessionPermissionProfile,
            });
            threadId = resume.thread.id;
            threadCwd = resume.cwd || threadCwd;
            setResumedThreadId(threadId);
            setResumedCwd(threadCwd);
            setResumedModel(resume.model || sessionModel || defaultAppServerModel);
          }
          await updateThreadPermissions({
            threadId,
            cwd: threadCwd,
            permissionProfile,
          });
        } : undefined}
        onAppServerModelChange={canResumeAppServerThread ? async (model) => {
          await updateThreadModelSettings({
            threadId: resumedThreadId || id,
            model,
          });
        } : undefined}
        onAppServerEffortChange={canResumeAppServerThread ? async (effort) => {
          await updateThreadModelSettings({
            threadId: resumedThreadId || id,
            effort,
          });
        } : undefined}
        onAppServerGoalSet={canResumeAppServerThread ? async (objective) => {
          await setThreadGoal({
            threadId: resumedThreadId || id,
            objective,
            status: 'active',
          });
        } : undefined}
        onAppServerGoalStatusChange={appServerGoal ? async (status) => {
          await setThreadGoal({ threadId: appServerGoal.data.threadId, status });
        } : undefined}
        onAppServerGoalEdit={appServerGoal ? async (objective, status, tokenBudget) => {
          await setThreadGoal({
            threadId: appServerGoal.data.threadId,
            objective,
            status,
            tokenBudget,
          });
        } : undefined}
        onAppServerGoalClear={appServerGoal ? async () => {
          await clearThreadGoal(appServerGoal.data.threadId);
        } : undefined}
        appServerInterrupt={appServerTurn ? async () => {
          await interruptTurn({
            threadId: appServerTurn.threadId || resumedThreadId || id,
            turnId: appServerTurn.turnId,
          });
        } : undefined}
        appServerSend={canResumeAppServerThread ? async ({ content, files, cwd, model, effort, mode, permissionProfile, onAccepted }) => {
          const target = resolveHistoryTurnTarget({
            routeThreadId: id,
            resumedThreadId,
            requestedCwd: cwd,
            routeCwd: sessionWorkingDirectory,
            resumedCwd,
            requestedModel: model,
            routeModel: sessionModel,
            resumedModel,
            defaultModel: defaultAppServerModel,
          });
          let threadId = target.threadId;
          let turnCwd = target.cwd;
          let turnModel = target.model;

          if (target.requiresResume) {
            const resume = await resumeThread({
              threadId,
              cwd: turnCwd,
              model: turnModel,
              permissionProfile,
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
            files,
            cwd: turnCwd,
            model: turnModel,
            effort,
            mode,
            permissionProfile,
            onAccepted,
          });
        } : undefined}
        appServerClearContextAndSend={canResumeAppServerThread ? async (content, effort) => {
          const acceptedTurn = await sendOneTurn({
            content,
            cwd: resumedCwd || sessionWorkingDirectory,
            model: resumedModel || sessionModel || defaultAppServerModel,
            effort,
            permissionProfile: sessionPermissionProfile,
          });
          if (acceptedTurn.threadId) {
            router.push(`/chat/${encodeURIComponent(acceptedTurn.threadId)}`);
          }
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
            const failure = preserveMessagesAfterPaginationFailure(messages, pageError);
            setHasMore(failure.hasMore);
            setTurnsNextCursor(failure.nextCursor);
            setPaginationNotice(failure.notice);
            return { messages: failure.messages, hasMore: failure.hasMore };
          }
        } : undefined}
      />
    </div>
  );
}
