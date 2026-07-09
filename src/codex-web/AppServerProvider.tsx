"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";

import type { InitializeResponse } from "@/codex/protocol/generated/InitializeResponse";
import type { GetAccountResponse } from "@/codex/protocol/generated/v2/GetAccountResponse";
import type { ModelListResponse } from "@/codex/protocol/generated/v2/ModelListResponse";
import type { ThreadListParams } from "@/codex/protocol/generated/v2/ThreadListParams";
import type { ThreadListResponse } from "@/codex/protocol/generated/v2/ThreadListResponse";
import type { ThreadReadParams } from "@/codex/protocol/generated/v2/ThreadReadParams";
import type { ThreadReadResponse } from "@/codex/protocol/generated/v2/ThreadReadResponse";
import type { ThreadResumeResponse } from "@/codex/protocol/generated/v2/ThreadResumeResponse";
import type { ThreadStartParams } from "@/codex/protocol/generated/v2/ThreadStartParams";
import type { ThreadStartResponse } from "@/codex/protocol/generated/v2/ThreadStartResponse";
import type { TurnInterruptResponse } from "@/codex/protocol/generated/v2/TurnInterruptResponse";
import type { TurnStartParams } from "@/codex/protocol/generated/v2/TurnStartParams";
import type { TurnStartResponse } from "@/codex/protocol/generated/v2/TurnStartResponse";
import {
  buildApprovalResponse,
  mapServerRequestToApproval,
  type AppServerApprovalDecision,
} from "./approval-adapter";
import {
  beginApprovalResponse,
  completeApprovalResponse,
  failApprovalResponse,
  type ApprovalResponseGuardState,
} from "./approval-response-guard";
import { AppServerBrowserClient } from "./app-server-browser-client";
import { initialAppServerState, type CodexWebAppServerState } from "./app-server-state";
import {
  selectTurnInterruptParams,
  type InterruptTurnParams,
} from "./interrupt-adapter";
import { buildThreadResumeParams } from "./resume-adapter";
import {
  createStartingTurnState,
  initialAppServerTurnState,
  reduceAppServerTurnNotification,
  type AppServerTurnState,
} from "./turn-reducer";

const AppServerContext = createContext<CodexWebAppServerState>(initialAppServerState);
const AppServerActionsContext = createContext<AppServerActions | null>(null);

export type SendOneTurnParams = {
  content: string;
  cwd: string;
  model?: string;
};

export type ResumeThreadParams = {
  threadId: string;
  cwd?: string;
  model?: string;
};

export type SendTurnInThreadParams = {
  threadId: string;
  content: string;
  cwd: string;
  model?: string;
  onAccepted?: (threadId: string) => void;
};

export type AppServerActions = {
  sendOneTurn: (params: SendOneTurnParams) => Promise<AppServerTurnState>;
  resumeThread: (params: ResumeThreadParams) => Promise<ThreadResumeResponse>;
  sendTurnInThread: (params: SendTurnInThreadParams) => Promise<AppServerTurnState>;
  interruptTurn: (params?: InterruptTurnParams) => Promise<void>;
  refreshThreads: () => Promise<ThreadListResponse>;
  readThread: (threadId: string) => Promise<ThreadReadResponse>;
  respondToApproval: (decision: AppServerApprovalDecision) => Promise<void>;
  resetTurn: () => void;
};

