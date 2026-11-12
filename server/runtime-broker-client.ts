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
import type { ApiKeyPermissionProfile, PublicApiKey } from "./api-key-store";
import type { JulesApiSessionMetadata } from "./jules-session-store";

export type RuntimeBrokerConnection = {
  user: BrokerPublicUser;
  pid: number | undefined;
  permissionProfile: ApiKeyPermissionProfile | undefined;
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

  async ssoLogin(email: string): Promise<{
    token: string;
    user: BrokerPublicUser;
  }> {
    const response = await this.request({ type: "ssoLogin", email });
    if (response.type !== "login") throw new Error("broker SSO 登录响应类型无效");
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

  async listApiKeys(sessionToken: string): Promise<PublicApiKey[]> {
    const response = await this.request({ type: "apiKeys/list", token: sessionToken });
    if (response.type !== "apiKeysList") throw new Error("broker API key 列表响应类型无效");
    return response.keys;
  }

  async createApiKey(
    sessionToken: string,
    name: string,
    permissionProfile: ApiKeyPermissionProfile,
    authBinding: string,
  ): Promise<{ key: string; metadata: PublicApiKey }> {
    const response = await this.request({
      type: "apiKeys/create",
      token: sessionToken,
      name,
      permissionProfile,
      authBinding,
    });
    if (response.type !== "apiKeyCreated") throw new Error("broker API key 创建响应类型无效");
    return { key: response.key, metadata: response.metadata };
  }

  async revokeApiKey(sessionToken: string, id: string): Promise<void> {
    const response = await this.request({ type: "apiKeys/revoke", token: sessionToken, id });
    if (response.type !== "apiKeyRevoked") throw new Error("broker API key 撤销响应类型无效");
  }

  async verifyApiKey(
    apiKey: string,
    authBinding: string,
  ): Promise<{
    user: BrokerPublicUser;
    keyId: string;
    permissionProfile: ApiKeyPermissionProfile;
  }> {
    const response = await this.request({ type: "apiKey/verify", apiKey, authBinding });
    if (response.type !== "apiKeyVerified") throw new Error("broker API key 验证响应类型无效");
    return {
      user: response.user,
      keyId: response.keyId,
      permissionProfile: response.permissionProfile,
    };
  }

  async listJulesSessions(
    apiKey: string,
    authBinding: string,
  ): Promise<JulesApiSessionMetadata[]> {
    const response = await this.request({ type: "julesSessions/list", apiKey, authBinding });
    if (response.type !== "julesSessionsList") throw new Error("broker API Session 列表响应类型无效");
    return response.sessions;
  }

  async getJulesSession(
    apiKey: string,
    authBinding: string,
    threadId: string,
  ): Promise<JulesApiSessionMetadata | null> {
    const response = await this.request({ type: "julesSessions/get", apiKey, authBinding, threadId });
    if (response.type !== "julesSessionGet") throw new Error("broker API Session 响应类型无效");
    return response.session;
  }

  async upsertJulesSession(
    apiKey: string,
    authBinding: string,
    session: JulesApiSessionMetadata,
  ): Promise<JulesApiSessionMetadata> {
    const response = await this.request({
      type: "julesSessions/upsert",
      apiKey,
      authBinding,
      session,
    });
    if (response.type !== "julesSessionUpserted") throw new Error("broker API Session 更新响应类型无效");
    return response.session;
  }

  async approveJulesSessionPlan(
    apiKey: string,
    authBinding: string,
    threadId: string,
    turnId: string,
    approvedAt: string,
  ): Promise<JulesApiSessionMetadata | null> {
    const response = await this.request({
      type: "julesSessions/approve",
      apiKey,
      authBinding,
      threadId,
      turnId,
      approvedAt,
    });
    if (response.type !== "julesSessionApproved") throw new Error("broker API Session 计划批准响应类型无效");
    return response.session;
  }

  async deleteJulesSession(
    apiKey: string,
    authBinding: string,
    threadId: string,
  ): Promise<boolean> {
    const response = await this.request({
      type: "julesSessions/delete",
      apiKey,
      authBinding,
      threadId,
    });
    if (response.type !== "julesSessionDeleted") throw new Error("broker API Session 删除响应类型无效");
    return response.deleted;
  }

  async attachRuntime(token: string): Promise<RuntimeBrokerConnection> {
    return this.attach({ type: "attachRuntime", token });
  }

  async attachApiRuntime(apiKey: string, authBinding: string): Promise<RuntimeBrokerConnection> {
    return this.attach({ type: "attachApiRuntime", apiKey, authBinding });
  }

  private async attach(request: BrokerRequest & { type: "attachRuntime" | "attachApiRuntime" }): Promise<RuntimeBrokerConnection> {
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
            permissionProfile: response.permissionProfile,
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
      writeJsonLine(socket, request satisfies BrokerRequest);
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
