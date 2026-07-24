"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import type { InitializeResponse } from "@/codex/protocol/generated/InitializeResponse";
import type { ReasoningEffort } from "@/codex/protocol/generated/ReasoningEffort";
import type { ConfigReadResponse } from "@/codex/protocol/generated/v2/ConfigReadResponse";
import type { FsReadDirectoryResponse } from "@/codex/protocol/generated/v2/FsReadDirectoryResponse";
import type { FsCreateDirectoryResponse } from "@/codex/protocol/generated/v2/FsCreateDirectoryResponse";
import type { FsReadFileResponse } from "@/codex/protocol/generated/v2/FsReadFileResponse";
import type { FsWriteFileResponse } from "@/codex/protocol/generated/v2/FsWriteFileResponse";
import type { FsRemoveResponse } from "@/codex/protocol/generated/v2/FsRemoveResponse";
import type { FsWatchResponse } from "@/codex/protocol/generated/v2/FsWatchResponse";
import type { GetAccountResponse } from "@/codex/protocol/generated/v2/GetAccountResponse";
import type { AccountLoginCompletedNotification } from "@/codex/protocol/generated/v2/AccountLoginCompletedNotification";
import type { ModelListResponse } from "@/codex/protocol/generated/v2/ModelListResponse";
import type { SkillsListParams } from "@/codex/protocol/generated/v2/SkillsListParams";
import type { SkillsListResponse } from "@/codex/protocol/generated/v2/SkillsListResponse";
import type { SkillsConfigWriteParams } from "@/codex/protocol/generated/v2/SkillsConfigWriteParams";
import type { SkillsConfigWriteResponse } from "@/codex/protocol/generated/v2/SkillsConfigWriteResponse";
import type { ListMcpServerStatusParams } from "@/codex/protocol/generated/v2/ListMcpServerStatusParams";
import type { ListMcpServerStatusResponse } from "@/codex/protocol/generated/v2/ListMcpServerStatusResponse";
import type { McpServerStatus } from "@/codex/protocol/generated/v2/McpServerStatus";
import type { ConfigWriteResponse } from "@/codex/protocol/generated/v2/ConfigWriteResponse";
import type { ThreadListParams } from "@/codex/protocol/generated/v2/ThreadListParams";
import type { ThreadListResponse } from "@/codex/protocol/generated/v2/ThreadListResponse";
import type { ThreadArchiveResponse } from "@/codex/protocol/generated/v2/ThreadArchiveResponse";
import type { ThreadDeleteResponse } from "@/codex/protocol/generated/v2/ThreadDeleteResponse";
import type { ThreadReadParams } from "@/codex/protocol/generated/v2/ThreadReadParams";
import type { ThreadReadResponse } from "@/codex/protocol/generated/v2/ThreadReadResponse";
import type { ThreadRollbackParams } from "@/codex/protocol/generated/v2/ThreadRollbackParams";
import type { ThreadRollbackResponse } from "@/codex/protocol/generated/v2/ThreadRollbackResponse";
import type { ThreadResumeResponse } from "@/codex/protocol/generated/v2/ThreadResumeResponse";
import type { ThreadSetNameParams } from "@/codex/protocol/generated/v2/ThreadSetNameParams";
import type { ThreadSetNameResponse } from "@/codex/protocol/generated/v2/ThreadSetNameResponse";
import type { ThreadUnarchiveResponse } from "@/codex/protocol/generated/v2/ThreadUnarchiveResponse";
import type { ConfigRequirementsReadResponse } from "@/codex/protocol/generated/v2/ConfigRequirementsReadResponse";
import type { ThreadSettingsUpdateResponse } from "@/codex/protocol/generated/v2/ThreadSettingsUpdateResponse";
import type { ThreadStartParams } from "@/codex/protocol/generated/v2/ThreadStartParams";
import type { ThreadStartResponse } from "@/codex/protocol/generated/v2/ThreadStartResponse";
import type { ThreadGoalClearResponse } from "@/codex/protocol/generated/v2/ThreadGoalClearResponse";
import type { ThreadGoalGetResponse } from "@/codex/protocol/generated/v2/ThreadGoalGetResponse";
import type { ThreadGoalSetParams } from "@/codex/protocol/generated/v2/ThreadGoalSetParams";
import type { ThreadGoalSetResponse } from "@/codex/protocol/generated/v2/ThreadGoalSetResponse";
import type { TurnInterruptResponse } from "@/codex/protocol/generated/v2/TurnInterruptResponse";
import type { TurnStartParams } from "@/codex/protocol/generated/v2/TurnStartParams";
import type { TurnStartResponse } from "@/codex/protocol/generated/v2/TurnStartResponse";
import type { ThreadCompactStartResponse } from "@/codex/protocol/generated/v2/ThreadCompactStartResponse";
import type { ReviewStartParams } from "@/codex/protocol/generated/v2/ReviewStartParams";
import type { ReviewStartResponse } from "@/codex/protocol/generated/v2/ReviewStartResponse";
import type { FuzzyFileSearchParams } from "@/codex/protocol/generated/FuzzyFileSearchParams";
import type { FuzzyFileSearchResponse } from "@/codex/protocol/generated/FuzzyFileSearchResponse";
import type { GetAccountRateLimitsResponse } from "@/codex/protocol/generated/v2/GetAccountRateLimitsResponse";
import type { LoginAccountParams } from "@/codex/protocol/generated/v2/LoginAccountParams";
import type { LoginAccountResponse } from "@/codex/protocol/generated/v2/LoginAccountResponse";
import type { CancelLoginAccountResponse } from "@/codex/protocol/generated/v2/CancelLoginAccountResponse";
import type { LogoutAccountResponse } from "@/codex/protocol/generated/v2/LogoutAccountResponse";
import type { JsonRpcId } from "@/codex/protocol/json-rpc";
import { APP_VERSION } from "@/lib/app-version";
import type { FileAttachment, PermissionProfile, SkillInputReference } from "@/types";
import type { MCPServer } from "@/types";
import {
  buildServerRequestResponse,
  mapServerRequestToPendingRequest,
  type AppServerApprovalDecision,
  type AppServerRequestResponseInput,
} from "./approval-adapter";
import {
  enqueueApproval,
  findApprovalByRequestId,
  firstApproval,
  removeApproval,
  sourcedApproval,
} from "./approval-queue-adapter";
import {
  isRunningActiveTurn,
  rememberActiveTurnByThread,
  removeActiveTurnByThread,
  removeStartingActiveTurnByThread,
  sourcedActiveTurn,
} from "./active-turns-adapter";
import {
  beginApprovalResponse,
  completeApprovalResponse,
  failApprovalResponse,
  type ApprovalResponseGuardState,
} from "./approval-response-guard";
import { AppServerBrowserClient } from "./app-server-browser-client";
import { withPlanCollaborationMode } from "./app-server-collaboration-mode";
import { appServerInitializeCapabilities } from "./app-server-capabilities";
import { threadPermissionUpdateOptions, threadRuntimeOptions, turnRuntimeOptions } from "./app-server-runtime-options";
import { resolveCodexBridgeUrl } from "./bridge-url-runtime";
import { initialAppServerState, type CodexWebAppServerState } from "./app-server-state";
import { createAppServerStore, type AppServerStore } from "./app-server-store";
import type {
  ThreadStartParamsWithCollaborationMode,
  TurnStartParamsWithCollaborationMode,
} from "./app-server-request-overrides";
import {
  requestTurnInterrupt,
  selectTurnInterruptParams,
  type InterruptTurnParams,
} from "./interrupt-adapter";
import { buildThreadResumeParams } from "./resume-adapter";
import { activeTurnFromResume } from "./resumed-turn-hydration";
import {
  appServerTurnSnapshotKey,
  createAcceptedTurnState,
  createStartingTurnState,
  initialAppServerTurnState,
  mergeAcceptedTurnState,
  reduceAppServerTurnNotification,
  turnStartedAtMs,
  type AppServerTurnState,
} from "./turn-reducer";
import type {
  ThreadTurnsListParams,
  ThreadTurnsListResponse,
} from "./thread-turns-page-adapter";
import { reduceThreadSettingsNotification } from "./thread-settings-adapter";
import { reduceThreadTokenUsageNotification } from "./thread-token-usage-adapter";
import { reduceMcpStartupNotification } from "./mcp-startup-adapter";
import { mcpServersToConfigValue } from "./mcp-config-adapter";
import { buildThreadModelSettingsUpdate } from "./thread-model-settings";
import { withReasoningEffort } from "./turn-start-request";
import { buildAppServerTurnInput } from "./turn-input";
import { persistAttachments } from "./attachment-persistence";
import { readMatchingFsChangedPaths } from "./app-server-file-watch";
import {
  CROSS_CLIENT_THREAD_ROLLBACK_METHOD,
  CROSS_CLIENT_USER_MESSAGE_METHOD,
  readCrossClientThreadRollback,
  reduceCrossClientUserMessage,
  type CrossClientUserMessage,
} from "./cross-client-sync";
import { reconnectDelayMs } from "./reconnect-policy";
import { readAccountLoginCompletion } from "./account-login-adapter";

