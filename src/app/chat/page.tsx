'use client';

import { Suspense, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Message, PermissionRequestEvent, FileAttachment, MentionRef, PermissionProfile } from '@/types';
import { MessageList } from '@/components/chat/MessageList';
import { MessageInput, composerDraftKey } from '@/components/chat/MessageInput';
import { ChatComposerActionBar } from '@/components/chat/ChatComposerActionBar';
import type { ChatRuntime } from '@/lib/chat-runtime-shared';
import { PermissionPrompt } from '@/components/chat/PermissionPrompt';
import { ChatEmptyState } from '@/components/chat/ChatEmptyState';
import { NewChatWelcome } from '@/components/chat/NewChatWelcome';
import { RunCockpit } from '@/components/chat/RunCockpit';
import { RunCheckpoint } from '@/components/chat/RunCheckpoint';
import { ErrorBanner } from '@/components/ui/error-banner';
import { buildCheckpoints } from '@/lib/run-checkpoint';
// 聊天首屏内存约束（2026-05-09）：NewChatPage 不得静态引用
// useOverviewData。RunCheckpoint 只承载“本次能否发送”的会话级原因；
// 全局健康信息属于 /settings/codex 和懒加载的 RunCockpit 弹层。
import { FolderPicker } from '@/components/chat/FolderPicker';
import { useNativeFolderPicker } from '@/hooks/useNativeFolderPicker';
import { useTranslation } from '@/hooks/useTranslation';
import { usePanel } from '@/hooks/usePanel';
import { useAppServerActions, useAppServerState } from '@/codex-web/AppServerProvider';
import {
  deriveCodexWebToolState,
  type CodexWebToolResultInfo,
  type CodexWebToolUseInfo,
} from '@/codex-web/tool-adapter';

