"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";

import type { InitializeResponse } from "@/codex/protocol/generated/InitializeResponse";
import type { GetAccountResponse } from "@/codex/protocol/generated/v2/GetAccountResponse";
import type { ModelListResponse } from "@/codex/protocol/generated/v2/ModelListResponse";
import type { ThreadStartParams } from "@/codex/protocol/generated/v2/ThreadStartParams";
import type { ThreadStartResponse } from "@/codex/protocol/generated/v2/ThreadStartResponse";
import type { TurnStartParams } from "@/codex/protocol/generated/v2/TurnStartParams";
import type { TurnStartResponse } from "@/codex/protocol/generated/v2/TurnStartResponse";
import {
  buildApprovalResponse,
  mapServerRequestToApproval,
  type AppServerApprovalDecision,
} from "./approval-adapter";
import { AppServerBrowserClient } from "./app-server-browser-client";
import { initialAppServerState, type CodexWebAppServerState } from "./app-server-state";
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

export type AppServerActions = {
  sendOneTurn: (params: SendOneTurnParams) => Promise<AppServerTurnState>;
  respondToApproval: (decision: AppServerApprovalDecision) => Promise<void>;
  resetTurn: () => void;
};

export function AppServerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CodexWebAppServerState>(initialAppServerState);
  const bridgeUrl = useMemo(() => process.env.NEXT_PUBLIC_CODEX_BRIDGE_URL ?? "", []);
  const clientRef = useRef<AppServerBrowserClient | null>(null);
  const turnCompletionRef = useRef<((turn: AppServerTurnState) => void) | null>(null);

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
        const [models, account] = await Promise.all([
          client.request("model/list", { includeHidden: false }) as Promise<ModelListResponse>,
          client.request("account/read", { refreshToken: false }) as Promise<GetAccountResponse>,
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

    const response = buildApprovalResponse(approval, decision);
    client.respond(approval.requestId, response);
    const requestId = approval.requestId;
    setState((current) => {
      return {
        ...current,
        pendingApproval:
          current.pendingApproval?.data.requestId === requestId ? null : current.pendingApproval,
      };
    });
  }, [state.pendingApproval]);

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
    const threadResponse = (await client.request("thread/start", threadParams)) as ThreadStartResponse;
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

    const completed = waitForTurnCompletion(turnCompletionRef);
    const turnParams: TurnStartParams = {
      threadId,
      input: [{ type: "text", text: trimmed, text_elements: [] }],
      cwd,
      model: model || null,
      approvalPolicy: "on-request",
    };
    const turnResponse = (await client.request("turn/start", turnParams)) as TurnStartResponse;
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

    return completed;
  }, []);

  const actions = useMemo<AppServerActions>(
    () => ({ sendOneTurn, respondToApproval, resetTurn }),
    [sendOneTurn, respondToApproval, resetTurn],
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