const AppServerStoreContext = createContext<AppServerStore | null>(null);
const AppServerActionsContext = createContext<AppServerActions | null>(null);

export type SendOneTurnParams = {
  content: string;
  files?: readonly FileAttachment[];
  cwd: string;
  model?: string;
  effort?: ReasoningEffort;
  mode?: string;
  permissionProfile?: PermissionProfile;
  skills?: readonly SkillInputReference[];
};

export type StartThreadParams = {
  cwd: string;
  model?: string;
  mode?: string;
  permissionProfile?: PermissionProfile;
};

export type ResumeThreadParams = {
  threadId: string;
  cwd?: string;
  model?: string;
  permissionProfile?: PermissionProfile;
};

export type SendTurnInThreadParams = {
  threadId: string;
  content: string;
  files?: readonly FileAttachment[];
  cwd: string;
  model?: string;
  effort?: ReasoningEffort;
  mode?: string;
  permissionProfile?: PermissionProfile;
  onAccepted?: (threadId: string, turnId: string) => void;
  skills?: readonly SkillInputReference[];
};

export type AppServerActions = {
  startThread: (params: StartThreadParams) => Promise<ThreadStartResponse>;
  sendOneTurn: (params: SendOneTurnParams) => Promise<AppServerTurnState>;
  resumeThread: (params: ResumeThreadParams) => Promise<ThreadResumeResponse>;
  sendTurnInThread: (params: SendTurnInThreadParams) => Promise<AppServerTurnState>;
  rollbackThread: (params: ThreadRollbackParams) => Promise<ThreadRollbackResponse>;
  interruptTurn: (params?: InterruptTurnParams) => Promise<void>;
  refreshThreads: () => Promise<ThreadListResponse>;
  listThreads: (params: ThreadListParams) => Promise<ThreadListResponse>;
  setThreadName: (params: ThreadSetNameParams) => Promise<ThreadSetNameResponse>;
  archiveThread: (threadId: string) => Promise<ThreadArchiveResponse>;
  unarchiveThread: (threadId: string) => Promise<ThreadUnarchiveResponse>;
  deleteThread: (threadId: string) => Promise<ThreadDeleteResponse>;
  readThread: (threadId: string, options?: { includeTurns?: boolean }) => Promise<ThreadReadResponse>;
  listThreadTurns: (params: ThreadTurnsListParams) => Promise<ThreadTurnsListResponse>;
  readDirectory: (path: string) => Promise<FsReadDirectoryResponse>;
  createDirectory: (path: string, recursive?: boolean) => Promise<FsCreateDirectoryResponse>;
  readFile: (path: string) => Promise<FsReadFileResponse>;
  writeFile: (path: string, dataBase64: string) => Promise<FsWriteFileResponse>;
  removeFileTree: (path: string) => Promise<FsRemoveResponse>;
  watchFileSystem: (
    path: string,
    onChanged: (changedPaths: string[]) => void,
  ) => Promise<() => Promise<void>>;
  listSkills: (params: SkillsListParams) => Promise<SkillsListResponse>;
  setSkillEnabled: (params: SkillsConfigWriteParams) => Promise<SkillsConfigWriteResponse>;
  refreshConfig: (cwd?: string) => Promise<ConfigReadResponse>;
  writeMcpServers: (servers: Record<string, MCPServer>) => Promise<ConfigReadResponse>;
  reloadMcpServers: () => Promise<void>;
  listMcpServerStatus: (params?: ListMcpServerStatusParams) => Promise<McpServerStatus[]>;
  getThreadGoal: (threadId: string) => Promise<ThreadGoalGetResponse>;
  setThreadGoal: (params: ThreadGoalSetParams) => Promise<ThreadGoalSetResponse>;
  clearThreadGoal: (threadId: string) => Promise<ThreadGoalClearResponse>;
  respondToApproval: (decision: AppServerApprovalDecision, requestId?: JsonRpcId) => Promise<void>;
  respondToServerRequest: (input: AppServerRequestResponseInput, requestId?: JsonRpcId) => Promise<void>;
  resetTurn: () => void;
  updateThreadPermissions: (params: { threadId: string; cwd: string; permissionProfile: PermissionProfile }) => Promise<void>;
  updateThreadModelSettings: (params: { threadId: string; model?: string; effort?: ReasoningEffort }) => Promise<void>;
  compactThread: (threadId: string) => Promise<ThreadCompactStartResponse>;
  startReview: (params: ReviewStartParams) => Promise<ReviewStartResponse>;
  fuzzyFileSearch: (params: FuzzyFileSearchParams) => Promise<FuzzyFileSearchResponse>;
  updateMemorySettings: (params: { threadId?: string; useMemories: boolean; generateMemories: boolean }) => Promise<void>;
  readAccountRateLimits: () => Promise<GetAccountRateLimitsResponse>;
  refreshAccount: () => Promise<GetAccountResponse>;
  startAccountLogin: (params: LoginAccountParams) => Promise<LoginAccountResponse>;
  cancelAccountLogin: (loginId: string) => Promise<CancelLoginAccountResponse>;
  logoutAccount: () => Promise<LogoutAccountResponse>;
  publishCrossClientUserMessage: (event: CrossClientUserMessage) => void;
};

