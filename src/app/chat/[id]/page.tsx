'use client';

import { useEffect, useState, useRef, use, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Message, ChatSession, PermissionProfile } from '@/types';
import { ChatView } from '@/components/chat/ChatView';
import { SpinnerGap } from "@/components/ui/icon";
import { usePanel } from '@/hooks/usePanel';
import { useWorkspaceSidebarOptional } from '@/hooks/useWorkspaceSidebar';
import { useTranslation } from '@/hooks/useTranslation';
import { useCompactViewport } from '@/hooks/useCompactViewport';
import { useAppServerActions, useAppServerSelector } from '@/codex-web/AppServerProvider';
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
import { latestInProgressTurnId } from '@/codex-web/resumed-turn-hydration';
import { readDefaultPanelPreference } from '@/lib/app-preferences';
import { threadRollbackToMessages } from '@/codex-web/thread-rollback';

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
  const connectionData = useAppServerSelector((state) => state.connection.data);
  const turnSnapshots = useAppServerSelector((state) => state.turnSnapshots);
  const crossClientUserMessagesByThreadId = useAppServerSelector((state) => state.crossClientUserMessagesByThreadId);
  const threadSettingsByThreadId = useAppServerSelector((state) => state.threadSettingsByThreadId);
  const activeTurnsByThreadId = useAppServerSelector((state) => state.activeTurnsByThreadId);
  const pendingApprovals = useAppServerSelector((state) => state.pendingApprovals);
  const goalsByThreadId = useAppServerSelector((state) => state.goalsByThreadId);
  const threadTokenUsageByThreadId = useAppServerSelector((state) => state.threadTokenUsageByThreadId);
  const latestCrossClientThreadRollback = useAppServerSelector((state) => state.latestCrossClientThreadRollback);
  const models = useAppServerSelector((state) => state.models);
  const {
    readThread,
    listThreadTurns,
    resumeThread,
    forkThread,
    sendOneTurn,
    sendTurnInThread,
    rollbackThread,
    interruptTurn,
    respondToServerRequest,
    setThreadGoal,
    clearThreadGoal,
    updateThreadPermissions,
    updateThreadModelSettings,
    publishCrossClientUserMessage,
  } = useAppServerActions();
  const ws = useWorkspaceSidebarOptional();
  const targetFilePath = searchParams.get('file') || undefined;
  const compactViewport = useCompactViewport();
  const { t } = useTranslation();
  const defaultPanelAppliedRef = useRef(false);
  const turnSnapshotsRef = useRef(turnSnapshots);
  const appServerSyncedUserMessages = useMemo(() => {
    const threadIds = resumedThreadId && resumedThreadId !== id ? [id, resumedThreadId] : [id];
    return threadIds.flatMap((threadId) => crossClientUserMessagesByThreadId[threadId] ?? []);
  }, [crossClientUserMessagesByThreadId, id, resumedThreadId]);

  useEffect(() => {
    turnSnapshotsRef.current = turnSnapshots;
  }, [turnSnapshots]);

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

    if (connectionData !== 'connected') {
      if (connectionData === 'failed') {
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
        const resumedLiveTurnId = latestInProgressTurnId(resume.thread.turns);
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
            threadTurnsPageToMessages(
              response.thread,
              turnsPage.data,
              "desc",
              turnSnapshotsRef.current,
              { omitAssistantTurnId: resumedLiveTurnId },
            ),
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
          const result = threadToMessages(fallbackThread, {
            omitAssistantTurnId: resumedLiveTurnId,
          });
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
  }, [connectionData, id, readThread, listThreadTurns, resumeThread, setWorkingDirectory, setSessionId, setPanelSessionTitle, t]);

  // Auto-open file tree when jumping from a file search result
  useEffect(() => {
    if (targetFilePath) {
      setFileTreeOpen(true);
    }
  }, [targetFilePath, setFileTreeOpen]);

  // 会话首次打开时应用当前浏览器的默认面板偏好。
  // sessionStorage 防止重复进入空会话时覆盖用户刚调整的布局。
  useEffect(() => {
    if (compactViewport === null) return;
    if (defaultPanelAppliedRef.current) return;
    defaultPanelAppliedRef.current = true;

    const storageKey = `codepilot:panel-init:${id}`;
    if (typeof window !== 'undefined' && sessionStorage.getItem(storageKey)) return;

    if (typeof window !== 'undefined') {
      sessionStorage.setItem(storageKey, '1');
    }

    if (targetFilePath) {
      setFileTreeOpen(true);
      return;
    }
    if (compactViewport && !targetFilePath) {
      setFileTreeOpen(false);
      if (ws) ws.setOpen(false);
      return;
    }

    const panel = readDefaultPanelPreference();
    if (panel === 'none') {
      setFileTreeOpen(false);
      if (ws) ws.setOpen(false);
    } else if (panel === 'file_tree') {
      setFileTreeOpen(true);
      if (ws) ws.setOpen(false);
    } else if (ws) {
      setFileTreeOpen(false);
      ws.setActiveTab('git');
    } else {
      setFileTreeOpen(true);
    }
    // Workspace Sidebar 的回调稳定，通过 ws 引用跟踪依赖即可。
  }, [compactViewport, id, targetFilePath, setFileTreeOpen, ws]);

  useEffect(() => {
    const threadId = resumedThreadId || id;
    const settings = threadSettingsByThreadId[threadId]?.data;
    if (!settings) return;
    setSessionModel(settings.model);
    setSessionEffort(settings.effort);
  }, [threadSettingsByThreadId, id, resumedThreadId]);

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

  const isAppServerThread = connectionData === 'connected';
  const messageApiBase = `/api/chat/sessions/${encodeURIComponent(id)}`;
  const currentThreadIds = [id, resumedThreadId];
  const activeAppServerTurn = selectActiveTurnByThreadIds(activeTurnsByThreadId, currentThreadIds);
  const otherActiveTurns = selectOtherRunningActiveTurns(activeTurnsByThreadId, currentThreadIds);
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
  const appServerRequest = isAppServerThread
    ? firstApproval(pendingApprovals, (approval) =>
        approvalRequestMatchesThread(approval, [id, resumedThreadId]),
      )
    : null;
  const appServerGoal =
    currentThreadIds
      .map((threadId) => (threadId ? goalsByThreadId[threadId] : null))
      .find((goal): goal is NonNullable<typeof goal> => !!goal) ?? null;
  const appServerTokenUsage =
    currentThreadIds
      .map((threadId) => (threadId ? threadTokenUsageByThreadId[threadId]?.data : null))
      .find((usage): usage is NonNullable<typeof usage> => !!usage) ?? null;
  const appServerRemoteRollback =
    latestCrossClientThreadRollback &&
    currentThreadIds.includes(latestCrossClientThreadRollback.threadId)
      ? latestCrossClientThreadRollback
      : null;
  const defaultAppServerModel =
    models?.data.data.find((model) => !model.hidden && model.isDefault)?.id ||
    models?.data.data.find((model) => !model.hidden)?.id ||
    '';
  const canResumeAppServerThread = isAppServerThread && !!sessionWorkingDirectory;
  const forkSourceMessageId = appServerThread?.forkedFromId
    ? [...messages].reverse().find((message) => message.role === 'assistant')?.id
    : undefined;
  const continuedFromHref = appServerThread?.forkedFromId
    ? `/chat/${encodeURIComponent(appServerThread.forkedFromId)}${forkSourceMessageId ? `#msg-${encodeURIComponent(forkSourceMessageId)}` : ''}`
    : undefined;

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
        appServerRequest={appServerRequest}
        appServerThreadId={resumedThreadId || id}
        appServerTokenUsage={appServerTokenUsage}
        appServerGoal={appServerGoal}
        appServerNotice={appServerNotice}
        appServerSyncedUserMessages={appServerSyncedUserMessages}
        appServerRemoteRollback={appServerRemoteRollback}
        onAppServerUserMessageAccepted={publishCrossClientUserMessage}
        continuedFromHref={continuedFromHref}
        onContinueInNewTask={connectionData === 'connected' ? async (lastTurnId) => {
          const response = await forkThread({ threadId: resumedThreadId || id, lastTurnId });
          router.push(`/chat/${encodeURIComponent(response.thread.id)}`);
        } : undefined}
        onAppServerRequestResponse={(input) =>
          appServerRequest
            ? respondToServerRequest(input, appServerRequest.requestId)
            : respondToServerRequest(input)
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
        appServerRollbackLastTurn={canResumeAppServerThread ? async () => {
          const threadId = resumedThreadId || id;
          const response = await rollbackThread({ threadId, numTurns: 1 });
          const rolledBackMessages = applyTurnSnapshotsToMessages(
            response.thread,
            threadRollbackToMessages(response.thread),
            turnSnapshotsRef.current,
          );
          setAppServerThread(response.thread);
          setMessages(rolledBackMessages);
          setLatestHistoryTurn(
            latestHistoryTurnFromPage(
              response.thread.turns,
              'asc',
              'app-server.thread/rollback',
            ),
          );
          setHasMore(false);
          setTurnsNextCursor(null);
          return rolledBackMessages;
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
