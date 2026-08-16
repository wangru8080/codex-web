import type { Server } from "node:http";
import WebSocket from "ws";

import { createWebSocketBridge } from "../server/websocket-bridge";
import { resolveTestCodexHome } from "../server/test-codex-home";
import type { ThreadResumeResponse } from "../src/codex/protocol/generated/v2/ThreadResumeResponse";
import { appServerInitializeCapabilities } from "../src/codex-web/app-server-capabilities";
import { activeTurnFromResume, mergeResumedActiveTurn } from "../src/codex-web/resumed-turn-hydration";
import { createAcceptedTurnState } from "../src/codex-web/turn-reducer";

const codexHome = resolveTestCodexHome();
process.env.CODEX_HOME = codexHome;
const commandStartTimeoutMs = 90_000;
const reconnectTimeoutMs = 10_000;
const turnCompleteTimeoutMs = 120_000;
const recentNotificationLimit = 20;
const streamingMode = process.argv.includes("--streaming");

type JsonRpcMessage = {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

type Notification = { method: string; params?: unknown };

async function main(): Promise<void> {
  const bridge = createWebSocketBridge({ token: "reconnect-smoke-token" });
  try {
    await waitForListening(bridge.server);
    const url = `${bridge.url()}?token=${bridge.token}`;
    const first = await RpcClient.connect(url, reconnectTimeoutMs);
    const initialize = await initializeClient(first);
    if (initialize.codexHome !== codexHome) {
      throw new Error(`app-server 使用了错误 CODEX_HOME：${initialize.codexHome ?? "缺失"}`);
    }

    const models = await first.request("model/list", { includeHidden: false }) as {
      data?: Array<{ id: string; hidden?: boolean; isDefault?: boolean }>;
    };
    const model = models.data?.find((item) => !item.hidden && item.isDefault)?.id
      ?? models.data?.find((item) => !item.hidden)?.id;
    if (!model) throw new Error("model/list 没有返回可用模型");

    const cwd = process.cwd();
    const startedThread = await first.request("thread/start", {
      cwd,
      model,
      ephemeral: false,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      threadSource: "codex_web_reconnect_smoke",
      serviceName: "codex_web",
    }) as { thread?: { id?: string } };
    const threadId = startedThread.thread?.id;
    if (!threadId) throw new Error("thread/start 未返回 thread.id");

    const turnStarted = first.waitForNotification((notification) => {
      const params = notification.params as { threadId?: string; turn?: { id?: string } } | undefined;
      return notification.method === "turn/started"
        && params?.threadId === threadId
        && typeof params.turn?.id === "string";
    }, commandStartTimeoutMs, "等待 shell Turn 开始");
    const commandStarted = first.waitForNotification((notification) => {
      const params = notification.params as { threadId?: string; item?: { type?: string } } | undefined;
      return notification.method === "item/started"
        && params?.threadId === threadId
        && params.item?.type === "commandExecution";
    }, commandStartTimeoutMs, "等待长命令开始");
    await first.request("thread/shellCommand", { threadId, command: "sleep 8" });
    const startedTurnNotification = await turnStarted;
    const turnId = (
      startedTurnNotification.params as { turn?: { id?: string } } | undefined
    )?.turn?.id;
    if (!turnId) throw new Error("turn/started notification 未返回 turn.id");
    try {
      await commandStarted;
    } catch (error) {
      throw await timeoutWithDiagnostics(first, threadId, turnId, error);
    }
    await first.close();

    const second = await RpcClient.connect(url, reconnectTimeoutMs);
    await initializeClient(second);
    const completed = second.waitForNotification((notification) => {
      const params = notification.params as { threadId?: string; turn?: { id?: string } } | undefined;
      return notification.method === "turn/completed"
        && params?.threadId === threadId
        && params.turn?.id === turnId;
    }, turnCompleteTimeoutMs, "等待重连后的 turn/completed");
    const resumed = await second.request("thread/resume", { threadId }) as {
      thread?: { id?: string; turns?: Array<{ id?: string; status?: string }> };
    };
    const activeTurn = resumed.thread?.turns?.find((turn) => turn.id === turnId);
    if (resumed.thread?.id !== threadId || activeTurn?.status !== "inProgress") {
      throw new Error(
        `thread/resume 未恢复运行态：thread=${resumed.thread?.id ?? "缺失"}，status=${activeTurn?.status ?? "缺失"}`,
      );
    }

    let completedNotification: Notification;
    try {
      completedNotification = await completed;
    } catch (error) {
      throw await timeoutWithDiagnostics(second, threadId, turnId, error);
    }
    const completedStatus = (
      completedNotification.params as { turn?: { status?: string } } | undefined
    )?.turn?.status;
    if (completedStatus !== "completed") {
      throw new Error(`重连后的终态应为 completed，实际为 ${completedStatus ?? "缺失"}`);
    }

    const completedResume = await second.request("thread/resume", { threadId }) as {
      thread?: { turns?: Array<{ id?: string; status?: string }> };
    };
    const completedTurn = completedResume.thread?.turns?.find((turn) => turn.id === turnId);
    if (completedTurn?.status === "inProgress") {
      throw new Error("已完成 Turn 在再次 resume 后仍被标记为 inProgress");
    }

    if (!streamingMode) {
      await second.close();
      console.log(
        `重连 smoke 通过：CODEX_HOME=${initialize.codexHome}，thread=${threadId}，turn=${turnId}，恢复状态=inProgress，终态=${completedStatus}`,
      );
      return;
    }

    let streamedText = "";
    const partialTextReceived = second.waitForNotification((notification) => {
      const params = notification.params as { threadId?: string; turnId?: string; delta?: string } | undefined;
      if (
        notification.method !== "item/agentMessage/delta"
        || params?.threadId !== threadId
        || typeof params.delta !== "string"
      ) {
        return false;
      }
      streamedText += params.delta;
      return streamedText.length >= 20;
    }, commandStartTimeoutMs, "等待部分模型正文", threadId);
    const streamingTurn = await second.request("turn/start", {
      threadId,
      cwd,
      model,
      input: [{ type: "text", text: "请从 1 到 1000 逐行输出数字，每行一个数字，不要省略，不要使用工具。", text_elements: [] }],
    }) as { turn?: { id?: string } };
    const streamingTurnId = streamingTurn.turn?.id;
    if (!streamingTurnId) throw new Error("流式 turn/start 未返回 turn.id");
    await partialTextReceived;

    const localTurn = {
      ...createAcceptedTurnState(threadId, streamingTurnId),
      assistantText: streamedText,
    };
    await second.close();

    const third = await RpcClient.connect(url, reconnectTimeoutMs);
    await initializeClient(third);
    const streamingResume = await third.request("thread/resume", { threadId }) as ThreadResumeResponse;
    const resumedStreamingTurn = streamingResume.thread.turns.find((turn) => turn.id === streamingTurnId);
    if (resumedStreamingTurn?.status !== "inProgress") {
      throw new Error(`流式 Turn 重连时不是 inProgress：${resumedStreamingTurn?.status ?? "缺失"}`);
    }
    const hydratedTurn = activeTurnFromResume(streamingResume);
    const mergedTurn = mergeResumedActiveTurn(localTurn, hydratedTurn);
    if (!mergedTurn || mergedTurn.assistantText.length < streamedText.length) {
      throw new Error(
        `重连后正文发生回退：断线前=${streamedText.length}，合并后=${mergedTurn?.assistantText.length ?? 0}`,
      );
    }

    const streamingCompleted = third.waitForNotification((notification) => {
      const params = notification.params as { threadId?: string; turn?: { id?: string } } | undefined;
      return notification.method === "turn/completed"
        && params?.threadId === threadId
        && params.turn?.id === streamingTurnId;
    }, turnCompleteTimeoutMs, "等待流式 Turn 中断完成");
    await third.request("turn/interrupt", { threadId, turnId: streamingTurnId });
    await streamingCompleted;
    await third.close();

    const resumedTextLength = hydratedTurn?.assistantText.length ?? 0;
    console.log(
      `重连 smoke 通过：CODEX_HOME=${initialize.codexHome}，thread=${threadId}，turn=${turnId}，恢复状态=inProgress，终态=${completedStatus}，断线前正文=${streamedText.length}，resume 正文=${resumedTextLength}，合并正文=${mergedTurn.assistantText.length}`,
    );
  } finally {
    await bridge.close();
  }
}

async function initializeClient(client: RpcClient): Promise<{ codexHome?: string }> {
  const response = await client.request("initialize", {
    clientInfo: { name: "codex_web_reconnect_smoke", title: "Codex Web Reconnect Smoke", version: "0.0.0" },
    capabilities: appServerInitializeCapabilities(),
  }) as { codexHome?: string };
  await client.notify("initialized");
  return response;
}

function waitForListening(server: Server): Promise<void> {
  return server.listening ? Promise.resolve() : new Promise((resolve) => server.once("listening", resolve));
}

async function timeoutWithDiagnostics(
  client: RpcClient,
  threadId: string,
  turnId: string,
  error: unknown,
): Promise<Error> {
  const message = error instanceof Error ? error.message : String(error);
  let resumeSummary: string;
  try {
    const response = await client.request("thread/resume", { threadId }) as {
      thread?: {
        id?: string;
        turns?: Array<{ id?: string; status?: string; items?: Array<{ type?: string }> }>;
      };
    };
    const turn = response.thread?.turns?.find((item) => item.id === turnId);
    resumeSummary = JSON.stringify({
      threadId: response.thread?.id ?? "缺失",
      turnId,
      turnStatus: turn?.status ?? "缺失",
      itemTypes: turn?.items?.map((item) => item.type ?? "unknown") ?? [],
    });
  } catch (resumeError) {
    resumeSummary = `thread/resume 失败：${resumeError instanceof Error ? resumeError.message : String(resumeError)}`;
  }
  return new Error(`${message}；恢复快照=${resumeSummary}；最近事件=${client.notificationSummary()}`);
}

class RpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private readonly listeners = new Set<(notification: Notification) => void>();

  private readonly recentNotifications: Notification[] = [];

  static async connect(url: string, timeoutMs: number): Promise<RpcClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.terminate();
        reject(new Error(`WebSocket 连接超时：${timeoutMs}ms`));
      }, timeoutMs);
      socket.once("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    return new RpcClient(socket);
  }

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => this.handleMessage(data.toString("utf8")));
    socket.once("error", (error) => this.rejectAll(error));
    socket.once("close", () => this.rejectAll(new Error("重连 smoke WebSocket 已关闭")));
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  notify(method: string, params?: unknown): Promise<void> {
    this.socket.send(JSON.stringify({ method, params }));
    return Promise.resolve();
  }

  waitForNotification(
    predicate: (notification: Notification) => boolean,
    timeoutMs: number,
    label: string,
    rejectOnErrorThreadId?: string,
  ): Promise<Notification> {
    return new Promise((resolve, reject) => {
      const listener = (notification: Notification) => {
        const errorParams = notification.params as {
          threadId?: string;
          error?: { message?: string; additionalDetails?: string | null };
          willRetry?: boolean;
        } | undefined;
        if (
          notification.method === "error"
          && errorParams
          && errorParams.threadId === rejectOnErrorThreadId
        ) {
          clearTimeout(timeout);
          this.listeners.delete(listener);
          const details = [
            errorParams.error?.message ?? "app-server 模型请求失败",
            errorParams.error?.additionalDetails,
            errorParams.willRetry === undefined ? null : `willRetry=${errorParams.willRetry}`,
          ].filter((value): value is string => Boolean(value));
          reject(new Error(`${label}失败：${details.join("；")}`));
          return;
        }
        if (!predicate(notification)) return;
        clearTimeout(timeout);
        this.listeners.delete(listener);
        resolve(notification);
      };
      const timeout = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`${label}超时：${timeoutMs}ms`));
      }, timeoutMs);
      this.listeners.add(listener);
    });
  }

  close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.socket.once("close", resolve);
      this.socket.close();
    });
  }

  notificationSummary(): string {
    if (this.recentNotifications.length === 0) return "无";
    return this.recentNotifications.map(describeNotification).join(" -> ");
  }

  private handleMessage(text: string): void {
    const message = JSON.parse(text) as JsonRpcMessage;
    if (message.method && message.id !== undefined) {
      this.socket.send(JSON.stringify({
        id: message.id,
        error: { code: -32601, message: `重连 smoke 不处理 server request：${message.method}` },
      }));
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "JSON-RPC 请求失败"));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) {
      const notification = { method: message.method, params: message.params };
      this.recentNotifications.push(notification);
      if (this.recentNotifications.length > recentNotificationLimit) {
        this.recentNotifications.splice(0, this.recentNotifications.length - recentNotificationLimit);
      }
      this.listeners.forEach((listener) => listener(notification));
    }
  }

  private rejectAll(error: Error): void {
    this.pending.forEach((pending) => pending.reject(error));
    this.pending.clear();
  }
}

function describeNotification(notification: Notification): string {
  const params = notification.params as {
    threadId?: string;
    turnId?: string;
    itemId?: string;
    turn?: { id?: string; status?: string };
    item?: { id?: string; type?: string; status?: string };
    message?: string;
  } | undefined;
  const details = [
    params?.threadId ? `thread=${params.threadId}` : null,
    params?.turnId ?? params?.turn?.id ? `turn=${params?.turnId ?? params?.turn?.id}` : null,
    params?.turn?.status ? `turnStatus=${params.turn.status}` : null,
    params?.itemId ?? params?.item?.id ? `item=${params?.itemId ?? params?.item?.id}` : null,
    params?.item?.type ? `itemType=${params.item.type}` : null,
    params?.item?.status ? `itemStatus=${params.item.status}` : null,
    params?.message ? `message=${params.message}` : null,
  ].filter((value): value is string => value !== null);
  return details.length > 0 ? `${notification.method}(${details.join(",")})` : notification.method;
}

await main();