export function AppServerProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<AppServerStore | null>(null);
  if (!storeRef.current) storeRef.current = createAppServerStore(initialAppServerState);
  const store = storeRef.current;
  const setState = store.setState;
  const publicBridgeUrl = useMemo(() => process.env.NEXT_PUBLIC_CODEX_BRIDGE_URL ?? "", []);
  const clientRef = useRef<AppServerBrowserClient | null>(null);
  const fsWatchSequenceRef = useRef(0);
  const threadSettingsWaitersRef = useRef(new Map<string, Set<() => void>>());
  const approvalResponseStateRef = useRef<ApprovalResponseGuardState>({});

  useEffect(() => {
    let disposed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;
    let bootstrapping = false;
    const client = new AppServerBrowserClient();
    clientRef.current = client;
    client.onClose((error) => {
      if (disposed) return;
      const message = error.message;
      setState((current) => ({
        ...current,
        connection: { source: "web-bridge", data: "reconnecting" },
        pendingApprovals: [],
        pendingApproval: null,
        diagnostics: appendDiagnostic(current.diagnostics, {
          source: "web-bridge",
          data: { message },
        }),
      }));
      scheduleReconnect();
    });
    client.onServerRequest((request) => {
      const approval = mapServerRequestToPendingRequest(request);
      if (!approval) {
        client.respondError(request.id, `Codex Web 暂不支持 app-server request: ${request.method}`);
        setState((current) => ({
          ...current,
          diagnostics: appendDiagnostic(current.diagnostics, {
            source: "app-server.serverRequest",
            data: request,
          }),
        }));
        return;
      }

      setState((current) => {
        const pendingApprovals = enqueueApproval(current.pendingApprovals, approval);
        return {
          ...current,
          pendingApprovals,
          pendingApproval: sourcedApproval(firstApproval(pendingApprovals)),
          diagnostics: appendDiagnostic(current.diagnostics, {
            source: "app-server.serverRequest",
            data: request,
          }),
        };
      });
    });

    client.onNotification((notification) => {
      const accountLoginCompletion = readAccountLoginCompletion(notification);
      if (notification.method === CROSS_CLIENT_THREAD_ROLLBACK_METHOD) {
        const rollback = readCrossClientThreadRollback(notification);
        if (rollback) {
          setState((current) => ({
            ...current,
            crossClientUserMessagesByThreadId: {
              ...current.crossClientUserMessagesByThreadId,
              [rollback.threadId]: (current.crossClientUserMessagesByThreadId[rollback.threadId] ?? [])
                .slice(0, -rollback.numTurns),
            },
            latestCrossClientUserMessage:
              current.latestCrossClientUserMessage?.threadId === rollback.threadId
                ? null
                : current.latestCrossClientUserMessage,
            latestCrossClientThreadRollback: rollback,
          }));
        }
        return;
      }
      if (notification.method === CROSS_CLIENT_USER_MESSAGE_METHOD) {
        setState((current) => {
          const crossClientState = reduceCrossClientUserMessage({
            byThreadId: current.crossClientUserMessagesByThreadId,
            latest: current.latestCrossClientUserMessage,
          }, notification);
          if (
            crossClientState.byThreadId === current.crossClientUserMessagesByThreadId &&
            crossClientState.latest === current.latestCrossClientUserMessage
          ) {
            return current;
          }
          return {
            ...current,
            crossClientUserMessagesByThreadId: crossClientState.byThreadId,
            latestCrossClientUserMessage: crossClientState.latest,
          };
        });
        return;
      }
      if (notification.method === "thread/settings/updated") {
        const params = notification.params as { threadId?: string } | undefined;
        const threadId = params?.threadId;
        if (threadId) {
          const waiters = threadSettingsWaitersRef.current.get(threadId);
          if (waiters) {
            waiters.forEach((resolve) => resolve());
            threadSettingsWaitersRef.current.delete(threadId);
          }
        }
      }
      if (
        notification.method === "account/updated" ||
        accountLoginCompletion?.success
      ) {
        void client.request("account/read", { refreshToken: true })
          .then((account) => {
            if (disposed) return;
            setState((current) => ({
              ...current,
              account: {
                source: "app-server.account/read",
                data: account as GetAccountResponse,
              },
            }));
          })
          .catch((error) => {
            if (disposed) return;
            setState((current) => ({
              ...current,
              diagnostics: appendDiagnostic(current.diagnostics, {
                source: "app-server.account/read",
                data: { message: error instanceof Error ? error.message : String(error) },
              }),
            }));
          });
      }
      setState((current) => {
        const threadSettingsByThreadId = reduceThreadSettingsNotification(
          current.threadSettingsByThreadId,
          notification,
        );
        const goalStatePatch = reduceGoalNotification(current, notification);
        const threadTokenUsageByThreadId = reduceThreadTokenUsageNotification(
          current.threadTokenUsageByThreadId,
          notification,
        );
        const mcpStartupByName = reduceMcpStartupNotification(current.mcpStartupByName, notification);
        const notificationTurnIds = readNotificationTurnIds(notification);
        const notificationSnapshot =
          notificationTurnIds.threadId && notificationTurnIds.turnId
            ? current.turnSnapshots[
                appServerTurnSnapshotKey(notificationTurnIds.threadId, notificationTurnIds.turnId)
              ]?.data
            : null;
        const activeTurn = normalizeSnapshotTurn(
          reduceAppServerTurnNotification(
            selectNotificationBaseTurn(current, notificationTurnIds),
            notification,
          ),
          notificationTurnIds,
        );
        const snapshotTurn = normalizeSnapshotTurn(
          reduceAppServerTurnNotification(
            notificationSnapshot ?? selectNotificationBaseTurn(current, notificationTurnIds),
            notification,
          ),
          notificationTurnIds,
        );
        const pendingApprovals = resolvePendingApprovals(current.pendingApprovals, notification);
        const next: CodexWebAppServerState = {
          ...current,
          ...goalStatePatch,
          threadSettingsByThreadId,
          threadTokenUsageByThreadId,
          mcpStartupByName,
          accountLoginCompletion: accountLoginCompletion
            ? {
                source: "app-server.account/login/completed",
                data: accountLoginCompletion as AccountLoginCompletedNotification,
              }
            : current.accountLoginCompletion,
          skillsRevision:
            notification.method === "skills/changed"
              ? current.skillsRevision + 1
              : current.skillsRevision,
          activeTurn: sourcedActiveTurn(activeTurn),
          activeTurnsByThreadId: rememberActiveTurnByThread(current.activeTurnsByThreadId, activeTurn),
          turnSnapshots: rememberTurnSnapshot(current.turnSnapshots, snapshotTurn),
          pendingApprovals,
          pendingApproval: sourcedApproval(firstApproval(pendingApprovals)),
          diagnostics: appendDiagnostic(current.diagnostics, {
            source: "app-server.notification",
            data: notification,
          }),
        };

        return next;
      });
    });

    function scheduleReconnect() {
      if (disposed || reconnectTimer !== null) {
        return;
      }
      const delay = reconnectDelayMs(reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void bootstrap(true);
      }, delay);
    }

    async function bootstrap(isReconnect = false) {
      if (disposed || bootstrapping) {
        return;
      }
      bootstrapping = true;
      setState((current) => ({
        ...current,
        connection: { source: "web-bridge", data: isReconnect ? "reconnecting" : "connecting" },
      }));
      try {
        const latestBridgeUrl = await resolveCodexBridgeUrl(publicBridgeUrl);
        await client.connect(latestBridgeUrl);
        const initialize = (await client.request("initialize", {
          clientInfo: { name: "codex_web", title: "Codex Web", version: APP_VERSION },
          capabilities: appServerInitializeCapabilities(),
        })) as InitializeResponse;
        client.notify("initialized");
        const [models, account, threads, config] = await Promise.all([
          client.request("model/list", { includeHidden: false }) as Promise<ModelListResponse>,
          client.request("account/read", { refreshToken: false }) as Promise<GetAccountResponse>,
          client.request("thread/list", threadListParams()) as Promise<ThreadListResponse>,
          readEffectiveConfig(client),
        ]);

        if (disposed) {
          return;
        }

        reconnectAttempt = 0;
        setState((current) => ({
          ...current,
          connection: { source: "web-bridge", data: "connected" },
          initialize: { source: "app-server.initialize", data: initialize },
          models: { source: "app-server.model/list", data: models },
          account: { source: "app-server.account/read", data: account },
          config: { source: "app-server.config/read", data: config },
          threads: { source: "app-server.thread/list", data: threads },
        }));
      } catch (error) {
        if (disposed) {
          return;
        }
        setState((current) => ({
          ...current,
          connection: { source: "web-bridge", data: "reconnecting" },
          diagnostics: appendDiagnostic(current.diagnostics, {
            source: "web-bridge",
            data: { message: error instanceof Error ? error.message : String(error) },
          }),
        }));
        scheduleReconnect();
      } finally {
        bootstrapping = false;
      }
    }

    void bootstrap();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      clientRef.current = null;
      approvalResponseStateRef.current = {};
      client.close();
    };
  }, [publicBridgeUrl]);

  const resetTurn = useCallback(() => {
    setState((current) => ({
      ...current,
      activeTurn: null,
      activeTurnsByThreadId: {},
      pendingApprovals: [],
      pendingApproval: null,
    }));
  }, []);

  const updateThreadPermissions = useCallback(async ({ threadId, cwd, permissionProfile }: { threadId: string; cwd: string; permissionProfile: PermissionProfile }) => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    const [config, requirements] = await Promise.all([
      readEffectiveConfig(client, cwd),
      client.request("configRequirements/read") as Promise<ConfigRequirementsReadResponse>,
    ]);
    const configDefaultProfile = (config.config as Record<string, unknown>)["default_permissions"];
    const permissions = (typeof configDefaultProfile === "string" ? configDefaultProfile : null)
      ?? requirements.requirements?.defaultPermissions
      ?? null;
    const options = threadPermissionUpdateOptions(permissionProfile, cwd, permissions, config);
    const confirmation = new Promise<void>((resolve) => {
      const waiters = threadSettingsWaitersRef.current.get(threadId) ?? new Set<() => void>();
      waiters.add(resolve);
      threadSettingsWaitersRef.current.set(threadId, waiters);
      window.setTimeout(() => {
        const current = threadSettingsWaitersRef.current.get(threadId);
        if (!current?.has(resolve)) return;
        current.delete(resolve);
        if (current.size === 0) threadSettingsWaitersRef.current.delete(threadId);
        resolve();
      }, 5000);
    });
    await client.request("thread/settings/update", { threadId, ...options }) as ThreadSettingsUpdateResponse;
    await confirmation;
  }, []);

  const updateThreadModelSettings = useCallback(async ({
    threadId,
    model,
    effort,
  }: {
    threadId: string;
    model?: string;
    effort?: ReasoningEffort;
  }) => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    if (!model && !effort) return;

    const confirmation = new Promise<void>((resolve) => {
      const waiters = threadSettingsWaitersRef.current.get(threadId) ?? new Set<() => void>();
      waiters.add(resolve);
      threadSettingsWaitersRef.current.set(threadId, waiters);
      window.setTimeout(() => {
        const current = threadSettingsWaitersRef.current.get(threadId);
        if (!current?.has(resolve)) return;
        current.delete(resolve);
        if (current.size === 0) threadSettingsWaitersRef.current.delete(threadId);
        resolve();
      }, 5000);
    });
    const params = buildThreadModelSettingsUpdate({
      threadId,
      model,
      effort,
      currentSettings: store.getState().threadSettingsByThreadId[threadId]?.data,
    });
    await client.request("thread/settings/update", params) as ThreadSettingsUpdateResponse;
    await confirmation;
  }, [store]);

  const respondToServerRequest = useCallback(async (input: AppServerRequestResponseInput, requestId?: JsonRpcId) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }

    const currentState = store.getState();
    const approval =
      requestId === undefined
        ? currentState.pendingApproval?.data ?? null
        : findApprovalByRequestId(currentState.pendingApprovals, requestId);
    if (!approval) {
      throw new Error("没有待处理的 app-server request");
    }

    const guard = beginApprovalResponse({
      pendingApproval: approval,
      requestId: approval.requestId,
      state: approvalResponseStateRef.current,
    });
    approvalResponseStateRef.current = guard.state;
    if (!guard.ok) {
      setState((current) => ({
        ...current,
        diagnostics: appendDiagnostic(current.diagnostics, {
          source: "app-server.serverRequest",
          data: { message: `server request response skipped: ${guard.reason}` },
        }),
      }));
      throw new Error(`app-server request 已处理或已失效: ${guard.reason}`);
    }

    const response = buildServerRequestResponse(approval, input);
    try {
      client.respond(approval.requestId, response);
      approvalResponseStateRef.current = completeApprovalResponse({
        key: guard.key,
        state: approvalResponseStateRef.current,
      });
      const respondedRequestId = approval.requestId;
      setState((current) => {
        const pendingApprovals = removeApproval(current.pendingApprovals, respondedRequestId);
        return {
          ...current,
          pendingApprovals,
          pendingApproval: sourcedApproval(firstApproval(pendingApprovals)),
        };
      });
    } catch (error) {
      approvalResponseStateRef.current = failApprovalResponse({
        key: guard.key,
        state: approvalResponseStateRef.current,
      });
      throw error;
    }
  }, [store]);

  const respondToApproval = useCallback(
    (decision: AppServerApprovalDecision, requestId?: JsonRpcId) =>
      respondToServerRequest({ type: "approval", decision }, requestId),
    [respondToServerRequest],
  );

  const refreshThreads = useCallback(async () => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }

    const threads = (await client.request("thread/list", threadListParams())) as ThreadListResponse;
    setState((current) => ({
      ...current,
      threads: { source: "app-server.thread/list", data: threads },
    }));
    return threads;
  }, []);

  const listThreads = useCallback(async (params: ThreadListParams) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }
    return (await client.request("thread/list", params)) as ThreadListResponse;
  }, []);

  const setThreadName = useCallback(async (params: ThreadSetNameParams) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }
    const response = (await client.request("thread/name/set", params)) as ThreadSetNameResponse;
    await refreshThreads();
    return response;
  }, [refreshThreads]);

  const archiveThread = useCallback(async (threadId: string) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }
    const response = (await client.request("thread/archive", { threadId })) as ThreadArchiveResponse;
    await refreshThreads();
    return response;
  }, [refreshThreads]);

  const unarchiveThread = useCallback(async (threadId: string) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }
    const response = (await client.request("thread/unarchive", { threadId })) as ThreadUnarchiveResponse;
    await refreshThreads();
    return response;
  }, [refreshThreads]);

  const deleteThread = useCallback(async (threadId: string) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }
    return (await client.request("thread/delete", { threadId })) as ThreadDeleteResponse;
  }, []);

  const readThread = useCallback(async (threadId: string, options?: { includeTurns?: boolean }) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }

    const params: ThreadReadParams = { threadId, includeTurns: options?.includeTurns ?? true };
    const response = (await client.request("thread/read", params)) as ThreadReadResponse;
    setState((current) => ({
      ...current,
      selectedThread: { source: "app-server.thread/read", data: response },
    }));
    return response;
  }, []);

  const listThreadTurns = useCallback(async (params: ThreadTurnsListParams) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }

    return (await client.request("thread/turns/list", params)) as ThreadTurnsListResponse;
  }, []);

  const readDirectory = useCallback(async (path: string) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }
    const normalized = path.trim();
    if (!normalized) {
      throw new Error("目录路径不能为空");
    }
    return (await client.request("fs/readDirectory", { path: normalized })) as FsReadDirectoryResponse;
  }, []);

  const createDirectory = useCallback(async (path: string, recursive = true) => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    return (await client.request("fs/createDirectory", { path, recursive })) as FsCreateDirectoryResponse;
  }, []);

  const readFile = useCallback(async (path: string) => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    return (await client.request("fs/readFile", { path })) as FsReadFileResponse;
  }, []);

  const writeFile = useCallback(async (path: string, dataBase64: string) => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    return (await client.request("fs/writeFile", { path, dataBase64 })) as FsWriteFileResponse;
  }, []);

  const removeFileTree = useCallback(async (path: string) => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    return (await client.request("fs/remove", { path, recursive: true, force: false })) as FsRemoveResponse;
  }, []);

  const watchFileSystem = useCallback(async (
    path: string,
    onChanged: (changedPaths: string[]) => void,
  ) => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    const normalized = path.trim();
    if (!normalized) throw new Error("监听路径不能为空");

    const watchId = `codex-web-fs-${++fsWatchSequenceRef.current}`;
    let active = true;
    const notificationUnsubscribe = client.onNotification((notification) => {
      if (!active) return;
      const changedPaths = readMatchingFsChangedPaths(notification, watchId);
      if (changedPaths) onChanged(changedPaths);
    });

    try {
      await client.request("fs/watch", { watchId, path: normalized }) as FsWatchResponse;
    } catch (error) {
      active = false;
      notificationUnsubscribe();
      throw error;
    }

    return async () => {
      if (!active) return;
      active = false;
      notificationUnsubscribe();
      if (clientRef.current !== client) return;
      await client.request("fs/unwatch", { watchId });
    };
  }, []);

  const listSkills = useCallback(async (params: SkillsListParams) => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    return (await client.request("skills/list", params)) as SkillsListResponse;
  }, []);

  const setSkillEnabled = useCallback(async (params: SkillsConfigWriteParams) => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    return (await client.request("skills/config/write", params)) as SkillsConfigWriteResponse;
  }, []);

  const refreshConfig = useCallback(async (cwd?: string) => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    const config = await readEffectiveConfig(client, cwd);
    setState((current) => ({
      ...current,
      config: { source: "app-server.config/read", data: config },
    }));
    return config;
  }, []);

  const reloadMcpServers = useCallback(async () => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    await client.request("config/mcpServer/reload");
  }, []);

  const writeMcpServers = useCallback(async (servers: Record<string, MCPServer>) => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    await client.request("config/value/write", {
      keyPath: "mcp_servers",
      value: mcpServersToConfigValue(servers),
      mergeStrategy: "replace",
    }) as ConfigWriteResponse;
    await client.request("config/mcpServer/reload");
    const config = await readEffectiveConfig(client);
    setState((current) => ({
      ...current,
      config: { source: "app-server.config/read", data: config },
    }));
    return config;
  }, []);

  const listMcpServerStatus = useCallback(async (params: ListMcpServerStatusParams = {}) => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    const data: McpServerStatus[] = [];
    let cursor = params.cursor ?? null;
    do {
      const response = await client.request("mcpServerStatus/list", {
        ...params,
        cursor,
        limit: params.limit ?? 100,
      }) as ListMcpServerStatusResponse;
      data.push(...response.data);
      cursor = response.nextCursor;
    } while (cursor);
    return data;
  }, []);

  const compactThread = useCallback(async (threadId: string) => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    return await client.request("thread/compact/start", { threadId }) as ThreadCompactStartResponse;
  }, []);

  const startReview = useCallback(async (params: ReviewStartParams) => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    return await client.request("review/start", params) as ReviewStartResponse;
  }, []);

  const fuzzyFileSearch = useCallback(async (params: FuzzyFileSearchParams) => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    return await client.request("fuzzyFileSearch", params) as FuzzyFileSearchResponse;
  }, []);

  const updateMemorySettings = useCallback(async ({ threadId, useMemories, generateMemories }: { threadId?: string; useMemories: boolean; generateMemories: boolean }) => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    await client.request("config/batchWrite", {
      edits: [
        { keyPath: "memories.use_memories", value: useMemories, mergeStrategy: "replace" },
        { keyPath: "memories.generate_memories", value: generateMemories, mergeStrategy: "replace" },
      ],
      reloadUserConfig: true,
    });
    if (threadId) {
      await client.request("thread/memoryMode/set", { threadId, enabled: generateMemories });
    }
    const config = await readEffectiveConfig(client);
    setState((current) => ({ ...current, config: { source: "app-server.config/read", data: config } }));
  }, []);

  const readAccountRateLimits = useCallback(async () => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    return await client.request("account/rateLimits/read") as GetAccountRateLimitsResponse;
  }, []);

  const refreshAccount = useCallback(async () => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    const account = await client.request("account/read", { refreshToken: true }) as GetAccountResponse;
    setState((current) => ({
      ...current,
      account: { source: "app-server.account/read", data: account },
    }));
    return account;
  }, []);

  const startAccountLogin = useCallback(async (params: LoginAccountParams) => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    setState((current) => ({ ...current, accountLoginCompletion: null }));
    return await client.request("account/login/start", params) as LoginAccountResponse;
  }, []);

  const cancelAccountLogin = useCallback(async (loginId: string) => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    return await client.request("account/login/cancel", { loginId }) as CancelLoginAccountResponse;
  }, []);

  const logoutAccount = useCallback(async () => {
    const client = clientRef.current;
    if (!client) throw new Error("Web bridge 尚未连接");
    const response = await client.request("account/logout") as LogoutAccountResponse;
    await refreshAccount();
    return response;
  }, [refreshAccount]);

  const getThreadGoal = useCallback(async (threadId: string) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }

    const response = (await client.request("thread/goal/get", { threadId })) as ThreadGoalGetResponse;
    setState((current) => {
      const goalsByThreadId = { ...current.goalsByThreadId };
      if (response.goal) {
        goalsByThreadId[threadId] = { source: "app-server.thread/goal/get", data: response.goal };
      } else {
        delete goalsByThreadId[threadId];
      }
      return { ...current, goalsByThreadId };
    });
    return response;
  }, []);

  const setThreadGoal = useCallback(async (params: ThreadGoalSetParams) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }

    const response = (await client.request("thread/goal/set", params)) as ThreadGoalSetResponse;
    setState((current) => ({
      ...current,
      goalsByThreadId: {
        ...current.goalsByThreadId,
        [response.goal.threadId]: { source: "app-server.thread/goal/updated", data: response.goal },
      },
    }));
    return response;
  }, []);

  const startThread = useCallback(async ({ cwd, model, mode, permissionProfile = "request_approval" }: StartThreadParams) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }

    const effectiveConfig = await readEffectiveConfig(client, cwd);
    const threadParams: ThreadStartParamsWithCollaborationMode = withPlanCollaborationMode({
      cwd,
      model: model || null,
      threadSource: "codex_web",
      serviceName: "codex_web",
      ...threadRuntimeOptions(permissionProfile, effectiveConfig),
    }, mode, model);
    const response = (await client.request("thread/start", threadParams)) as ThreadStartResponse;
    void refreshThreads().catch(() => undefined);
    return response;
  }, [refreshThreads]);

  const clearThreadGoal = useCallback(async (threadId: string) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }

    const response = (await client.request("thread/goal/clear", { threadId })) as ThreadGoalClearResponse;
    if (response.cleared) {
      setState((current) => {
        const goalsByThreadId = { ...current.goalsByThreadId };
        delete goalsByThreadId[threadId];
        return { ...current, goalsByThreadId };
      });
    }
    return response;
  }, []);

  const resumeThread = useCallback(async ({ threadId, cwd, model, permissionProfile }: ResumeThreadParams) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }

    const runtimeOptions = permissionProfile
      ? threadRuntimeOptions(permissionProfile, await readEffectiveConfig(client, cwd))
      : undefined;
    const response = (await client.request(
      "thread/resume",
      buildThreadResumeParams({
        threadId,
        cwd,
        model,
        runtimeOptions,
      }),
    )) as ThreadResumeResponse;
    const resumedActiveTurn = activeTurnFromResume(response);
    setState((current) => {
      const currentActiveTurn = current.activeTurn?.data;
      const shouldClearCurrent =
        !resumedActiveTurn &&
        currentActiveTurn?.threadId === response.thread.id &&
        isRunningActiveTurn(currentActiveTurn);
      return {
        ...current,
        resumedThread: { source: "app-server.thread/resume", data: response },
        selectedThread: { source: "app-server.thread/resume", data: { thread: response.thread } },
        activeTurn: resumedActiveTurn
          ? sourcedActiveTurn(resumedActiveTurn, "app-server.thread/resume")
          : shouldClearCurrent
            ? null
            : current.activeTurn,
        activeTurnsByThreadId: resumedActiveTurn
          ? rememberActiveTurnByThread(
              current.activeTurnsByThreadId,
              resumedActiveTurn,
              "app-server.thread/resume",
            )
          : removeActiveTurnByThread(current.activeTurnsByThreadId, response.thread.id),
        turnSnapshots: resumedActiveTurn
          ? rememberTurnSnapshot(
              current.turnSnapshots,
              resumedActiveTurn,
              "app-server.thread/resume",
            )
          : current.turnSnapshots,
      };
    });
    return response;
  }, []);

  const sendTurnInThread = useCallback(async ({ threadId, content, files, cwd, model, effort, mode, permissionProfile = "request_approval", onAccepted, skills }: SendTurnInThreadParams) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }
    const trimmed = content.trim();
    if (!trimmed && !files?.length) {
      throw new Error("消息内容不能为空");
    }

    const persistedFiles = await persistTurnAttachments(client, store.getState().initialize?.data, files);
    setState((current) => ({
      ...current,
      ...setActiveTurnState(current, {
        ...createStartingTurnState(),
        threadId,
      }),
    }));

    const effectiveConfig = await readEffectiveConfig(client, cwd);
    const turnParams: TurnStartParamsWithCollaborationMode = withReasoningEffort(
      withPlanCollaborationMode({
        threadId,
        input: buildAppServerTurnInput(trimmed, persistedFiles, skills),
        cwd,
        model: model || null,
        ...turnRuntimeOptions(permissionProfile, cwd, effectiveConfig),
      }, mode, model),
      effort,
    );
    let turnResponse: TurnStartResponse;
    try {
      turnResponse = (await client.request("turn/start", turnParams)) as TurnStartResponse;
    } catch (error) {
      setState((current) => {
        const activeTurn = current.activeTurn?.data;
        if (
          !activeTurn ||
          activeTurn.threadId !== threadId ||
          activeTurn.turnId ||
          activeTurn.status !== "starting"
        ) {
          return current;
        }
        return {
          ...current,
          activeTurn: null,
          activeTurnsByThreadId: removeStartingActiveTurnByThread(current.activeTurnsByThreadId, threadId),
        };
      });
      throw error;
    }
    onAccepted?.(threadId, turnResponse.turn.id);
    const acceptedTurn = createAcceptedTurnState(
      threadId,
      turnResponse.turn.id,
      turnStartedAtMs(turnResponse.turn.startedAt),
    );
    setState((current) => ({
      ...current,
      ...setActiveTurnState(
        current,
        mergeAcceptedTurnState(current.activeTurnsByThreadId[threadId]?.data, acceptedTurn),
      ),
    }));

    void refreshThreads().catch(() => undefined);
    return acceptedTurn;
  }, [refreshThreads, store]);

  const sendOneTurn = useCallback(async ({ content, files, cwd, model, effort, mode, permissionProfile = "request_approval", skills }: SendOneTurnParams) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }
    const trimmed = content.trim();
    if (!trimmed && !files?.length) {
      throw new Error("消息内容不能为空");
    }

    const persistedFiles = await persistTurnAttachments(client, store.getState().initialize?.data, files);
    setState((current) => ({
      ...current,
      activeTurn: { source: "app-server.notification", data: createStartingTurnState() },
    }));

    const effectiveConfig = await readEffectiveConfig(client, cwd);
    const threadParams: ThreadStartParamsWithCollaborationMode = withPlanCollaborationMode({
      cwd,
      model: model || null,
      threadSource: "codex_web",
      serviceName: "codex_web",
      ...threadRuntimeOptions(permissionProfile, effectiveConfig),
    }, mode, model);
    let threadResponse: ThreadStartResponse;
    try {
      threadResponse = (await client.request("thread/start", threadParams)) as ThreadStartResponse;
    } catch (error) {
      setState((current) => {
        const activeTurn = current.activeTurn?.data;
        if (!activeTurn || activeTurn.threadId || activeTurn.turnId || activeTurn.status !== "starting") {
          return current;
        }
        return {
          ...current,
          activeTurn: null,
        };
      });
      throw error;
    }
    const threadId = threadResponse.thread.id;

    setState((current) => ({
      ...current,
      ...setActiveTurnState(current, {
        ...(current.activeTurn?.data ?? createStartingTurnState()),
        threadId,
      }),
    }));

    return sendTurnInThread({ threadId, content: trimmed, files: persistedFiles, cwd, model, effort, mode, permissionProfile, skills });
  }, [sendTurnInThread, store]);

  const interruptTurn = useCallback(async (params?: InterruptTurnParams) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }

    const currentState = store.getState();
    const activeTurn = params?.threadId
      ? currentState.activeTurnsByThreadId[params.threadId]?.data ?? null
      : currentState.activeTurn?.data ?? null;
    const interruptParams = selectTurnInterruptParams({ activeTurn, params });
    if (!interruptParams) {
      return;
    }

    await requestTurnInterrupt(
      (requestParams) => client.request("turn/interrupt", requestParams) as Promise<TurnInterruptResponse>,
      interruptParams,
    );
  }, [store]);

  const publishCrossClientUserMessage = useCallback((event: CrossClientUserMessage) => {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    try {
      client.notify(CROSS_CLIENT_USER_MESSAGE_METHOD, event);
    } catch (error) {
      setState((current) => ({
        ...current,
        diagnostics: appendDiagnostic(current.diagnostics, {
          source: "web-bridge",
          data: { message: error instanceof Error ? error.message : String(error) },
        }),
      }));
    }
  }, []);

  const rollbackThread = useCallback(async (params: ThreadRollbackParams): Promise<ThreadRollbackResponse> => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }
    const response = await client.request("thread/rollback", params) as ThreadRollbackResponse;
    const rollback = {
      eventId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      threadId: params.threadId,
      numTurns: params.numTurns,
    };
    setState((current) => ({
      ...current,
      crossClientUserMessagesByThreadId: {
        ...current.crossClientUserMessagesByThreadId,
        [params.threadId]: (current.crossClientUserMessagesByThreadId[params.threadId] ?? [])
          .slice(0, -params.numTurns),
      },
      latestCrossClientUserMessage:
        current.latestCrossClientUserMessage?.threadId === params.threadId
          ? null
          : current.latestCrossClientUserMessage,
    }));
    client.notify(CROSS_CLIENT_THREAD_ROLLBACK_METHOD, rollback);
    return response;
  }, []);

  const actions = useMemo<AppServerActions>(
    () => ({
      startThread,
      sendOneTurn,
      resumeThread,
      sendTurnInThread,
      rollbackThread,
      interruptTurn,
      refreshThreads,
      listThreads,
      setThreadName,
      archiveThread,
      unarchiveThread,
      deleteThread,
      readThread,
      listThreadTurns,
      readDirectory,
      createDirectory,
      readFile,
      writeFile,
      removeFileTree,
      watchFileSystem,
      listSkills,
      setSkillEnabled,
      refreshConfig,
      writeMcpServers,
      reloadMcpServers,
      listMcpServerStatus,
      getThreadGoal,
      setThreadGoal,
      clearThreadGoal,
      respondToApproval,
      respondToServerRequest,
      resetTurn,
      updateThreadPermissions,
      updateThreadModelSettings,
      compactThread,
      startReview,
      fuzzyFileSearch,
      updateMemorySettings,
      readAccountRateLimits,
      refreshAccount,
      startAccountLogin,
      cancelAccountLogin,
      logoutAccount,
      publishCrossClientUserMessage,
    }),
    [startThread, sendOneTurn, resumeThread, sendTurnInThread, rollbackThread, interruptTurn, refreshThreads, listThreads, setThreadName, archiveThread, unarchiveThread, deleteThread, readThread, listThreadTurns, readDirectory, createDirectory, readFile, writeFile, removeFileTree, watchFileSystem, listSkills, setSkillEnabled, refreshConfig, writeMcpServers, reloadMcpServers, listMcpServerStatus, getThreadGoal, setThreadGoal, clearThreadGoal, respondToApproval, respondToServerRequest, resetTurn, updateThreadPermissions, updateThreadModelSettings, compactThread, startReview, fuzzyFileSearch, updateMemorySettings, readAccountRateLimits, refreshAccount, startAccountLogin, cancelAccountLogin, logoutAccount, publishCrossClientUserMessage],
  );

  return (
    <AppServerStoreContext.Provider value={store}>
      <AppServerActionsContext.Provider value={actions}>
        {children}
      </AppServerActionsContext.Provider>
    </AppServerStoreContext.Provider>
  );
}

