'use client';

import { Suspense, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Message, PermissionRequestEvent, FileAttachment, MentionRef, PermissionProfile, SkillInputReference } from '@/types';
import { MessageList } from '@/components/chat/MessageList';
import { MessageInput, composerDraftKey } from '@/components/chat/MessageInput';
import { PerformanceProfiler } from '@/components/performance/PerformanceProfiler';
import { PermissionPrompt } from '@/components/chat/PermissionPrompt';
import { AppServerRequestPrompt } from '@/components/chat/AppServerRequestPrompt';
import type { AppServerRequestResponseInput } from '@/codex-web/approval-adapter';
import { ChatEmptyState } from '@/components/chat/ChatEmptyState';
import { NewChatWelcome } from '@/components/chat/NewChatWelcome';
import { NewChatProjectSelector } from '@/components/chat/NewChatProjectSelector';
import { RunCheckpoint } from '@/components/chat/RunCheckpoint';
import { GoalProgressRow } from '@/components/chat/GoalProgressRow';
import { PlanImplementationPromptBar } from '@/components/chat/PlanImplementationPromptBar';
import { ErrorBanner } from '@/components/ui/error-banner';
import { buildCheckpoints } from '@/lib/run-checkpoint';
import { readNewChatKey } from '@/lib/new-chat-url';
// 聊天首屏内存约束（2026-05-09）：NewChatPage 不得静态引用
// useOverviewData。RunCheckpoint 只承载“本次能否发送”的会话级原因；
// 全局健康信息属于 /settings/codex，不进入聊天首屏依赖图。
import { FolderPicker } from '@/components/chat/FolderPicker';
import { useTranslation } from '@/hooks/useTranslation';
import { usePanel } from '@/hooks/usePanel';
import { useAppServerActions, useAppServerSelector } from '@/codex-web/AppServerProvider';
import {
  appServerTerminalTurnToMessageContent,
  appServerTurnToMessageBlocks,
} from '@/codex-web/app-server-message-blocks';
import { approvalRequestMatchesThread, firstApproval } from '@/codex-web/approval-queue-adapter';
import { selectActiveTurnByThreadIds } from '@/codex-web/active-turns-adapter';
import { getExistingNewChatThreadId } from '@/codex-web/new-chat-turn-routing';
import { editedGoalStatus, goalSummaryLines } from '@/codex-web/goal-display-adapter';
import { selectPlanImplementationPrompt } from '@/codex-web/plan-implementation-adapter';
import type { ThreadGoalStatus } from '@/codex/protocol/generated/v2/ThreadGoalStatus';
import type { ReasoningEffort } from '@/codex/protocol/generated/ReasoningEffort';
import { resolveNewChatModelDefaults } from '@/codex-web/new-chat-model-defaults';
import {
  deriveCodexWebToolState,
  type CodexWebToolResultInfo,
  type CodexWebToolUseInfo,
} from '@/codex-web/tool-adapter';
import { mergeCrossClientUserMessages } from '@/codex-web/cross-client-sync';

const DEFAULT_CODEX_PROVIDER_ID = 'codex_account';
const DEFAULT_CODEX_MODEL = 'gpt-5.5';

export default function NewChatPage() {
  // useSearchParams in App Router needs a Suspense boundary. The body of
  // NewChatPage was previously reading window.location.search inside a
  // `useMemo([])` to avoid that wrapper, but `useMemo([])` only runs once
  // per mount, so URL changes after mount (e.g. router.push to
  // /chat?prefill=… while /chat is already mounted, or back-forward
  // navigation) didn't update `prefillText`. Result: Tasks page → "新建任务"
  // could land on /chat with the prefill query in the URL but an empty
  // textarea. Suspense + useSearchParams makes prefill reactive without
  // breaking SSR/static prerender.
  return (
    <Suspense fallback={null}>
      <NewChatPageInner />
    </Suspense>
  );
}

function NewChatPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillText = searchParams.get('prefill') || '';
  const initialSkill = useMemo(() => {
    const name = searchParams.get('skill')?.trim();
    if (!name) return undefined;
    return {
      name,
      path: searchParams.get('skillPath') || undefined,
      label: searchParams.get('skillLabel') || name,
      description: searchParams.get('skillDescription') || '',
    };
  }, [searchParams]);
  const initialSkillKey = initialSkill ? `${initialSkill.name}\n${initialSkill.path || ''}` : '';
  const [consumedSkillKey, setConsumedSkillKey] = useState<string | null>(null);
  const effectiveInitialSkill = initialSkillKey && initialSkillKey !== consumedSkillKey ? initialSkill : undefined;
  const initialSkillKeyRef = useRef(initialSkillKey);
  useEffect(() => { initialSkillKeyRef.current = initialSkillKey; }, [initialSkillKey]);
  const newChatKey = readNewChatKey(searchParams);
  // #4/#5 (Codex P2) — the prefill enters the composer via `initialValue`, which
  // MessageInput prioritises OVER the draft. So clearing only the sessionStorage
  // draft at send-accept (below) leaves the URL prefill, and the accept-time
  // composer remount re-seeds the just-sent text from `initialValue`. Track which
  // prefill we've already sent and feed '' for it so the remount comes up empty;
  // a genuinely NEW prefill (different text) still shows.
  const [consumedPrefill, setConsumedPrefill] = useState<string | null>(null);
  const effectivePrefill = prefillText && prefillText !== consumedPrefill ? prefillText : '';
  // #4/#5 (Codex P2, warm-nav) — live ref to the URL prefill so the accept path
  // in `sendFirstMessage` consumes the *current* prefill even after a warm
  // navigation (/chat already mounted, then router.push to /chat?prefill=…).
  // `sendFirstMessage` is a stable useCallback that intentionally omits
  // prefillText from its deps — adding it would churn the callback identity and
  // cascade through `handleCommand`. Reading prefillText from that stale closure
  // saw the OLD (often empty) prefill, so `setConsumedPrefill` never fired and
  // the prefill kept re-seeding the composer. The ref is synced in an effect
  // (not during render — react-hooks/refs); the effect flushes before the next
  // user event, so the accept-time consume always sees the live prefill.
  const prefillTextRef = useRef(prefillText);
  useEffect(() => { prefillTextRef.current = prefillText; }, [prefillText]);
  const { setPendingApprovalSessionId, setWorkingDirectory } = usePanel();
  const latestCrossClientUserMessage = useAppServerSelector((state) => state.latestCrossClientUserMessage);
  const crossClientUserMessagesByThreadId = useAppServerSelector((state) => state.crossClientUserMessagesByThreadId);
  const activeTurn = useAppServerSelector((state) => state.activeTurn);
  const activeTurnsByThreadId = useAppServerSelector((state) => state.activeTurnsByThreadId);
  const pendingApprovals = useAppServerSelector((state) => state.pendingApprovals);
  const threadTokenUsageByThreadId = useAppServerSelector((state) => state.threadTokenUsageByThreadId);
  const connectionData = useAppServerSelector((state) => state.connection.data);
  const models = useAppServerSelector((state) => state.models);
  const config = useAppServerSelector((state) => state.config);
  const threadSettingsByThreadId = useAppServerSelector((state) => state.threadSettingsByThreadId);
  const threads = useAppServerSelector((state) => state.threads);
  const goalsByThreadId = useAppServerSelector((state) => state.goalsByThreadId);
  const {
    startThread,
    sendOneTurn,
    sendTurnInThread,
    interruptTurn,
    respondToApproval,
    respondToServerRequest,
    setThreadGoal,
    clearThreadGoal,
    readDirectory,
    updateThreadPermissions,
    updateThreadModelSettings,
    publishCrossClientUserMessage,
  } = useAppServerActions();
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThinkingContent, setStreamingThinkingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolUses, setToolUses] = useState<CodexWebToolUseInfo[]>([]);
  const [toolResults, setToolResults] = useState<CodexWebToolResultInfo[]>([]);
  const [statusText, setStatusText] = useState<string | undefined>();
  const streamingStartedAtRef = useRef(0);
  const [workingDir, setWorkingDir] = useState('');
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const workingDirectoryInitializedRef = useRef(false);
  const workingDirectoryClearedRef = useRef(false);
  const workingDirectorySelectionVersionRef = useRef(0);
  const [errorBanner, setErrorBanner] = useState<{ message: string; description?: string } | null>(null);
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  // Codex 模型发现没有返回可用模型时置为 true。
  const [noCompatibleProvider, setNoCompatibleProvider] = useState(false);
  // 保留 RunCheckpoint 所需形状；Codex-only 新建聊天不再评估旧 pinned 默认值。
  const [invalidDefault, setInvalidDefault] = useState<
    | {
        providerId?: string;
        providerName?: string;
        modelValue?: string;
        reason?: 'provider-missing' | 'model-missing' | 'pin-incomplete';
      }
    | null
  >(null);
  const [mode, setMode] = useState('code');
  // Codex-only 新建聊天：先用稳定默认值占位，再用 app-server model/list 校正。
  const [modelReady, setModelReady] = useState(false);
  const [currentModel, setCurrentModel] = useState(DEFAULT_CODEX_MODEL);
  const [currentProviderId, setCurrentProviderId] = useState(DEFAULT_CODEX_PROVIDER_ID);
  const [pendingPermission, setPendingPermission] = useState<PermissionRequestEvent | null>(null);
  const [permissionResolved, setPermissionResolved] = useState<'allow' | 'deny' | 'timeout' | null>(null);
  const [streamingToolOutput, setStreamingToolOutput] = useState('');
  const [permissionProfile, setPermissionProfile] = useState<PermissionProfile>('request_approval');
  const [pendingContextTokens, setPendingContextTokens] = useState(0);
  const canSendWithCurrentProvider = useMemo(() => {
    return currentProviderId === DEFAULT_CODEX_PROVIDER_ID && !!currentModel;
  }, [currentProviderId, currentModel]);

  useEffect(() => {
    setWorkingDirectory(workingDir);
  }, [setWorkingDirectory, workingDir]);

  const hasSendableProviderForCurrentRuntime = useMemo(() => {
    if (!modelReady) return true; // 仍在加载时不闪现空状态。
    return canSendWithCurrentProvider;
  }, [modelReady, canSendWithCurrentProvider]);


  // Run Checkpoint signals — session-scoped only, no global health.
  //
  // Phase 2 originally pulled the full `useOverviewData()` snapshot
  // here. That coupling cost the chat first paint a fan-out of
  // /api fetches plus a static compile-graph reach into Settings
  // Overview / runtime/effective / provider catalog. The 2026-05-09
  // memory cut moves global health (provider count / models enabled /
  // workspace state / global default invalid / runtime fallback) out
  // of this surface entirely；/settings/health is the canonical dashboard.
  // RunCheckpoint here keeps only the reasons that gate
  // "can this send go through":
  //   - noCompatibleProvider:        local state, set when the picker
  //                                   can't find a provider/model pair
  //                                   under the active runtime
  //   - !!invalidDefault:            local state from the runtime-aware
  //                                   resolver effect (NOT OR'd with
  //                                   any global flag — under explicit
  //                                   pin the local check is canonical;
  //                                   under follow-default it's the
  //                                   runtime-aware substitute for the
  //                                   global pinned check)
  //   - context-cost: per-send confirmation gate, unrelated to runtime
  //
  // /chat (new conversation page) hasn't accumulated messages yet, so
  // usedContextTokens is 0 — the context-cost trigger collapses to the
  // 10K hard cap on the pending side.
  const usedContextTokens = 0;
  const checkpointReasons = useMemo(() => {
    const pinnedDescriptor = invalidDefault?.modelValue
      ? `${invalidDefault.providerName ?? invalidDefault.providerId ?? '?'} / ${invalidDefault.modelValue}`
      : invalidDefault?.providerId ?? undefined;
    return buildCheckpoints({
      noCompatibleProvider,
      defaultInvalid: !!invalidDefault,
      pinnedDescriptor,
      pendingContextTokens,
      usedContextTokens,
    });
  }, [
    invalidDefault,
    noCompatibleProvider,
    pendingContextTokens,
    usedContextTokens,
  ]);
  const blockingReasonIds = useMemo(
    () => checkpointReasons.filter((r) => r.requiresConfirm).map((r) => r.id),
    [checkpointReasons],
  );
  const handleCheckpointAction = useCallback((actionId: string) => {
    // Generic confirm→bypass bridge (MessageInput listens for this event and
    // re-runs submit with bypass=true). As of #632 no built-in reason emits
    // 'confirm-context-cost' — context-cost is now a non-blocking heads-up;
    // this is retained dormant for any future real-danger confirm reason.
    if (actionId === 'confirm-context-cost') {
      window.dispatchEvent(new Event('run-checkpoint-confirm-send'));
    }
  }, []);
  const [createdSessionId, setCreatedSessionId] = useState<string | undefined>();
  const lastSeenCrossClientMessageIdRef = useRef('');
  useEffect(() => {
    const latest = latestCrossClientUserMessage;
    if (!latest || latest.message.id === lastSeenCrossClientMessageIdRef.current) return;
    lastSeenCrossClientMessageIdRef.current = latest.message.id;

    if (!createdSessionId) {
      if (!latest.isNewThread || messages.length > 0) return;
      setCreatedSessionId(latest.threadId);
      setMessages((current) => mergeCrossClientUserMessages(
        current,
        crossClientUserMessagesByThreadId[latest.threadId] ?? [latest],
      ));
      return;
    }

    if (latest.threadId === createdSessionId) {
      setMessages((current) => mergeCrossClientUserMessages(
        current,
        crossClientUserMessagesByThreadId[createdSessionId] ?? [],
      ));
    }
  }, [
    crossClientUserMessagesByThreadId,
    latestCrossClientUserMessage,
    createdSessionId,
    messages.length,
  ]);
  const handlePermissionProfileChange = useCallback(async (next: PermissionProfile) => {
    try {
      if (createdSessionId) {
        await updateThreadPermissions({
          threadId: createdSessionId,
          cwd: workingDir,
          permissionProfile: next,
        });
      }
      setPermissionProfile(next);
    } catch (error) {
      setErrorBanner({
        message: '权限更新失败',
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, [createdSessionId, updateThreadPermissions, workingDir]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const finalizedAppServerTurnRef = useRef<string>('');
  const [livePlanPromptTurnKey, setLivePlanPromptTurnKey] = useState('');
  const [dismissedPlanPromptKey, setDismissedPlanPromptKey] = useState('');
  // #615: guards the first-message send while it's mid-flight. We defer the
  // isStreaming / optimistic-bubble flips until the backend ACCEPTS the message
  // (otherwise flipping `isNewChat` remounts the composer and eats the
  // screenshot), which means the usual `if (isStreaming) return` re-entry guard
  // isn't armed during that window — this ref blocks a double-submit instead.
  const firstSendInFlightRef = useRef(false);
  // Effort level — lifted here so the first message includes it
  const [selectedEffort, setSelectedEffort] = useState<string | undefined>(undefined);
  // Provider options (thinking mode + 1M context)
  const [thinkingMode, setThinkingMode] = useState<string>('adaptive');
  const [context1m, setContext1m] = useState(false);
  const lastNewChatKeyRef = useRef<string>('');
  const pendingNewChatTurn =
    activeTurn?.data && !activeTurn.data.threadId
      ? activeTurn.data
      : null;
  const appServerTurn = createdSessionId
    ? selectActiveTurnByThreadIds(activeTurnsByThreadId, [createdSessionId])
    : pendingNewChatTurn;
  const appServerApproval = createdSessionId
    ? firstApproval(pendingApprovals, (approval) =>
        approvalRequestMatchesThread(approval, [createdSessionId]),
      )
    : null;
  const contextWindowUsage = createdSessionId
    ? threadTokenUsageByThreadId[createdSessionId]?.data ?? null
    : null;
  const appServerPermission = appServerApproval && "permission" in appServerApproval
    ? appServerApproval.permission
    : null;
  const visiblePendingPermission = appServerPermission ?? pendingPermission;

  const applyNewChatModelDefaults = useCallback(() => {
    if (connectionData !== 'connected') {
      setModelReady(false);
      return;
    }

    const defaults = resolveNewChatModelDefaults(
      models?.data,
      config?.data,
    );
    setCurrentProviderId(DEFAULT_CODEX_PROVIDER_ID);
    setCurrentModel(defaults?.model ?? '');
    setSelectedEffort(defaults?.effort);
    setNoCompatibleProvider(!defaults);
    setInvalidDefault(null);
    setModelReady(true);
  }, [config, connectionData, models]);

  const resetLocalNewChatState = useCallback(() => {
    setCreatedSessionId(undefined);
    setMessages([]);
    setStreamingContent('');
    setStreamingThinkingContent('');
    setIsStreaming(false);
    setToolUses([]);
    setToolResults([]);
    setStatusText(undefined);
    streamingStartedAtRef.current = 0;
    setErrorBanner(null);
    setPendingPermission(null);
    setPermissionResolved(null);
    setStreamingToolOutput('');
    setPendingContextTokens(0);
    setConsumedPrefill(null);
    setPendingApprovalSessionId('');
    abortControllerRef.current = null;
    finalizedAppServerTurnRef.current = '';
    setLivePlanPromptTurnKey('');
    firstSendInFlightRef.current = false;
    applyNewChatModelDefaults();
    try { sessionStorage.removeItem(composerDraftKey()); } catch { /* unavailable */ }
  }, [applyNewChatModelDefaults, setPendingApprovalSessionId]);

  useEffect(() => {
    if (!newChatKey || lastNewChatKeyRef.current === newChatKey) return;
    lastNewChatKeyRef.current = newChatKey;
    resetLocalNewChatState();
  }, [newChatKey, resetLocalNewChatState]);

  useEffect(() => {
    if (!appServerTurn) return;
    const toolState = deriveCodexWebToolState(appServerTurn);
    setStreamingContent(appServerTurn.assistantText);
    setStreamingThinkingContent(appServerTurn.reasoningText);
    setToolUses(toolState.toolUses);
    setToolResults(toolState.toolResults);
    setStreamingToolOutput(toolState.streamingToolOutput);
    if (appServerTurn.status === 'running') {
      if (streamingStartedAtRef.current <= 0) streamingStartedAtRef.current = Date.now();
      setIsStreaming(true);
      setStatusText('已处理');
    } else if (appServerTurn.status === 'failed') {
      setStatusText('Codex 处理失败');
    } else if (appServerTurn.status === 'interrupted') {
      setStatusText('Codex 已中断');
    } else if (appServerTurn.status === 'completed') {
      setStatusText(undefined);
    }
  }, [appServerTurn]);

  useEffect(() => {
    if (!isStreaming || !appServerTurn) return;
    if (!['completed', 'failed', 'interrupted'].includes(appServerTurn.status)) return;

    const finalKey = `${appServerTurn.threadId}:${appServerTurn.turnId}:${appServerTurn.status}`;
    if (finalizedAppServerTurnRef.current === finalKey) return;
    finalizedAppServerTurnRef.current = finalKey;
    setLivePlanPromptTurnKey(finalKey);
    const assistantContent = appServerTerminalTurnToMessageContent(appServerTurn);

    if (appServerTurn.status === 'failed') {
      setErrorBanner({
        message: 'Codex 处理失败',
        description: appServerTurn.errorMessage || undefined,
      });
    } else if (assistantContent) {
      const assistantMessage: Message = {
        id: 'temp-assistant-' + Date.now(),
        session_id: appServerTurn.threadId || createdSessionId || '',
        role: 'assistant',
        content: assistantContent,
        created_at: new Date().toISOString(),
        token_usage: null,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    }

    setIsStreaming(false);
    setStreamingContent('');
    setStreamingThinkingContent('');
    setToolUses([]);
    setToolResults([]);
    setStreamingToolOutput('');
    setStatusText(undefined);
    streamingStartedAtRef.current = 0;
    setPendingPermission(null);
    setPermissionResolved(null);
    setPendingApprovalSessionId('');
    abortControllerRef.current = null;
    firstSendInFlightRef.current = false;
  }, [appServerTurn, createdSessionId, isStreaming, setPendingApprovalSessionId]);

  useEffect(() => {
    setPendingApprovalSessionId(appServerApproval?.threadId ?? '');
  }, [appServerApproval, setPendingApprovalSessionId]);

  useEffect(() => {
    applyNewChatModelDefaults();
  }, [applyNewChatModelDefaults]);

  useEffect(() => {
    if (!createdSessionId) return;
    const settings = threadSettingsByThreadId[createdSessionId]?.data;
    if (!settings) return;
    setCurrentModel(settings.model);
    setSelectedEffort(settings.effort ?? undefined);
  }, [threadSettingsByThreadId, createdSessionId]);

  const handleThreadModelChange = useCallback((model: string) => {
    setCurrentModel(model);
    if (!createdSessionId) return;
    void updateThreadModelSettings({ threadId: createdSessionId, model }).catch((error) => {
      setErrorBanner({
        message: '模型更新失败',
        description: error instanceof Error ? error.message : String(error),
      });
    });
  }, [createdSessionId, updateThreadModelSettings]);

  const handleThreadEffortChange = useCallback((effort: string | undefined) => {
    setSelectedEffort(effort);
    if (!createdSessionId || !effort || effort === 'auto') return;
    void updateThreadModelSettings({
      threadId: createdSessionId,
      effort: effort as ReasoningEffort,
    }).catch((error) => {
      setErrorBanner({
        message: '推理等级更新失败',
        description: error instanceof Error ? error.message : String(error),
      });
    });
  }, [createdSessionId, updateThreadModelSettings]);

  // 初始化工作目录，并通过 app-server 验证目录仍然存在。
  useEffect(() => {
    if (workingDirectoryInitializedRef.current || workingDirectoryClearedRef.current) return;
    let cancelled = false;
    const initializationVersion = workingDirectorySelectionVersionRef.current;

    const canApplyInitialization = () =>
      !cancelled
      && !workingDirectoryClearedRef.current
      && workingDirectorySelectionVersionRef.current === initializationVersion;

    const validateDir = async (path: string): Promise<boolean> => {
      try {
        await readDirectory(path);
        return true;
      } catch {
        return false;
      }
    };

    const tryFallbackToDefault = async () => {
      const defaultProject = threads?.data.data.find((thread) => thread.cwd.trim())?.cwd;
      if (!defaultProject || !canApplyInitialization()) return;
      if (await validateDir(defaultProject) && canApplyInitialization()) {
        setWorkingDir(defaultProject);
        localStorage.setItem('codepilot:last-working-directory', defaultProject);
      }
    };

    const init = async () => {
      const saved = localStorage.getItem('codepilot:last-working-directory');
      if (!saved && !threads) return;
      workingDirectoryInitializedRef.current = true;
      if (saved) {
        if (await validateDir(saved) && canApplyInitialization()) {
          setWorkingDir(saved);
        } else if (canApplyInitialization()) {
          // Stale — clear and try setup default
          localStorage.removeItem('codepilot:last-working-directory');
          await tryFallbackToDefault();
        }
      } else {
        await tryFallbackToDefault();
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [threads, readDirectory]);

  // 侧栏项目切换监听必须独立于只执行一次的目录初始化。
  useEffect(() => {
    const handler = (e: Event) => {
      const path = (e as CustomEvent).detail?.path;
      if (path) {
        workingDirectorySelectionVersionRef.current += 1;
        workingDirectoryClearedRef.current = false;
        setWorkingDir(path);
      }
    };
    window.addEventListener('project-directory-changed', handler);
    return () => window.removeEventListener('project-directory-changed', handler);
  }, []);

  // 最近项目来自 app-server thread/list。
  useEffect(() => {
    const projects = threads?.data.data
      .map((thread) => thread.cwd.trim())
      .filter(Boolean) ?? [];
    setRecentProjects([...new Set(projects)]);
  }, [threads]);

  const projectOptions = useMemo(() => {
    const projects = recentProjects.filter((path) => path !== workingDir);
    return workingDir.trim() ? [workingDir, ...projects] : projects;
  }, [recentProjects, workingDir]);

  const handleSelectFolder = useCallback(() => {
    setFolderPickerOpen(true);
  }, []);

  const handleFolderPickerSelect = useCallback((path: string) => {
    workingDirectorySelectionVersionRef.current += 1;
    workingDirectoryClearedRef.current = false;
    setWorkingDir(path);
    localStorage.setItem('codepilot:last-working-directory', path);
    setFolderPickerOpen(false);
  }, []);

  const handleSelectProject = useCallback((path: string) => {
    workingDirectorySelectionVersionRef.current += 1;
    workingDirectoryClearedRef.current = false;
    setWorkingDir(path);
    localStorage.setItem('codepilot:last-working-directory', path);
  }, []);

  const handleClearProject = useCallback(() => {
    workingDirectorySelectionVersionRef.current += 1;
    workingDirectoryClearedRef.current = true;
    setWorkingDir('');
    localStorage.removeItem('codepilot:last-working-directory');
  }, []);

  const stopStreaming = useCallback(() => {
    if (appServerTurn?.threadId) {
      void interruptTurn({
        threadId: appServerTurn.threadId,
        turnId: appServerTurn.turnId,
      }).catch((error) => {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        setErrorBanner({ message: 'Codex 中断失败', description: errMsg });
      });
      return;
    }

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, [appServerTurn, interruptTurn]);

  const handlePermissionResponse = useCallback(async (decision: 'allow' | 'allow_session' | 'deny', updatedInput?: Record<string, unknown>, denyMessage?: string) => {
    if (appServerPermission && appServerApproval) {
      setPermissionResolved(decision === 'deny' ? 'deny' : 'allow');
      setPendingApprovalSessionId('');
      try {
        await respondToApproval(decision, appServerApproval.requestId);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        setErrorBanner({ message: 'Approval response failed', description: errMsg });
      }
      setTimeout(() => {
        setPermissionResolved(null);
      }, 1000);
      return;
    }

    if (!pendingPermission) return;

    const body: { permissionRequestId: string; decision: { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] } | { behavior: 'deny'; message?: string } } = {
      permissionRequestId: pendingPermission.permissionRequestId,
      decision: decision === 'deny'
        ? { behavior: 'deny', message: denyMessage || 'User denied permission' }
        : {
            behavior: 'allow',
            ...(updatedInput ? { updatedInput } : {}),
            ...(decision === 'allow_session' && pendingPermission.suggestions
              ? { updatedPermissions: pendingPermission.suggestions }
              : {}),
          },
    };

    setPermissionResolved(decision === 'deny' ? 'deny' : 'allow');
    setPendingApprovalSessionId('');

    try {
      await fetch('/api/chat/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // Best effort
    }

    setTimeout(() => {
      setPendingPermission(null);
      setPermissionResolved(null);
    }, 1000);
  }, [appServerApproval, appServerPermission, pendingPermission, respondToApproval, setPendingApprovalSessionId]);

  const handleAppServerRequestResponse = useCallback(async (input: AppServerRequestResponseInput) => {
    if (!appServerApproval) {
      throw new Error('没有待处理的 app-server request');
    }
    await respondToServerRequest(input, appServerApproval.requestId);
    setPendingApprovalSessionId('');
  }, [appServerApproval, respondToServerRequest, setPendingApprovalSessionId]);

  const handleGoalStatusChange = useCallback((status: ThreadGoalStatus) => {
    const goal = createdSessionId ? goalsByThreadId[createdSessionId]?.data : null;
    if (!goal) return;
    void setThreadGoal({ threadId: goal.threadId, status }).catch((error) => {
      setErrorBanner({ message: 'Goal update failed', description: error instanceof Error ? error.message : String(error) });
    });
  }, [goalsByThreadId, createdSessionId, setThreadGoal]);

  const handleGoalEdit = useCallback(() => {
    const goal = createdSessionId ? goalsByThreadId[createdSessionId]?.data : null;
    if (!goal) return;
    const objective = window.prompt('Edit goal', goal.objective);
    if (objective === null) return;
    const trimmed = objective.trim();
    if (!trimmed) return;
    void setThreadGoal({
      threadId: goal.threadId,
      objective: trimmed,
      status: editedGoalStatus(goal.status),
      tokenBudget: goal.tokenBudget,
    }).catch((error) => {
      setErrorBanner({ message: 'Goal update failed', description: error instanceof Error ? error.message : String(error) });
    });
  }, [goalsByThreadId, createdSessionId, setThreadGoal]);

  const handleGoalClear = useCallback(() => {
    const goal = createdSessionId ? goalsByThreadId[createdSessionId]?.data : null;
    if (!goal) return;
    void clearThreadGoal(goal.threadId).catch((error) => {
      setErrorBanner({ message: 'Goal clear failed', description: error instanceof Error ? error.message : String(error) });
    });
  }, [goalsByThreadId, clearThreadGoal, createdSessionId]);

  const sendFirstMessage = useCallback(
    async (content: string, files?: FileAttachment[], systemPromptAppend?: string, displayOverride?: string, mentions?: MentionRef[], selectedSkills?: readonly SkillInputReference[], modeOverride?: string, forceNewThread = false) => {
      // Each early-out below is a NOT-delivered case: return false so the
      // composer preserves the user's text + attachments instead of letting
      // PromptInput clear a first-message screenshot that never got sent (#615).
      if (isStreaming) return false;
      if (appServerApproval) return false;

      // Wait for model/provider to be resolved from the global default before allowing send
      if (!modelReady) return false;

      // Block send when the runtime-filtered API returned an empty group
      // list — user has providers but none are compatible with the
      // active runtime. Without this gate, sendFirstMessage would post
      // `model: '', provider_id: ''` to /api/chat/sessions and the server
      // would resolve them via the env-default chain, silently bypassing
      // the runtime gate that just hid every option in the picker.
      if (noCompatibleProvider) {
        setErrorBanner({
          message: t('error.providerUnavailable'),
          description: t('chat.empty.noProvider'),
        });
        return false; // not delivered → preserve composer (#615)
      }

      // Require a project directory before sending
      if (!workingDir.trim()) {
        setErrorBanner({ message: t('chat.empty.noDirectory') });
        return false; // not delivered → preserve composer (#615)
      }

      if (!canSendWithCurrentProvider) {
        setErrorBanner({
          message: t('error.providerUnavailable'),
          description: t('chat.empty.noProvider'),
        });
        return false; // not delivered → preserve composer (#615)
      }

      // #615 remount fix: do NOT flip isStreaming / push the optimistic bubble
      // yet. Either flips `isNewChat` (messages.length === 0 && !isStreaming),
      // which swaps the whole layout ternary — the composer moves from the
      // centered hero branch to the active-layout branch (a DIFFERENT parent), so
      // MessageInput remounts and PromptInput loses the attachment, BEFORE we even
      // learn the send failed. Defer those flips to the post-accept point so a
      // pre-acceptance failure leaves the hero (and the screenshot) untouched.
      if (firstSendInFlightRef.current) return false; // double-submit guard while mid-flight
      firstSendInFlightRef.current = true;

      // #615: tracks whether the message reached a delivered / recoverable state
      // (session created + POST /api/chat accepted). A failure BEFORE this must
      // return false so the composer preserves the user's text + attachments —
      // otherwise a session-create 500 silently eats the screenshot.
      let accepted = false;
      let handoffToAppServerTurn = false;

      try {
        const existingThreadId = forceNewThread ? undefined : getExistingNewChatThreadId(createdSessionId);
        const messageSessionId = existingThreadId || `app-server-${Date.now()}`;
        if (!existingThreadId) {
          setCreatedSessionId(messageSessionId);
        }

        const acceptedTurn = existingThreadId
          ? await sendTurnInThread({
              threadId: existingThreadId,
              content,
              files,
              cwd: workingDir.trim(),
              model: currentModel,
              effort: selectedEffort,
              mode: modeOverride ?? mode,
              permissionProfile,
              skills: selectedSkills,
            })
          : await sendOneTurn({
              content,
              files,
              cwd: workingDir.trim(),
              model: currentModel,
              effort: selectedEffort,
              mode: modeOverride ?? mode,
              permissionProfile,
              skills: selectedSkills,
            });

        accepted = true;
        if (initialSkillKeyRef.current) setConsumedSkillKey(initialSkillKeyRef.current);
        // #4/#5 — clear the persisted composer draft at accept. The imminent
        // isStreaming flip REMOUNTS the composer, which re-seeds inputValue from
        // this draft (the only composer state surviving the remount); without
        // clearing it the just-sent text lingers all turn (CDP repro).
        try { sessionStorage.removeItem(composerDraftKey()); } catch { /* unavailable */ }
        // #4/#5 (Codex P2) — also mark the URL prefill consumed so the remount's
        // `initialValue` (which outranks the draft) doesn't re-seed the sent text.
        if (prefillTextRef.current) setConsumedPrefill(prefillTextRef.current);

        // Flip the layout-driving state ONLY now: show streaming + push the
        // optimistic user bubble. Deferring to here keeps `isNewChat` true
        // through any pre-acceptance failure, so the composer never remounts and
        // the screenshot survives (#615).
        streamingStartedAtRef.current = Date.now();
        setIsStreaming(true);
        setStreamingContent('');
        setToolUses([]);
        setToolResults([]);
        setStatusText(undefined);
        {
          // Optimistic user bubble — preserves base64 `data` so images render
          // their thumbnail immediately (backend strips `data` before persisting).
          const displayUserContent = displayOverride || content;
          const contentWithFileMeta = files && files.length > 0
            ? `<!--files:${JSON.stringify(files.map(f => ({ id: f.id, name: f.name, type: f.type, size: f.size, data: f.data })))}-->${displayUserContent}`
            : displayUserContent;
          const userMessage: Message = {
            id: `temp-user-${acceptedTurn.turnId}`,
            session_id: acceptedTurn.threadId || messageSessionId,
            role: 'user',
            content: contentWithFileMeta,
            created_at: new Date().toISOString(),
            token_usage: null,
          };
          setMessages((prev) => existingThreadId ? [...prev, userMessage] : [userMessage]);
          publishCrossClientUserMessage({
            threadId: userMessage.session_id,
            turnId: acceptedTurn.turnId,
            isNewThread: !existingThreadId,
            message: userMessage,
          });
        }
        if (acceptedTurn.threadId) {
          setCreatedSessionId(acceptedTurn.threadId);
          if (!existingThreadId) {
            router.push(`/chat/${encodeURIComponent(acceptedTurn.threadId)}`);
          }
        }
        handoffToAppServerTurn = true;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setStatusText('已停止');
        } else {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          setErrorBanner({ message: t('error.sessionCreateFailed'), description: errMsg });
        }
        // #615: a failure BEFORE the message was accepted for delivery (session
        // creation or POST /api/chat rejected) must preserve the composer so the
        // user's screenshot isn't cleared. Post-acceptance errors (mid-stream)
        // keep today's behavior — the message already went, so the composer clears.
        if (!accepted) return false;
      } finally {
        if (!handoffToAppServerTurn) {
          setIsStreaming(false);
          setStreamingContent('');
          setStreamingThinkingContent('');
          setToolUses([]);
          setToolResults([]);
          setStreamingToolOutput('');
          setStatusText(undefined);
          streamingStartedAtRef.current = 0;
          setPendingPermission(null);
          setPermissionResolved(null);
          setPendingApprovalSessionId('');
          abortControllerRef.current = null;
          firstSendInFlightRef.current = false;
        }
      }
    },
    [isStreaming, appServerApproval, workingDir, currentModel, currentProviderId, selectedEffort, mode, permissionProfile, setPendingApprovalSessionId, t, canSendWithCurrentProvider, modelReady, noCompatibleProvider, createdSessionId, sendOneTurn, sendTurnInThread, publishCrossClientUserMessage, router]
  );

  const appServerGoal = createdSessionId ? goalsByThreadId[createdSessionId] ?? null : null;

  const handleCommand = useCallback((command: string) => {
    if (command === '/plan') {
      setMode('plan');
      return;
    }
    if (command === '/goal' || command.startsWith('/goal ')) {
      const action = command.slice('/goal'.length).trim();
      const appendGoalMessage = (content: string) => {
        const message: Message = {
          id: 'cmd-' + Date.now(),
          session_id: createdSessionId || '',
          role: 'assistant',
          content,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        setMessages((prev) => [...prev, message]);
      };
      if (!action) {
        appendGoalMessage(appServerGoal ? goalSummaryLines(appServerGoal.data).join('\n') : 'No goal set.');
        return;
      }
      if (action === 'pause') {
        handleGoalStatusChange('paused');
        return;
      }
      if (action === 'resume') {
        handleGoalStatusChange('active');
        return;
      }
      if (action === 'clear') {
        handleGoalClear();
        return;
      }
      if (action === 'edit') {
        handleGoalEdit();
        return;
      }
      void (async () => {
        try {
          let threadId = getExistingNewChatThreadId(createdSessionId);
          if (!threadId) {
            if (!modelReady) {
              appendGoalMessage('Wait for model list before setting a goal.');
              return;
            }
            if (!workingDir.trim()) {
              setErrorBanner({ message: t('chat.empty.noDirectory') });
              return;
            }
            const response = await startThread({
              cwd: workingDir.trim(),
              model: currentModel,
              mode,
              permissionProfile,
            });
            threadId = response.thread.id;
            setCreatedSessionId(threadId);
          }
          await setThreadGoal({ threadId, objective: action, status: 'active' });
        } catch (error) {
          setErrorBanner({
            message: 'Goal update failed',
            description: error instanceof Error ? error.message : String(error),
          });
        }
      })();
      return;
    }

    switch (command) {
      case '/help': {
        const helpMessage: Message = {
          id: 'cmd-' + Date.now(),
          session_id: '',
          role: 'assistant',
          content: `## Available Commands\n\n- **/help** - Show this help message\n- **/clear** - Clear conversation history\n- **/compact** - Compress conversation context\n- **/cost** - Show token usage statistics\n- **/doctor** - Check system health\n- **/init** - Initialize CLAUDE.md\n- **/review** - Start code review\n- **/terminal-setup** - Configure terminal\n\n**Tips:**\n- Type \`@\` to mention files\n- Use Shift+Enter for new line\n- Select a project folder to enable file operations`,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        setMessages(prev => [...prev, helpMessage]);
        break;
      }
      case '/clear':
        setMessages([]);
        break;
      case '/cost': {
        const costMessage: Message = {
          id: 'cmd-' + Date.now(),
          session_id: '',
          role: 'assistant',
          content: `## Token Usage\n\nToken usage tracking is available after sending messages. Check the token count displayed at the bottom of each assistant response.`,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        setMessages(prev => [...prev, costMessage]);
        break;
      }
      default:
        sendFirstMessage(command);
    }
  }, [appServerGoal, createdSessionId, currentModel, handleGoalClear, handleGoalEdit, handleGoalStatusChange, mode, modelReady, sendFirstMessage, setThreadGoal, startThread, t, workingDir]);

  // New-chat layout (2026-05-21): when there are no messages and no
  // streaming, replace the bottom-pinned composer + top scrolling
  // message list with a centered hero block — welcome greeting + logo,
  // composer in the middle, optional onboarding cards below. Mirrors
  // the ChatGPT / Claude / Codex new-chat pattern. Once the user
  // sends the first message (messages.length > 0 OR isStreaming),
  // we fall back to the traditional list-above + composer-below layout.
  const isNewChat = messages.length === 0 && !isStreaming;
  const needsOnboardingCards = !workingDir.trim() || !hasSendableProviderForCurrentRuntime;

  const chatEmptyStateNode = (
    <ChatEmptyState
      hasDirectory={!!workingDir.trim()}
      hasProvider={hasSendableProviderForCurrentRuntime}
      onSelectFolder={handleSelectFolder}
      recentProjects={recentProjects}
      onSelectProject={handleSelectProject}
    />
  );
  const appServerFinalTurnKey =
    appServerTurn && ['completed', 'failed', 'interrupted'].includes(appServerTurn.status)
      ? `${appServerTurn.threadId}:${appServerTurn.turnId}:${appServerTurn.status}`
      : '';
  const planImplementationPrompt = useMemo(() => {
    const prompt = selectPlanImplementationPrompt({
      mode,
      isHistoryReplay: !appServerFinalTurnKey || livePlanPromptTurnKey !== appServerFinalTurnKey,
      turnCompleted: appServerTurn?.status === 'completed',
      proposedPlanMarkdown: appServerTurn?.latestProposedPlanMarkdown,
      hasQueuedMessage: false,
      defaultModeAvailable: true,
    });
    if (!prompt || dismissedPlanPromptKey === appServerFinalTurnKey) return null;
    return prompt;
  }, [appServerFinalTurnKey, appServerTurn, dismissedPlanPromptKey, livePlanPromptTurnKey, mode]);
  const appServerProcessBlocks = useMemo(
    () => appServerTurn ? appServerTurnToMessageBlocks(appServerTurn) : [],
    [appServerTurn],
  );

  // Single composer stack — reused in both the new-chat hero (centered)
  // and the active-chat layout (bottom-pinned). Avoids duplicating
  // ErrorBanner / RunCheckpoint / PermissionPrompt / MessageInput /
  // ChatComposerActionBar across two branches.
  const composerStack = (
    <>
      {/* #615: stable keys so MessageInput keeps its identity (and PromptInput
          keeps its attachment state) when ErrorBanner appears/disappears as a
          sibling. The dominant remount cause — the isNewChat layout swap — is
          fixed by deferring the layout-flip until accept (see sendFirstMessage);
          these keys cover the within-parent ErrorBanner toggle. */}
      {errorBanner && (
        <ErrorBanner
          key="composer-error-banner"
          message={errorBanner.message}
          description={errorBanner.description}
          className="mx-4 mb-2"
          onDismiss={() => setErrorBanner(null)}
          actions={[
            { label: t('error.retry'), onClick: () => setErrorBanner(null) },
          ]}
        />
      )}
      {planImplementationPrompt && (
        <PlanImplementationPromptBar
          key="composer-plan-implementation"
          prompt={planImplementationPrompt}
          disabled={isStreaming}
          onImplement={(message) => {
            if (appServerFinalTurnKey) setDismissedPlanPromptKey(appServerFinalTurnKey);
            setMode('code');
            void sendFirstMessage(message, undefined, undefined, undefined, undefined, undefined, 'code');
          }}
          onClearContextImplement={(message) => {
            if (appServerFinalTurnKey) setDismissedPlanPromptKey(appServerFinalTurnKey);
            setMode('code');
            void sendFirstMessage(message, undefined, undefined, undefined, undefined, undefined, 'code', true);
          }}
          onStay={() => {
            if (appServerFinalTurnKey) setDismissedPlanPromptKey(appServerFinalTurnKey);
          }}
        />
      )}
      {appServerGoal && (
        <GoalProgressRow
          key="composer-goal-progress"
          goal={appServerGoal.data}
          sourceBreadcrumb={appServerGoal.source}
          disabled={isStreaming}
          onStatusChange={handleGoalStatusChange}
          onEdit={handleGoalEdit}
          onClear={handleGoalClear}
        />
      )}
      <RunCheckpoint key="composer-run-checkpoint" reasons={checkpointReasons} className="mb-2" onAction={handleCheckpointAction} />
      <PermissionPrompt
        key="composer-permission-prompt"
        pendingPermission={visiblePendingPermission}
        permissionResolved={permissionResolved}
        onPermissionResponse={handlePermissionResponse}
        toolUses={toolUses}
      />
      <AppServerRequestPrompt
        key="composer-app-server-request-prompt"
        request={appServerApproval}
        onRespond={handleAppServerRequestResponse}
      />
      {isNewChat && (
        <NewChatProjectSelector
          currentProject={workingDir}
          projects={projectOptions}
          onSelectProject={handleSelectProject}
          onClearProject={handleClearProject}
          onCreateProject={handleSelectFolder}
        />
      )}
      <PerformanceProfiler id="MessageInput">
        <MessageInput
        key="composer-message-input"
        sessionId={createdSessionId}
        onSend={sendFirstMessage}
        onCommand={handleCommand}
        onStop={stopStreaming}
        disabled={!modelReady || noCompatibleProvider || !!appServerApproval}
        isStreaming={isStreaming}
        modelName={currentModel}
        onModelChange={setCurrentModel}
        providerId={currentProviderId}
        permissionProfile={permissionProfile}
        onPermissionChange={handlePermissionProfileChange}
        codexOnly
        onProviderModelChange={(pid, model, opts) => {
          setCurrentProviderId(pid);
          if (opts?.isAuto) {
            setCurrentModel(model);
            return;
          }
          handleThreadModelChange(model);
          setInvalidDefault(null);
          setNoCompatibleProvider(false);
        }}
        workingDirectory={workingDir}
        effort={selectedEffort}
        onEffortChange={handleThreadEffortChange}
        initialValue={effectivePrefill}
        initialSkill={effectiveInitialSkill}
        onPendingContextTokensChange={setPendingContextTokens}
        contextWindowUsage={contextWindowUsage}
        onModeChange={setMode}
        modeChangeDisabled={isStreaming}
        blockingReasonIds={blockingReasonIds}
        />
      </PerformanceProfiler>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {isNewChat ? (
        // Centered new-chat hero: welcome → composer → onboarding cards
        // as one vertically-centered max-w-3xl block. Mirrors ChatGPT /
        // Claude / Codex new-chat pattern.
        <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-4 py-8">
          <div className="w-full max-w-3xl">
            <NewChatWelcome />
            {composerStack}
            {needsOnboardingCards && <div className="mt-4">{chatEmptyStateNode}</div>}
          </div>
        </div>
      ) : (
        <>
          <PerformanceProfiler id="MessageList">
            <MessageList
              messages={messages}
              streamingContent={streamingContent}
              streamingThinkingContent={streamingThinkingContent}
              isStreaming={isStreaming}
              sessionId={createdSessionId}
              toolUses={toolUses}
              toolResults={toolResults}
              streamingToolOutput={streamingToolOutput}
              processBlocks={appServerProcessBlocks}
              planBlocks={appServerTurn?.planBlocks}
              statusText={statusText}
              retryStatus={appServerTurn?.retryStatus}
              startedAt={streamingStartedAtRef.current}
            />
          </PerformanceProfiler>
          {composerStack}
        </>
      )}
      <FolderPicker
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={handleFolderPickerSelect}
      />
    </div>
  );
}