const DEFAULT_CODEX_PROVIDER_ID = 'codex_account';
const DEFAULT_CODEX_MODEL = 'gpt-5.5';
const DEFAULT_CODEX_RUNTIME = 'codex_runtime' satisfies ChatRuntime;

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
  const searchParams = useSearchParams();
  const prefillText = searchParams.get('prefill') || '';
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
  const { setPendingApprovalSessionId } = usePanel();
  const appServerState = useAppServerState();
  const { sendOneTurn, interruptTurn, respondToApproval } = useAppServerActions();
  const { t } = useTranslation();
  const { isElectron, openNativePicker } = useNativeFolderPicker();
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThinkingContent, setStreamingThinkingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolUses, setToolUses] = useState<CodexWebToolUseInfo[]>([]);
  const [toolResults, setToolResults] = useState<CodexWebToolResultInfo[]>([]);
  const [statusText, setStatusText] = useState<string | undefined>();
  const [workingDir, setWorkingDir] = useState('');
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
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
  // Codex-only 新建聊天：先用稳定默认值占位，再用 /api/codex/models 校正。
  const [modelReady, setModelReady] = useState(false);
  const [currentModel, setCurrentModel] = useState(DEFAULT_CODEX_MODEL);
  const [currentProviderId, setCurrentProviderId] = useState(DEFAULT_CODEX_PROVIDER_ID);
  const [pendingPermission, setPendingPermission] = useState<PermissionRequestEvent | null>(null);
  const [permissionResolved, setPermissionResolved] = useState<'allow' | 'deny' | 'timeout' | null>(null);
  const [streamingToolOutput, setStreamingToolOutput] = useState('');
  const [permissionProfile, setPermissionProfile] = useState<PermissionProfile>('request_approval');
  const [pendingContextTokens, setPendingContextTokens] = useState(0);
  // 上下文 token 按来源拆分（附件 / mention / 目录），供 RunCockpit 弹层展示。
  const [pendingContextSubTotals, setPendingContextSubTotals] = useState<
    import('@/lib/message-input-logic').PendingContextSubTotals | undefined
  >(undefined);

  const canSendWithCurrentProvider = useMemo(() => {
    return currentProviderId === DEFAULT_CODEX_PROVIDER_ID && !!currentModel;
  }, [currentProviderId, currentModel]);

  const hasSendableProviderForCurrentRuntime = useMemo(() => {
    if (!modelReady) return true; // 仍在加载时不闪现空状态。
    return canSendWithCurrentProvider;
  }, [modelReady, canSendWithCurrentProvider]);

  const runtimePin: ChatRuntime = DEFAULT_CODEX_RUNTIME;
  const sessionRuntimeParam: ChatRuntime = DEFAULT_CODEX_RUNTIME;

  // Run Checkpoint signals — session-scoped only, no global health.
  //
  // Phase 2 originally pulled the full `useOverviewData()` snapshot
  // here so RunCheckpoint and RunCockpit could "agree on the same
  // numbers". That coupling cost the chat first paint a fan-out of
  // /api fetches plus a static compile-graph reach into Settings
  // Overview / runtime/effective / provider catalog. The 2026-05-09
  // memory cut moves global health (provider count / models enabled /
  // workspace state / global default invalid / runtime fallback) out
  // of this surface entirely — RunCockpit's lazy popover still shows
  // them when the user opens it, /settings/health is the canonical
  // dashboard. RunCheckpoint here keeps only the reasons that gate
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
  const abortControllerRef = useRef<AbortController | null>(null);
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
  const appServerTurn = appServerState.activeTurn?.data ?? null;
  const appServerApproval = appServerState.pendingApproval?.data ?? null;
  const visiblePendingPermission = appServerApproval?.permission ?? pendingPermission;

  useEffect(() => {
    if (!appServerTurn) return;
    const toolState = deriveCodexWebToolState(appServerTurn);
    setStreamingContent(appServerTurn.assistantText);
    setToolUses(toolState.toolUses);
    setToolResults(toolState.toolResults);
    setStreamingToolOutput(toolState.streamingToolOutput);
    if (appServerTurn.status === 'running') {
      setStatusText('Codex 正在处理...');
    } else if (appServerTurn.status === 'failed') {
      setStatusText('Codex 处理失败');
    } else if (appServerTurn.status === 'interrupted') {
      setStatusText('Codex 已中断');
    } else if (appServerTurn.status === 'completed') {
      setStatusText(undefined);
    }
  }, [appServerTurn]);

  useEffect(() => {
    setPendingApprovalSessionId(appServerApproval?.threadId ?? '');
  }, [appServerApproval, setPendingApprovalSessionId]);

  useEffect(() => {
    const models = appServerState.models?.data.data.filter((model) => !model.hidden) ?? [];
    if (appServerState.connection.data !== 'connected') {
      setModelReady(false);
      return;
    }

    if (models.length === 0) {
      setCurrentProviderId(DEFAULT_CODEX_PROVIDER_ID);
      setCurrentModel('');
      setNoCompatibleProvider(true);
      setInvalidDefault(null);
      setModelReady(true);
      return;
    }

    const savedProvider = localStorage.getItem('codepilot:last-provider-id');
    const savedModel = savedProvider === DEFAULT_CODEX_PROVIDER_ID
      ? localStorage.getItem('codepilot:last-model')
      : '';
    const selected =
      models.find((model) => savedModel && (model.id === savedModel || model.model === savedModel))?.id ||
      models.find((model) => model.isDefault)?.id ||
      models[0]?.id ||
      DEFAULT_CODEX_MODEL;

    setCurrentProviderId(DEFAULT_CODEX_PROVIDER_ID);
    setCurrentModel(selected);
    setNoCompatibleProvider(false);
    setInvalidDefault(null);
    setModelReady(true);
  }, [appServerState.connection.data, appServerState.models]);

  // Initialize workingDir from localStorage (or setup default), validating the path exists
  useEffect(() => {
    let cancelled = false;

    const validateDir = async (path: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/files/browse?dir=${encodeURIComponent(path)}`);
        return res.ok;
      } catch {
        return false;
      }
    };

    const tryFallbackToDefault = async () => {
      try {
        const res = await fetch('/api/setup');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled || !data?.defaultProject) return;
        if (await validateDir(data.defaultProject) && !cancelled) {
          setWorkingDir(data.defaultProject);
          localStorage.setItem('codepilot:last-working-directory', data.defaultProject);
        }
      } catch { /* ignore */ }
    };

    const init = async () => {
      const saved = localStorage.getItem('codepilot:last-working-directory');
      if (saved) {
        if (await validateDir(saved) && !cancelled) {
          setWorkingDir(saved);
        } else if (!cancelled) {
          // Stale — clear and try setup default
          localStorage.removeItem('codepilot:last-working-directory');
          await tryFallbackToDefault();
        }
      } else {
        await tryFallbackToDefault();
      }
    };

    init();

    const handler = (e: Event) => {
      const path = (e as CustomEvent).detail?.path;
      if (path) setWorkingDir(path);
    };
    window.addEventListener('project-directory-changed', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('project-directory-changed', handler);
    };
  }, []);

  // Load recent projects for empty state
  useEffect(() => {
    fetch('/api/setup/recent-projects')
      .then(r => r.ok ? r.json() : { projects: [] })
      .then(data => setRecentProjects(data.projects || []))
      .catch(() => {});
  }, []);

  const handleSelectFolder = useCallback(async () => {
    if (isElectron) {
      const path = await openNativePicker({ title: t('folderPicker.title') });
      if (path) {
        setWorkingDir(path);
        localStorage.setItem('codepilot:last-working-directory', path);
      }
    } else {
      setFolderPickerOpen(true);
    }
  }, [isElectron, openNativePicker, t]);

  const handleFolderPickerSelect = useCallback((path: string) => {
    setWorkingDir(path);
    localStorage.setItem('codepilot:last-working-directory', path);
    setFolderPickerOpen(false);
  }, []);

  const handleSelectProject = useCallback((path: string) => {
    setWorkingDir(path);
    localStorage.setItem('codepilot:last-working-directory', path);
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
    if (appServerApproval) {
      setPermissionResolved(decision === 'deny' ? 'deny' : 'allow');
      setPendingApprovalSessionId('');
      try {
        await respondToApproval(decision);
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
  }, [appServerApproval, pendingPermission, respondToApproval, setPendingApprovalSessionId]);

  const sendFirstMessage = useCallback(
    async (content: string, files?: FileAttachment[], systemPromptAppend?: string, displayOverride?: string, mentions?: MentionRef[], selectedSkills?: readonly string[]) => {
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

      try {
        const virtualSessionId = `app-server-${Date.now()}`;
        setCreatedSessionId(virtualSessionId);

        accepted = true;
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
            id: 'temp-' + Date.now(),
            session_id: virtualSessionId,
            role: 'user',
            content: contentWithFileMeta,
            created_at: new Date().toISOString(),
            token_usage: null,
          };
          setMessages([userMessage]);
        }

        const completedTurn = await sendOneTurn({
          content,
          cwd: workingDir.trim(),
          model: currentModel,
        });

        if (completedTurn.status === 'failed') {
          throw new Error(completedTurn.errorMessage || 'Codex turn failed');
        }
        if (completedTurn.status === 'interrupted') {
          const assistantMessage: Message = {
            id: 'temp-interrupted-' + Date.now(),
            session_id: completedTurn.threadId || virtualSessionId,
            role: 'assistant',
            content: 'Codex 已中断。可以继续发送下一轮。',
            created_at: new Date().toISOString(),
            token_usage: null,
          };
          setMessages((prev) => [...prev, assistantMessage]);
          return;
        }
        if (completedTurn.assistantText.trim()) {
          const assistantMessage: Message = {
            id: 'temp-assistant-' + Date.now(),
            session_id: completedTurn.threadId || virtualSessionId,
            role: 'assistant',
            content: completedTurn.assistantText.trim(),
            created_at: new Date().toISOString(),
            token_usage: null,
          };
          setMessages((prev) => [...prev, assistantMessage]);
        }
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
        setIsStreaming(false);
        setStreamingContent('');
        setStreamingThinkingContent('');
        setToolUses([]);
        setToolResults([]);
        setStreamingToolOutput('');
        setStatusText(undefined);
        setPendingPermission(null);
        setPermissionResolved(null);
        setPendingApprovalSessionId('');
        abortControllerRef.current = null;
        firstSendInFlightRef.current = false;
      }
    },
    [isStreaming, appServerApproval, workingDir, currentModel, currentProviderId, permissionProfile, setPendingApprovalSessionId, t, canSendWithCurrentProvider, modelReady, noCompatibleProvider, sendOneTurn]
  );

  const handleCommand = useCallback((command: string) => {
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
  }, [sendFirstMessage]);

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
      <RunCheckpoint key="composer-run-checkpoint" reasons={checkpointReasons} className="mb-2" onAction={handleCheckpointAction} />
      <PermissionPrompt
        key="composer-permission-prompt"
        pendingPermission={visiblePendingPermission}
        permissionResolved={permissionResolved}
        onPermissionResponse={handlePermissionResponse}
        toolUses={toolUses}
      />
      <MessageInput
        key="composer-message-input"
        onSend={sendFirstMessage}
        onCommand={handleCommand}
        onStop={stopStreaming}
        disabled={!modelReady || noCompatibleProvider || !!appServerApproval}
        isStreaming={isStreaming}
        modelName={currentModel}
        onModelChange={setCurrentModel}
        providerId={currentProviderId}
        permissionProfile={permissionProfile}
        onPermissionChange={setPermissionProfile}
        runtime={sessionRuntimeParam}
        codexOnly
        onProviderModelChange={(pid, model, opts) => {
          setCurrentProviderId(pid);
          setCurrentModel(model);
          if (opts?.isAuto) return;
          localStorage.setItem('codepilot:last-provider-id', pid);
          localStorage.setItem('codepilot:last-model', model);
          setInvalidDefault(null);
          setNoCompatibleProvider(false);
        }}
        workingDirectory={workingDir}
        effort={selectedEffort}
        onEffortChange={setSelectedEffort}
        initialValue={effectivePrefill}
        onPendingContextTokensChange={setPendingContextTokens}
        onPendingContextSubTotalsChange={setPendingContextSubTotals}
        onModeChange={setMode}
        modeChangeDisabled={isStreaming}
        blockingReasonIds={blockingReasonIds}
      />
      <ChatComposerActionBar
        left={null}
        right={
          <RunCockpit
            providerId={currentProviderId}
            messages={[]}
            modelName={currentModel}
            permissionProfile={permissionProfile}
            pendingContextTokens={pendingContextTokens}
            pendingContextSubTotals={pendingContextSubTotals}
            sessionRuntimePin={runtimePin}
          />
        }
      />
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
          <MessageList
            messages={messages}
            streamingContent={streamingContent}
            streamingThinkingContent={streamingThinkingContent}
            isStreaming={isStreaming}
            sessionId={createdSessionId}
            toolUses={toolUses}
            toolResults={toolResults}
            streamingToolOutput={streamingToolOutput}
            statusText={statusText}
          />
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