export function useAppServerSelector<Selected>(
  selector: (state: CodexWebAppServerState) => Selected,
): Selected {
  const store = useContext(AppServerStoreContext);
  if (!store) {
    throw new Error("useAppServerSelector must be used within AppServerProvider");
  }
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

export function useAppServerActions(): AppServerActions {
  const actions = useContext(AppServerActionsContext);
  if (!actions) {
    throw new Error("useAppServerActions must be used within AppServerProvider");
  }
  return actions;
}

function appendDiagnostic(
  diagnostics: CodexWebAppServerState["diagnostics"],
  entry: CodexWebAppServerState["diagnostics"][number],
): CodexWebAppServerState["diagnostics"] {
  return [...diagnostics, entry].slice(-100);
}

function setActiveTurnState(
  current: CodexWebAppServerState,
  turn: AppServerTurnState,
): Pick<CodexWebAppServerState, "activeTurn" | "activeTurnsByThreadId"> {
  return {
    activeTurn: sourcedActiveTurn(turn),
    activeTurnsByThreadId: rememberActiveTurnByThread(current.activeTurnsByThreadId, turn),
  };
}

function selectNotificationBaseTurn(
  state: CodexWebAppServerState,
  ids: { threadId?: string; turnId?: string },
): AppServerTurnState {
  if (ids.threadId) {
    const activeTurn = state.activeTurnsByThreadId[ids.threadId]?.data;
    if (activeTurn) {
      return activeTurn;
    }
  }

  if (ids.threadId && ids.turnId) {
    const snapshot = state.turnSnapshots[appServerTurnSnapshotKey(ids.threadId, ids.turnId)]?.data;
    if (snapshot) {
      return snapshot;
    }
  }

  if (!ids.threadId && !ids.turnId && state.activeTurn?.data) {
    return state.activeTurn.data;
  }

  return initialAppServerTurnState;
}

function rememberTurnSnapshot(
  snapshots: CodexWebAppServerState["turnSnapshots"],
  turn: AppServerTurnState,
  source: "app-server.notification" | "app-server.thread/resume" = "app-server.notification",
): CodexWebAppServerState["turnSnapshots"] {
  if (!turn.threadId || !turn.turnId) {
    return snapshots;
  }

  return {
    ...snapshots,
    [appServerTurnSnapshotKey(turn.threadId, turn.turnId)]: {
      source,
      data: turn,
    },
  };
}

function normalizeSnapshotTurn(
  turn: AppServerTurnState,
  ids: { threadId?: string; turnId?: string },
): AppServerTurnState {
  return {
    ...turn,
    threadId: ids.threadId ?? turn.threadId,
    turnId: ids.turnId ?? turn.turnId,
  };
}

function readNotificationTurnIds(notification: { params?: unknown }): { threadId?: string; turnId?: string } {
  const params = readRecord(notification.params);
  const turn = readRecord(params.turn);
  const threadId = typeof params.threadId === "string" ? params.threadId : undefined;
  const turnId =
    typeof params.turnId === "string"
      ? params.turnId
      : typeof turn.id === "string"
        ? turn.id
        : undefined;

  return { threadId, turnId };
}

function resolvePendingApprovals(
  pendingApprovals: CodexWebAppServerState["pendingApprovals"],
  notification: { method: string; params?: unknown },
): CodexWebAppServerState["pendingApprovals"] {
  if (notification.method !== "serverRequest/resolved") {
    return pendingApprovals;
  }

  const params = readRecord(notification.params);
  if (typeof params.requestId !== "string" && typeof params.requestId !== "number") {
    return pendingApprovals;
  }
  return removeApproval(pendingApprovals, params.requestId);
}

function reduceGoalNotification(
  current: CodexWebAppServerState,
  notification: { method: string; params?: unknown },
): Pick<CodexWebAppServerState, "goalsByThreadId"> {
  if (notification.method === "thread/goal/updated") {
    const params = readRecord(notification.params);
    const goal = readRecord(params.goal);
    const threadId = typeof params.threadId === "string"
      ? params.threadId
      : typeof goal.threadId === "string"
        ? goal.threadId
        : "";
    if (!threadId || !isThreadGoal(goal)) {
      return { goalsByThreadId: current.goalsByThreadId };
    }
    return {
      goalsByThreadId: {
        ...current.goalsByThreadId,
        [threadId]: { source: "app-server.thread/goal/updated", data: goal },
      },
    };
  }

  if (notification.method === "thread/goal/cleared") {
    const params = readRecord(notification.params);
    if (typeof params.threadId !== "string") {
      return { goalsByThreadId: current.goalsByThreadId };
    }
    const goalsByThreadId = { ...current.goalsByThreadId };
    delete goalsByThreadId[params.threadId];
    return { goalsByThreadId };
  }

  return { goalsByThreadId: current.goalsByThreadId };
}

function isThreadGoal(value: Record<string, unknown>): value is CodexWebAppServerState["goalsByThreadId"][string]["data"] {
  return (
    typeof value.threadId === "string" &&
    typeof value.objective === "string" &&
    (value.status === "active" ||
      value.status === "paused" ||
      value.status === "blocked" ||
      value.status === "usageLimited" ||
      value.status === "budgetLimited" ||
      value.status === "complete") &&
    (typeof value.tokenBudget === "number" || value.tokenBudget === null) &&
    typeof value.tokensUsed === "number" &&
    typeof value.timeUsedSeconds === "number" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  );
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function threadListParams(): ThreadListParams {
  return {
    limit: 50,
    sortKey: "recency_at",
    sortDirection: "desc",
    archived: false,
  };
}

async function readEffectiveConfig(
  client: AppServerBrowserClient,
  cwd?: string,
): Promise<ConfigReadResponse> {
  return (await client.request("config/read", {
    includeLayers: false,
    cwd: cwd?.trim() || null,
  })) as ConfigReadResponse;
}

async function persistTurnAttachments(
  client: AppServerBrowserClient,
  initialize: InitializeResponse | undefined,
  files: readonly FileAttachment[] | undefined,
): Promise<readonly FileAttachment[] | undefined> {
  const needsPersistence = files?.some(
    (file) => !!file.data && !file.filePath && !file.originPath,
  );
  if (!needsPersistence) return files;
  if (!initialize) {
    throw new Error("app-server 尚未返回 CODEX_HOME，无法保存附件");
  }
  return persistAttachments({
    files: files ?? [],
    codexHome: initialize.codexHome,
    platformFamily: initialize.platformFamily,
    request: (method, params) => client.request(method, params),
  });
}
