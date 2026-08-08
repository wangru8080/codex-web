import { connect, type Socket } from "node:net";

import { listenJsonLines, writeJsonLine } from "./runtime-broker-framing";
import type {
  BrokerPublicUser,
  BrokerRequest,
  BrokerResponse,
  PublicTurnstileConfig,
} from "./runtime-broker-protocol";
import type { TurnstileConfigUpdate } from "./turnstile-config";
import type { TurnstileVerificationResult } from "./turnstile";
import type { JsonRpcMessage } from "../src/codex/protocol/json-rpc";

export type RuntimeBrokerConnection = {
  user: BrokerPublicUser;
  pid: number | undefined;
  send: (message: JsonRpcMessage) => void;
  onMessage: (listener: (message: JsonRpcMessage) => void) => () => void;
  onClose: (listener: (error?: Error) => void) => () => void;
  close: () => void;
};

export class RuntimeBrokerClient {
  constructor(private readonly socketPath: string) {}

  async login(email: string, password: string, remoteAddress?: string): Promise<{
    token: string;
    user: BrokerPublicUser;
  }> {
    const response = await this.request({ type: "login", email, password, remoteAddress });
    if (response.type !== "login") throw new Error("broker 登录响应类型无效");
    return { token: response.token, user: response.user };
  }

  async verifySession(token: string): Promise<BrokerPublicUser> {
    const response = await this.request({ type: "verifySession", token });
    if (response.type !== "verifySession") throw new Error("broker Session 响应类型无效");
    return response.user;
  }

  async readTurnstilePublic(): Promise<{ rootManaged: boolean; config: PublicTurnstileConfig }> {
    const response = await this.request({ type: "turnstile/readPublic" });
    if (response.type !== "turnstilePublic") throw new Error("broker Turnstile 配置响应类型无效");
    return { rootManaged: response.rootManaged, config: response.config };
  }

  async verifyTurnstile(responseToken: string, remoteAddress?: string): Promise<TurnstileVerificationResult> {
    const response = await this.request({ type: "turnstile/verify", responseToken, remoteAddress });
    if (response.type !== "turnstileVerified") throw new Error("broker Turnstile 验证响应类型无效");
    return response.result;
  }

  async updateTurnstile(
    token: string,
    update: TurnstileConfigUpdate,
    responseToken: string,
  ): Promise<PublicTurnstileConfig> {
    const response = await this.request({ type: "turnstile/update", token, update, responseToken });
    if (response.type !== "turnstileUpdated") throw new Error("broker Turnstile 更新响应类型无效");
    return response.config;
  }

  async attachRuntime(token: string): Promise<RuntimeBrokerConnection> {
    const socket = await openSocket(this.socketPath);
    return await new Promise<RuntimeBrokerConnection>((resolve, reject) => {
      let attached = false;
      let settled = false;
      const messageListeners = new Set<(message: JsonRpcMessage) => void>();
      const closeListeners = new Set<(error?: Error) => void>();
      const pending: JsonRpcMessage[] = [];
      const cleanupReader = listenJsonLines(socket, (message) => {
        if (!attached) {
          const response = brokerResponse(message);
          if (!response.ok) {
            settled = true;
            cleanupReader();
            socket.end();
            reject(new BrokerClientError(response.code, response.error));
            return;
          }
          if (response.type !== "attached") {
            settled = true;
            socket.destroy();
            reject(new Error("broker attach 响应类型无效"));
            return;
          }
          attached = true;
          settled = true;
          resolve({
            user: response.user,
            pid: response.pid,
            send: (rpcMessage) => writeJsonLine(socket, rpcMessage),
            onMessage: (listener) => {
              messageListeners.add(listener);
              for (const item of pending.splice(0)) listener(item);
              return () => messageListeners.delete(listener);
            },
            onClose: (listener) => {
              closeListeners.add(listener);
              return () => closeListeners.delete(listener);
            },
            close: () => socket.end(),
          });
          return;
        }
        const rpcMessage = message as JsonRpcMessage;
        if (messageListeners.size === 0) pending.push(rpcMessage);
        else for (const listener of messageListeners) listener(rpcMessage);
      }, (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
        socket.destroy();
        for (const listener of closeListeners) listener(error);
      });
      socket.once("close", () => {
        cleanupReader();
        if (!settled) reject(new Error("runtime broker 连接已关闭"));
        for (const listener of closeListeners) listener();
      });
      writeJsonLine(socket, { type: "attachRuntime", token } satisfies BrokerRequest);
    });
  }

  private async request(request: BrokerRequest): Promise<Extract<BrokerResponse, { ok: true }>> {
    const socket = await openSocket(this.socketPath);
    return await new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = listenJsonLines(socket, (message) => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.end();
        const response = brokerResponse(message);
        if (response.ok) resolve(response);
        else reject(new BrokerClientError(response.code, response.error));
      }, (error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(error);
      });
      socket.once("close", () => {
        cleanup();
        if (!settled) reject(new Error("runtime broker 连接已关闭"));
      });
      writeJsonLine(socket, request);
    });
  }
}

export class BrokerClientError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "BrokerClientError";
  }
}

function openSocket(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function brokerResponse(value: unknown): BrokerResponse {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    throw new Error("runtime broker 响应格式无效");
  }
  return value as BrokerResponse;
}