export function AppServerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CodexWebAppServerState>(initialAppServerState);
  const bridgeUrl = useMemo(() => process.env.NEXT_PUBLIC_CODEX_BRIDGE_URL ?? "", []);
  const clientRef = useRef<AppServerBrowserClient | null>(null);
  const turnCompletionRef = useRef<((turn: AppServerTurnState) => void) | null>(null);
  const approvalResponseStateRef = useRef<ApprovalResponseGuardState>({});

  useEffect(() => {
    if (!bridgeUrl) {
      setState((current) => ({
        ...current,
        connection: { source: "web-bridge", data: "failed" },
        diagnostics: appendDiagnostic(current.diagnostics, {
          source: "web-bridge",
          data: { message: "NEXT_PUBLIC_CODEX_BRIDGE_URL 未设置" },
        }),
      }));
      return;
    }

    let disposed = false;
    const client = new AppServerBrowserClient(bridgeUrl);
    clientRef.current = client;
    client.onServerRequest((request) => {
      const approval = mapServerRequestToApproval(request);
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

      setState((current) => ({
        ...current,
        pendingApproval: { source: "app-server.serverRequest", data: approval },
        diagnostics: appendDiagnostic(current.diagnostics, {
          source: "app-server.serverRequest",
          data: request,
        }),
      }));
    });

    client.onNotification((notification) => {
      setState((current) => {
        const activeTurn = reduceAppServerTurnNotification(
          current.activeTurn?.data ?? initialAppServerTurnState,
          notification,
        );
        const next = {
          ...current,
          activeTurn: { source: "app-server.notification" as const, data: activeTurn },
          pendingApproval: resolvePendingApproval(current.pendingApproval, notification),
          diagnostics: appendDiagnostic(current.diagnostics, {
            source: "app-server.notification",
            data: notification,
          }),
        };

        if (isTerminalTurn(activeTurn)) {
          const resolve = turnCompletionRef.current;
          turnCompletionRef.current = null;
          if (resolve) {
            queueMicrotask(() => resolve(activeTurn));
          }
        }

        return next;
      });
    });

    async function bootstrap() {
      setState((current) => ({ ...current, connection: { source: "web-bridge", data: "connecting" } }));
      try {
        await client.connect();
        const initialize = (await client.request("initialize", {
          clientInfo: { name: "codex_web", title: "Codex Web", version: "0.0.0" },
          capabilities: null,
        })) as InitializeResponse;
        client.notify("initialized");
        const [models, account, threads] = await Promise.all([
          client.request("model/list", { includeHidden: false }) as Promise<ModelListResponse>,
          client.request("account/read", { refreshToken: false }) as Promise<GetAccountResponse>,
          client.request("thread/list", threadListParams()) as Promise<ThreadListResponse>,
        ]);

        if (disposed) {
          return;
        }

        setState((current) => ({
          ...current,
          connection: { source: "web-bridge", data: "connected" },
          initialize: { source: "app-server.initialize", data: initialize },
          models: { source: "app-server.model/list", data: models },
          account: { source: "app-server.account/read", data: account },
          threads: { source: "app-server.thread/list", data: threads },
        }));
      } catch (error) {
        if (disposed) {
          return;
        }
        setState((current) => ({
          ...current,
          connection: { source: "web-bridge", data: "failed" },
          diagnostics: appendDiagnostic(current.diagnostics, {
            source: "web-bridge",
            data: { message: error instanceof Error ? error.message : String(error) },
          }),
        }));
      }
    }

    void bootstrap();

    return () => {
      disposed = true;
      clientRef.current = null;
      turnCompletionRef.current = null;
      approvalResponseStateRef.current = {};
      client.close();
    };
  }, [bridgeUrl]);

  const resetTurn = useCallback(() => {
    turnCompletionRef.current = null;
    setState((current) => ({
      ...current,
      activeTurn: null,
      pendingApproval: null,
    }));
  }, []);

  const respondToApproval = useCallback(async (decision: AppServerApprovalDecision) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }

    const approval = state.pendingApproval?.data ?? null;
    if (!approval) {
      throw new Error("没有待处理的 app-server approval");
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
          data: { message: `approval response skipped: ${guard.reason}` },
        }),
      }));
      throw new Error(`app-server approval 已处理或已失效: ${guard.reason}`);
    }

    const response = buildApprovalResponse(approval, decision);
    try {
      client.respond(approval.requestId, response);
      approvalResponseStateRef.current = completeApprovalResponse({
        key: guard.key,
        state: approvalResponseStateRef.current,
      });
      const requestId = approval.requestId;
      setState((current) => ({
        ...current,
        pendingApproval:
          current.pendingApproval?.data.requestId === requestId ? null : current.pendingApproval,
      }));
    } catch (error) {
      approvalResponseStateRef.current = failApprovalResponse({
        key: guard.key,
        state: approvalResponseStateRef.current,
      });
      throw error;
    }
  }, [state.pendingApproval]);

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

  const readThread = useCallback(async (threadId: string) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }

    const params: ThreadReadParams = { threadId, includeTurns: true };
    const response = (await client.request("thread/read", params)) as ThreadReadResponse;
    setState((current) => ({
      ...current,
      selectedThread: { source: "app-server.thread/read", data: response },
    }));
    return response;
  }, []);

  const resumeThread = useCallback(async ({ threadId, cwd, model }: ResumeThreadParams) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }

    const response = (await client.request(
      "thread/resume",
      buildThreadResumeParams({ threadId, cwd, model }),
    )) as ThreadResumeResponse;
    setState((current) => ({
      ...current,
      resumedThread: { source: "app-server.thread/resume", data: response },
      selectedThread: { source: "app-server.thread/resume", data: { thread: response.thread } },
    }));
    return response;
  }, []);

  const sendTurnInThread = useCallback(async ({ threadId, content, cwd, model, onAccepted }: SendTurnInThreadParams) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("消息内容不能为空");
    }

    setState((current) => ({
      ...current,
      activeTurn: {
        source: "app-server.notification",
        data: {
          ...createStartingTurnState(),
          threadId,
        },
      },
    }));

    const completed = waitForTurnCompletion(turnCompletionRef);
    const turnParams: TurnStartParams = {
      threadId,
      input: [{ type: "text", text: trimmed, text_elements: [] }],
      cwd,
      model: model || null,
      approvalPolicy: "on-request",
    };
    let turnResponse: TurnStartResponse;
    try {
      turnResponse = (await client.request("turn/start", turnParams)) as TurnStartResponse;
    } catch (error) {
      turnCompletionRef.current = null;
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
        };
      });
      throw error;
    }
    onAccepted?.(threadId);
    setState((current) => ({
      ...current,
      activeTurn: {
        source: "app-server.notification",
        data: {
          ...(current.activeTurn?.data ?? createStartingTurnState()),
          threadId,
          turnId: turnResponse.turn.id,
          status: "running",
        },
      },
    }));

    const finalTurn = await completed;
    void refreshThreads().catch(() => undefined);
    return finalTurn;
  }, [refreshThreads]);

  const sendOneTurn = useCallback(async ({ content, cwd, model }: SendOneTurnParams) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("消息内容不能为空");
    }

    setState((current) => ({
      ...current,
      activeTurn: { source: "app-server.notification", data: createStartingTurnState() },
    }));

    const threadParams: ThreadStartParams = {
      cwd,
      model: model || null,
      approvalPolicy: "on-request",
      threadSource: "codex_web",
      serviceName: "codex_web",
    };
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
      activeTurn: {
        source: "app-server.notification",
        data: {
          ...(current.activeTurn?.data ?? createStartingTurnState()),
          threadId,
        },
      },
    }));

    return sendTurnInThread({ threadId, content: trimmed, cwd, model });
  }, [sendTurnInThread]);

  const interruptTurn = useCallback(async (params?: InterruptTurnParams) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Web bridge 尚未连接");
    }

    const activeTurn = state.activeTurn?.data ?? null;
    const interruptParams = selectTurnInterruptParams({ activeTurn, params });
    if (!interruptParams) {
      return;
    }

    await client.request(
      "turn/interrupt",
      interruptParams,
    ) as TurnInterruptResponse;
  }, [state.activeTurn]);

  const actions = useMemo<AppServerActions>(
    () => ({
      sendOneTurn,
      resumeThread,
      sendTurnInThread,
      interruptTurn,
      refreshThreads,
      readThread,
      respondToApproval,
      resetTurn,
    }),
    [sendOneTurn, resumeThread, sendTurnInThread, interruptTurn, refreshThreads, readThread, respondToApproval, resetTurn],
  );

  return (
    <AppServerContext.Provider value={state}>
      <AppServerActionsContext.Provider value={actions}>
        {children}
      </AppServerActionsContext.Provider>
    </AppServerContext.Provider>
  );
}

export function useAppServerState(): CodexWebAppServerState {
  return useContext(AppServerContext);
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

function isTerminalTurn(turn: AppServerTurnState): boolean {
  return turn.status === "completed" || turn.status === "failed" || turn.status === "interrupted";
}

function resolvePendingApproval(
  pendingApproval: CodexWebAppServerState["pendingApproval"],
  notification: { method: string; params?: unknown },
): CodexWebAppServerState["pendingApproval"] {
  if (!pendingApproval || notification.method !== "serverRequest/resolved") {
    return pendingApproval;
  }

  const params = readRecord(notification.params);
  return params.requestId === pendingApproval.data.requestId ? null : pendingApproval;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function waitForTurnCompletion(
  ref: MutableRefObject<((turn: AppServerTurnState) => void) | null>,
): Promise<AppServerTurnState> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      ref.current = null;
      reject(new Error("等待 turn/completed 超时"));
    }, 10 * 60 * 1000);

    ref.current = (turn) => {
      window.clearTimeout(timeout);
      resolve(turn);
    };
  });
}

function threadListParams(): ThreadListParams {
  return {
    limit: 50,
    sortKey: "recency_at",
    sortDirection: "desc",
    archived: false,
  };
}
