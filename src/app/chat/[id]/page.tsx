'use client';

import { useEffect, useState, useRef, use, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Message, ChatSession, PermissionProfile } from '@/types';
import { ChatView } from '@/components/chat/ChatView';
import { MessageList } from '@/components/chat/MessageList';
import { SpinnerGap } from "@/components/ui/icon";
import { ErrorBanner } from '@/components/ui/error-banner';
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
  isUnsupportedTurnsListError,
  preserveMessagesAfterPaginationFailure,
} from '@/codex-web/history-pagination-state';
import { resolveHistoryTurnTarget } from '@/codex-web/history-turn-routing';
import {
  nextForkedThreadNameFromList,
  threadToChatSession,
  threadToMessages,
} from '@/codex-web/thread-history-adapter';
import {
  applyTurnSnapshotsToMessages,
  continuationBoundaryMessageId,
  latestHistoryTurnFromPage,
  mergeLoadedThreadMessages,
  mergeThreadTurnMessages,
  threadTurnsPageToMessages,
} from '@/codex-web/thread-turns-page-adapter';
import type { Thread } from '@/codex/protocol/generated/v2/Thread';
import type { ReasoningEffort } from '@/codex/protocol/generated/ReasoningEffort';
import { modelSettingsFromResume } from '@/codex-web/thread-model-settings';
import { permissionProfileFromRuntimeSettings } from '@/codex-web/thread-permission-settings';
import {
  readThreadRuntimePreference,
  writeThreadRuntimePreference,
} from '@/codex-web/thread-runtime-preferences';
import { latestInProgressTurnId } from '@/codex-web/resumed-turn-hydration';
import { appServerConnectionNotice } from '@/codex-web/connection-notice';
import { readDefaultPanelPreference } from '@/lib/app-preferences';
import { forkAndSendEditedMessage } from '@/codex-web/edit-message-fork';
import {
  completeContinuationFork,
  continuationParentHref,
  continuationReferenceStorageKey,
  needsContinuationTargetHistory,
  parseContinuationReference,
} from '@/codex-web/continuation-reference';

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
  const [sessionSyncing, setSessionSyncing] = useState(false);
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
  const [activeWriterReplayOnly, setActiveWriterReplayOnly] = useState(false);
  const [sessionWorkingDirectory, setSessionWorkingDirectory] = useState('');
  const [sessionProjectName, setSessionProjectName] = useState('');
  const [resumedThreadId, setResumedThreadId] = useState<string | null>(null);
  const [resumedModel, setResumedModel] = useState<string>('');
  const [resumedCwd, setResumedCwd] = useState<string>('');
  const [appServerThread, setAppServerThread] = useState<Thread | null>(null);
  const [turnsNextCursor, setTurnsNextCursor] = useState<string | null>(null);
  const [latestHistoryTurn, setLatestHistoryTurn] = useState<LatestHistoryTurn | null>(null);
  const [paginationNotice, setPaginationNotice] = useState<{ message: string; description?: string } | null>(null);
  const [continuedFromMessageId, setContinuedFromMessageId] = useState<string>();
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
  const config = useAppServerSelector((state) => state.config);
  const threads = useAppServerSelector((state) => state.threads);
  const {
    readThread,
    listThreads,
    listThreadTurns,
    setThreadName,
    resumeThread,
    getThreadGoal,
    forkThread,
    sendOneTurn,
    sendTurnInThread,
    interruptTurn,
    respondToServerRequest,
    setThreadGoal,
    clearThreadGoal,
    updateThreadPermissions,
    updateThreadModelSettings,
    publishCrossClientUserMessage,
    reconnect,
  } = useAppServerActions();
  const ws = useWorkspaceSidebarOptional();
  const targetFilePath = searchParams.get('file') || undefined;
  const targetMessageId = searchParams.get('continuationMessage') || undefined;
  const compactViewport = useCompactViewport();
  const { t, locale } = useTranslation();
  const isEnglish = locale === 'en';
  const defaultPanelAppliedRef = useRef(false);
  const routeIdRef = useRef<string | null>(null);
  const sessionLoadedRef = useRef(false);
  const turnSnapshotsRef = useRef(turnSnapshots);
  const appServerSyncedUserMessages = useMemo(() => {
    const threadIds = resumedThreadId && resumedThreadId !== id ? [id, resumedThreadId] : [id];
    return threadIds.flatMap((threadId) => crossClientUserMessagesByThreadId[threadId] ?? []);
  }, [crossClientUserMessagesByThreadId, id, resumedThreadId]);
  const loadingHandoffMessages = appServerSyncedUserMessages.map(({ message }) => message);
  const connectionNotice = appServerConnectionNotice(connectionData, reconnect);

  useEffect(() => {
    turnSnapshotsRef.current = turnSnapshots;
  }, [turnSnapshots]);

  useEffect(() => {
    // Reset state when switching sessions
    const switchingSessions = routeIdRef.current !== id;
    routeIdRef.current = id;
    if (switchingSessions) {
      sessionLoadedRef.current = false;
      setSessionSyncing(true);
      defaultPanelAppliedRef.current = false;
      setLoading(true);
      setError(null);
      setMessages([]);
      setHasMore(false);
      setSessionModel('');
      setSessionEffort(null);
      setSessionProviderId('');
      setSessionRuntimePin('');
      setActiveWriterReplayOnly(false);
      setSessionWorkingDirectory('');
      setSessionProjectName('');
      setResumedThreadId(null);
      setResumedModel('');
      setResumedCwd('');
      setAppServerThread(null);
      setTurnsNextCursor(null);
      setLatestHistoryTurn(null);
      setPaginationNotice(null);
      setContinuedFromMessageId(undefined);
      setSessionInfoLoaded(false);
    }

    let cancelled = false;

    if (connectionData !== 'connected') {
      if (connectionData === 'failed' && !sessionLoadedRef.current) {
        setError('Codex app-server connection failed');
        setSessionInfoLoaded(true);
        setLoading(false);
      }
      return () => { cancelled = true; };
    }
    setError(null);
    setSessionSyncing(true);

    async function resolveContinuationBoundary(
      parentThreadId: string,
      childMessages: Message[],
    ): Promise<string | undefined> {
      try {
        let cursor: string | null = null;
        do {
          const parentPage = await listThreadTurns({
            threadId: parentThreadId,
            cursor,
            limit: 100,
            sortDirection: "desc",
            itemsView: "full",
          });
          const messageId = continuationBoundaryMessageId(
            childMessages,
            parentPage.data.map((turn) => turn.id),
          );
          if (messageId) return messageId;
          cursor = parentPage.nextCursor;
        } while (cursor);
        return undefined;
      } catch (boundaryError) {
        if (isUnsupportedTurnsListError(boundaryError)) {
          try {
            const parentResponse = await readThread(parentThreadId, { includeTurns: true });
            return continuationBoundaryMessageId(
              childMessages,
              parentResponse.thread.turns.map((turn) => turn.id),
            );
          } catch {
            return undefined;
          }
        }
        throw boundaryError;
      }
    }

    async function loadSessionAndMessages() {
      try {
        const response = await readThread(id, { includeTurns: false });
        if (cancelled) return;
        setAppServerThread(response.thread);
        const session = threadToChatSession(response.thread);
        applySession(session);
        const savedPreference = readThreadRuntimePreference(localStorage, id);
        let resume;
        try {
          resume = await resumeThread({
            threadId: id,
            cwd: response.thread.cwd,
            model: savedPreference?.model,
            permissionProfile: savedPreference?.permissionProfile,
          });
        } catch (resumeError) {
          const message = resumeError instanceof Error ? resumeError.message : String(resumeError);
          if (!message.includes('already has an active writer')) throw resumeError;

          const fallbackResponse = await readThread(id, { includeTurns: true });
          if (cancelled) return;
          const result = threadToMessages(fallbackResponse.thread);
          const replayMessages = applyTurnSnapshotsToMessages(
            fallbackResponse.thread,
            result.messages,
            turnSnapshotsRef.current,
          );
          setAppServerThread(fallbackResponse.thread);
          setMessages(replayMessages);
          setLatestHistoryTurn(latestHistoryTurnFromPage(
            fallbackResponse.thread.turns,
            "asc",
            "app-server.thread/read",
          ));
          setHasMore(false);
          setTurnsNextCursor(null);
          setActiveWriterReplayOnly(true);
          setPaginationNotice({
            message: isEnglish ? 'This conversation is running in another app-server' : '此会话正在另一个 app-server 中运行',
            description: isEnglish ? 'Full history loaded; connect to the original app-server to continue submitting.' : '已加载完整历史；连接到原 app-server 后才能继续提交。',
          });
          return;
        }
        if (cancelled) return;
        // Goal state is not guaranteed to be replayed as a notification when
        // reopening a persisted thread. Hydrate both route and resumed ids so
        // the composer can render the app-server goal immediately.
        await Promise.allSettled(
          Array.from(new Set([id, resume.thread.id])).map((threadId) => getThreadGoal(threadId)),
        );
        if (cancelled) return;
        const resumedLiveTurnId = latestInProgressTurnId(resume.thread.turns);
        const resumedSettings = modelSettingsFromResume(resume);
        const resumedPermissionProfile = savedPreference?.permissionProfile
          ?? permissionProfileFromRuntimeSettings(resume);
        if (savedPreference?.effort && savedPreference.effort !== resumedSettings.effort) {
          await updateThreadModelSettings({
            threadId: resume.thread.id,
            effort: savedPreference.effort,
          });
          if (cancelled) return;
        }
        setResumedThreadId(resume.thread.id);
        setResumedCwd(resume.cwd);
        setResumedModel(resumedSettings.model);
        setSessionModel(resumedSettings.model);
        setSessionEffort(savedPreference?.effort ?? resumedSettings.effort);
        setSessionPermissionProfile(resumedPermissionProfile);
        writeThreadRuntimePreference(localStorage, resume.thread.id, {
          model: resumedSettings.model,
          ...(savedPreference?.effort ?? resumedSettings.effort
            ? { effort: savedPreference?.effort ?? resumedSettings.effort ?? undefined }
            : {}),
          permissionProfile: resumedPermissionProfile,
        });
        let loadedMessages: Message[] = [];
        try {
          const turnsPage = await listThreadTurns({
            threadId: id,
            cursor: null,
            limit: 30,
            sortDirection: "desc",
            itemsView: "full",
          });
          if (cancelled) return;
          loadedMessages = threadTurnsPageToMessages(
            response.thread,
            turnsPage.data,
            "desc",
            turnSnapshotsRef.current,
            { omitAssistantTurnId: resumedLiveTurnId },
          );
          setMessages((current) => mergeLoadedThreadMessages(current, loadedMessages));
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
          let fallbackSucceeded = false;
          try {
            const fallbackResponse = await readThread(id, { includeTurns: true });
            if (cancelled) return;
            fallbackThread = fallbackResponse.thread;
            setAppServerThread(fallbackThread);
            fallbackSucceeded = true;
          } catch {
            // Keep metadata-only thread; error banner will indicate pagination failure.
          }
          const result = threadToMessages(fallbackThread, {
            omitAssistantTurnId: resumedLiveTurnId,
          });
          const snapshotMessages = applyTurnSnapshotsToMessages(
            fallbackThread,
            result.messages,
            turnSnapshotsRef.current,
          );
          loadedMessages = snapshotMessages;
          setLatestHistoryTurn(
            latestHistoryTurnFromPage(
              fallbackThread.turns,
              "asc",
              "app-server.thread/read",
            ),
          );
          setMessages((current) => mergeLoadedThreadMessages(current, snapshotMessages));
          setHasMore(false);
          setTurnsNextCursor(null);
          if (fallbackSucceeded && isUnsupportedTurnsListError(pageError)) {
            // thread/turns/list is not implemented yet in this app-server version;
            // complete turns were loaded successfully via readThread with includeTurns.
            setPaginationNotice(null);
          } else {
            setPaginationNotice(historyPaginationFailureNotice(pageError, isEnglish));
          }
          if (result.unsupportedItemCount > 0) {
            console.info(`Phase 5A: ${result.unsupportedItemCount} historical tool items were not rendered`);
          }
        }
        if (needsContinuationTargetHistory(
          loadedMessages.map((message) => message.id),
          targetMessageId,
        )) {
          try {
            const fullResponse = await readThread(id, { includeTurns: true });
            if (cancelled) return;
            const result = threadToMessages(fullResponse.thread, {
              omitAssistantTurnId: resumedLiveTurnId,
            });
            loadedMessages = applyTurnSnapshotsToMessages(
              fullResponse.thread,
              result.messages,
              turnSnapshotsRef.current,
            );
            setAppServerThread(fullResponse.thread);
            setMessages((current) => mergeLoadedThreadMessages(current, loadedMessages));
            setHasMore(false);
            setTurnsNextCursor(null);
            setLatestHistoryTurn(latestHistoryTurnFromPage(
              fullResponse.thread.turns,
              "asc",
              "app-server.thread/read",
            ));
          } catch (targetError) {
            setPaginationNotice(historyPaginationFailureNotice(targetError, isEnglish));
          }
        }
        if (response.thread.forkedFromId) {
          const savedReference = parseContinuationReference(
            localStorage.getItem(continuationReferenceStorageKey(response.thread.id)),
          );
          if (savedReference?.parentThreadId === response.thread.forkedFromId) {
            setContinuedFromMessageId(savedReference.parentMessageId);
          } else {
            try {
              const boundaryMessageId = await resolveContinuationBoundary(
                response.thread.forkedFromId,
                loadedMessages,
              );
              if (!cancelled) setContinuedFromMessageId(boundaryMessageId);
            } catch (boundaryError) {
              console.info(isEnglish ? 'Unable to locate continuation task boundary' : '无法定位接续任务边界', boundaryError);
            }
          }
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load messages';
        setError(message);
      } finally {
        if (!cancelled) {
          sessionLoadedRef.current = true;
          setSessionSyncing(false);
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
      }
      setSessionProjectName(session.project_name || '');
      setSessionId(id);
      setPanelSessionTitle(session.title || t('chat.newConversation'));
      setSessionProviderId(session.provider_id || '');
      setSessionRuntimePin(session.runtime_pin || '');
      setSessionMode((session.mode as 'code' | 'plan') || 'code');
      setSessionHasSummary(!!session.context_summary);
      setSessionInfoLoaded(true);
    }

    loadSessionAndMessages();

    return () => { cancelled = true; };
  }, [connectionData, id, readThread, listThreadTurns, resumeThread, getThreadGoal, setWorkingDirectory, setSessionId, setPanelSessionTitle, t, targetMessageId, updateThreadModelSettings]);

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
    setSessionMode(settings.collaborationMode.mode === 'plan' ? 'plan' : 'code');
    const permissionProfile = permissionProfileFromRuntimeSettings(settings);
    setSessionPermissionProfile(permissionProfile);
    writeThreadRuntimePreference(localStorage, threadId, {
      model: settings.model,
      ...(settings.effort ? { effort: settings.effort } : {}),
      permissionProfile,
    });
  }, [threadSettingsByThreadId, id, resumedThreadId]);

  if (loading || !sessionInfoLoaded) {
    if (loadingHandoffMessages.length > 0) {
      return (
        <div className="flex h-full min-h-0 flex-col" data-testid="chat-route-handoff">
          <MessageList
            messages={loadingHandoffMessages}
            streamingContent=""
            isStreaming
            sessionId={id}
          />
          <div className="flex h-24 shrink-0 items-center justify-center border-t border-border/50">
            <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center">
        <SpinnerGap size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    if (connectionNotice) {
      return (
        <div className="flex h-full items-center justify-center px-4">
          <ErrorBanner
            message={connectionNotice.message}
            description={connectionNotice.description}
            actions={connectionNotice.actions}
            className="w-full max-w-md"
          />
        </div>
      );
    }
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
  const activeTurnVisibility = selectVisibleActiveTurn({
    activeTurn: activeAppServerTurn,
    otherActiveTurns,
    routeThreadId: id,
    resumedThreadId,
    thread: appServerThread,
    latestHistoryTurn,
  });
  const appServerTurn = activeTurnVisibility.visibleTurn;
  const appServerNotice = connectionNotice
    ?? (connectionData === 'connecting' && messages.length > 0
      ? { message: isEnglish ? 'Connecting to Codex app-server...' : '正在连接 Codex app-server...' }
      : null)
    ?? activeTurnVisibility.notice
    ?? paginationNotice;
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
    config?.data?.config?.model?.trim() ||
    (config?.data?.config?.model_provider === 'deepseek' ? 'deepseek-flash' : '') ||
    models?.data.data.find((model) => !model.hidden && model.isDefault)?.id ||
    models?.data.data.find((model) => !model.hidden)?.id ||
    '';
  const canResumeAppServerThread = isAppServerThread && !!sessionWorkingDirectory;
  const canDisplayAppServerThread = !!sessionWorkingDirectory;
  const continuedFromHref = appServerThread?.forkedFromId
    ? continuedFromMessageId
      ? continuationParentHref(appServerThread.forkedFromId, continuedFromMessageId)
      : `/chat/${encodeURIComponent(appServerThread.forkedFromId)}`
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatView
        key={`${id}:${targetMessageId ?? ''}`}
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
        readOnly={activeWriterReplayOnly}
        readOnlyReason={activeWriterReplayOnly
          ? (isEnglish
            ? "This conversation is held by another app-server; currently showing history only and cannot submit."
            : "此会话由另一个 app-server 持有；当前仅显示历史，不能提交。")
          : (isEnglish
            ? "This is a read-only historical conversation; cannot send in the current version."
            : "这是只读历史会话，当前版本不能继续发送。")}
        composerDisabled={connectionData !== 'connected' || sessionSyncing}
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
        continuedFromMessageId={continuedFromMessageId}
        targetMessageId={targetMessageId}
        onContinueInNewTask={connectionData === 'connected' ? async (lastTurnId, sourceMessageId) => {
          const response = await forkThread({ threadId: resumedThreadId || id, lastTurnId });
          const sourceThread = appServerThread
            ?? threads?.data.data.find((thread) => thread.id === (resumedThreadId || id));
          await completeContinuationFork({
            rename: sourceThread ? async () => {
              const name = await nextForkedThreadNameFromList(sourceThread, listThreads);
              await setThreadName({ threadId: response.thread.id, name });
            } : undefined,
            saveReference: lastTurnId && sourceMessageId ? () => localStorage.setItem(
              continuationReferenceStorageKey(response.thread.id),
              JSON.stringify({
                parentThreadId: resumedThreadId || id,
                parentMessageId: sourceMessageId,
                lastTurnId,
              }),
            ) : undefined,
            navigate: () => router.push(`/chat/${encodeURIComponent(response.thread.id)}`),
            onPostProcessError: (postProcessError) => console.warn('新任务后处理失败', postProcessError),
          });
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
          writeThreadRuntimePreference(localStorage, threadId, { permissionProfile });
        } : undefined}
        onAppServerModelChange={canResumeAppServerThread ? async (model) => {
          await updateThreadModelSettings({
            threadId: resumedThreadId || id,
            model,
          });
          // 同步历史会话的本地发送目标，避免下一轮复用恢复会话时记录的旧模型。
          setResumedModel(model);
          setSessionModel(model);
          writeThreadRuntimePreference(localStorage, resumedThreadId || id, { model });
        } : undefined}
        onAppServerEffortChange={canResumeAppServerThread ? async (effort) => {
          await updateThreadModelSettings({
            threadId: resumedThreadId || id,
            effort,
          });
          writeThreadRuntimePreference(localStorage, resumedThreadId || id, { effort });
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
        appServerInterrupt={isAppServerThread && appServerTurn ? async () => {
          await interruptTurn({
            threadId: appServerTurn.threadId || resumedThreadId || id,
            turnId: appServerTurn.turnId,
          });
        } : undefined}
        appServerEditLastTurn={canResumeAppServerThread ? async ({ beforeTurnId, content, files, cwd, model, effort, mode, permissionProfile }) => {
          const threadId = resumedThreadId || id;
          const sourceThread = appServerThread
            ?? threads?.data.data.find((thread) => thread.id === threadId);
          await forkAndSendEditedMessage({
            fork: async () => {
              const response = await forkThread({ threadId, beforeTurnId });
              return { threadId: response.thread.id };
            },
            send: async (forkedThreadId) => {
              await sendTurnInThread({
                threadId: forkedThreadId,
                content,
                files,
                cwd,
                model,
                effort,
                mode,
                permissionProfile,
              });
              writeThreadRuntimePreference(localStorage, forkedThreadId, {
                ...(model ? { model } : {}),
                ...(effort ? { effort } : {}),
                permissionProfile,
              });
            },
            navigate: async (forkedThreadId) => {
              await completeContinuationFork({
                rename: sourceThread ? async () => {
                  const name = await nextForkedThreadNameFromList(sourceThread, listThreads);
                  await setThreadName({ threadId: forkedThreadId, name });
                } : undefined,
                navigate: () => router.push(`/chat/${encodeURIComponent(forkedThreadId)}`),
                onPostProcessError: (postProcessError) => console.warn('编辑任务后处理失败', postProcessError),
              });
            },
          });
        } : undefined}
        appServerSend={canDisplayAppServerThread ? async ({ content, files, cwd, model, effort, mode, permissionProfile, onAccepted }) => {
          if (connectionData !== 'connected') throw new Error('Codex app-server 尚未连接');
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

          const acceptedTurn = await sendTurnInThread({
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
          writeThreadRuntimePreference(localStorage, threadId, {
            model: turnModel,
            ...(effort ? { effort } : {}),
            permissionProfile,
          });
          return acceptedTurn;
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
            writeThreadRuntimePreference(localStorage, acceptedTurn.threadId, {
              model: resumedModel || sessionModel || defaultAppServerModel,
              ...(effort ? { effort } : {}),
              permissionProfile: sessionPermissionProfile,
            });
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
            const failure = preserveMessagesAfterPaginationFailure(messages, pageError, isEnglish);
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
