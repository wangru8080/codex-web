import { chmod, lstat } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { homedir } from "node:os";
import { dirname, isAbsolute } from "node:path";
import { join } from "node:path";

import type { AppServerPeer } from "./app-server-peer";
import { ApiKeyLimitError, ApiKeyStore, apiKeyStatePath, type ApiKeyVerification } from "./api-key-store";
import {
  JulesSessionStore,
  julesSessionStatePath,
} from "./jules-session-store";
import type { RuntimeBrokerConfig, RuntimeBrokerUserConfig } from "./runtime-broker-config";
import type { PushNotificationService } from "./push-notifications";
import { listenJsonLines, writeJsonLine } from "./runtime-broker-framing";
import { verifyBrokerPassword } from "./runtime-broker-password";
import type { BrokerErrorResponse, BrokerRequest, BrokerResponse } from "./runtime-broker-protocol";
import { publicBrokerUser } from "./runtime-broker-protocol";
import {
  brokerUserCredentialVersion,
  createBrokerSession,
  verifyBrokerSession,
} from "./runtime-broker-session";
import {
  EMPTY_TURNSTILE_CONFIG,
  mergeTurnstileConfig,
  publicTurnstileConfig,
  readTurnstileConfigAt,
  turnstileConfigPath,
  writeTurnstileConfigAt,
} from "./turnstile-config";
import { verifyTurnstileTokenDetailed } from "./turnstile";
import {
  RuntimeCapacityError,
  UserRuntimeRegistry,
  type UserRuntimeServer,
} from "./user-runtime-registry";
import type { JsonRpcMessage } from "../src/codex/protocol/json-rpc";

type BrokerServerOptions = {
  socketPath: string;
  config: RuntimeBrokerConfig;
  createRuntime: (
    user: RuntimeBrokerUserConfig,
    onNotification: (message: JsonRpcMessage) => void,
  ) => UserRuntimeServer;
  turnstileConfigPath?: string;
  apiKeyStore?: ApiKeyStore;
  apiKeyStorePath?: string;
  apiSessionStore?: JulesSessionStore;
  apiSessionStorePath?: string;
  verifyTurnstile?: typeof verifyTurnstileTokenDetailed;
  pushNotifications?: PushNotificationService;
};

export type RuntimeBrokerServer = {
  socketPath: string;
  runtimeCount: () => number;
  reload: (
    config: RuntimeBrokerConfig,
    createRuntime: BrokerServerOptions["createRuntime"],
  ) => void;
  close: () => Promise<void>;
};

export function resolveBrokerTurnstilePaths(
  config: RuntimeBrokerConfig,
  configuredPath?: string,
): { rootManaged: boolean; path?: string } {
  const rootUser = config.users.find((user) => user.enabled && user.osUser === "root");
  if (!rootUser) return { rootManaged: false };
  return {
    rootManaged: true,
    path: configuredPath ?? turnstileConfigPath(rootUser.env, rootUser.home),
  };
}

export function resolveBrokerApiKeyStorePath(
  config: RuntimeBrokerConfig,
  configuredPath?: string,
): string {
  return configuredPath ?? rootManagedStatePath(config, apiKeyStatePath);
}

export function resolveBrokerApiSessionStorePath(
  config: RuntimeBrokerConfig,
  configuredPath?: string,
): string {
  return configuredPath ?? rootManagedStatePath(config, julesSessionStatePath);
}

function rootManagedStatePath(
  config: RuntimeBrokerConfig,
  pathFor: (env: Readonly<Record<string, string | undefined>>, home: string) => string,
): string {
  const rootUser = config.users.find((user) => user.enabled && user.osUser === "root");
  return rootUser ? pathFor(rootUser.env ?? {}, rootUser.home) : pathFor(process.env, homedir());
}

const DUMMY_PASSWORD_HASH = "scrypt$v1$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function createRuntimeBrokerServer(options: BrokerServerOptions): Promise<RuntimeBrokerServer> {
  await assertSocketPath(options.socketPath);
  let config = options.config;
  const registry = new UserRuntimeRegistry({
    disconnectGraceMs: config.disconnectGraceMs,
    maxActiveAppServers: config.maxActiveAppServers,
    createRuntime: options.createRuntime,
    pushNotifications: options.pushNotifications,
  });
  const sockets = new Set<Socket>();
  const attempts = new LoginAttemptLimiter();
  const configuredTurnstilePath = options.turnstileConfigPath;
  const verifyTurnstile = options.verifyTurnstile ?? verifyTurnstileTokenDetailed;
  const apiKeyStore = options.apiKeyStore ?? new ApiKeyStore(
    resolveBrokerApiKeyStorePath(config, options.apiKeyStorePath),
  );
  const apiSessionStore = options.apiSessionStore ?? new JulesSessionStore(
    resolveBrokerApiSessionStorePath(config, options.apiSessionStorePath),
  );
  const server = createServer((socket) => {
    sockets.add(socket);
    handleSocket(socket, () => config, registry, attempts, configuredTurnstilePath, verifyTurnstile, {
      apiKeyStore,
      apiSessionStore,
    });
    socket.once("close", () => sockets.delete(socket));
  });
  await listen(server, options.socketPath);
  await chmod(options.socketPath, 0o660);

  return {
    socketPath: options.socketPath,
    runtimeCount: () => registry.runtimeCount(),
    reload: (nextConfig, createRuntime) => {
      const affectedUserIds = changedRuntimeUserIds(config, nextConfig);
      config = nextConfig;
      registry.reload({
        disconnectGraceMs: nextConfig.disconnectGraceMs,
        maxActiveAppServers: nextConfig.maxActiveAppServers,
        createRuntime,
        affectedUserIds,
        users: nextConfig.users,
      });
    },
    close: async () => {
      registry.close();
      for (const socket of sockets) socket.destroy();
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

function handleSocket(
  socket: Socket,
  getConfig: () => RuntimeBrokerConfig,
  registry: UserRuntimeRegistry,
  attempts: LoginAttemptLimiter,
  configuredTurnstilePath: string | undefined,
  verifyTurnstile: typeof verifyTurnstileTokenDetailed,
  apiStores: { apiKeyStore: ApiKeyStore; apiSessionStore: JulesSessionStore },
): void {
  let attached: { userId: string; peer: BufferedSocketPeer } | null = null;
  let handledRequest = false;
  socket.once("error", () => socket.destroy());
  const handleMessage = async (value: unknown): Promise<void> => {
    if (attached) {
      registry.handleClientMessage(attached.userId, attached.peer, value as JsonRpcMessage);
      return;
    }
    if (handledRequest) throw new Error("broker one-shot 连接只能发送一个请求");
    handledRequest = true;
    const request = parseRequest(value);
    if (request.type === "attachRuntime" || request.type === "attachApiRuntime") {
      const config = getConfig();
      const apiAuthentication = request.type === "attachApiRuntime"
        ? await verifyApiKey(request.apiKey, request.authBinding, config, apiStores.apiKeyStore)
        : null;
      if (socket.destroyed) return;
      const user = request.type === "attachRuntime"
        ? verifyBrokerSession(request.token, config)
        : apiAuthentication?.user ?? null;
      if (!user) {
        respondAndEnd(socket, errorResponse("unauthorized", "登录已失效"));
        return;
      }
      const peer = new BufferedSocketPeer(socket);
      let runtime: { pid: number | undefined };
      try {
        runtime = registry.attach(user, peer);
      } catch (error) {
        if (error instanceof RuntimeCapacityError) {
          respondAndEnd(socket, errorResponse("unavailable", error.message));
          return;
        }
        throw error;
      }
      attached = { userId: user.id, peer };
      if (!peer.isOpen()) return;
      writeJsonLine(socket, {
        ok: true,
        type: "attached",
        user: publicBrokerUser(user),
        ...(runtime.pid === undefined ? {} : { pid: runtime.pid }),
        ...(apiAuthentication === null ? {} : { permissionProfile: apiAuthentication.verification.permissionProfile }),
      } satisfies BrokerResponse);
      peer.activate();
      return;
    }
    void handleOneShot(
      request,
      getConfig(),
      attempts,
      configuredTurnstilePath,
      verifyTurnstile,
      apiStores,
    ).then(
      (response) => respondAndEnd(socket, response),
      () => respondAndEnd(socket, errorResponse("unavailable", "runtime broker 请求失败")),
    );
  };
  const cleanup = listenJsonLines(socket, (value) => {
    void handleMessage(value).catch((error: unknown) => {
      if (socket.destroyed) return;
      respondAndEnd(socket, errorResponse(
        "invalid_request",
        error instanceof Error ? error.message : "runtime broker 请求失败",
      ));
    });
  }, (error) => {
    if (!socket.destroyed) respondAndEnd(socket, errorResponse("invalid_request", error.message));
  });
  socket.once("close", () => {
    cleanup();
    if (attached) registry.detach(attached.userId, attached.peer);
  });
}

function changedRuntimeUserIds(
  current: RuntimeBrokerConfig,
  next: RuntimeBrokerConfig,
): Set<string> {
  const currentUsers = new Map(current.users.map((user) => [user.id, user]));
  const nextUsers = new Map(next.users.map((user) => [user.id, user]));
  if (globalRuntimeKey(current) !== globalRuntimeKey(next)) return new Set(currentUsers.keys());
  const changed = new Set<string>();
  for (const [userId, user] of currentUsers) {
    const replacement = nextUsers.get(userId);
    if (!replacement || userRuntimeKey(user) !== userRuntimeKey(replacement)) changed.add(userId);
  }
  return changed;
}

function globalRuntimeKey(config: RuntimeBrokerConfig): string {
  return JSON.stringify([
    config.sessionSecret,
    config.allowRootRuntime,
    config.codexCommand,
    config.setprivCommand,
  ]);
}

function userRuntimeKey(user: RuntimeBrokerUserConfig): string {
  return JSON.stringify([
    user.id,
    user.email,
    user.passwordHash,
    user.osUser,
    user.home,
    user.codexHome,
    user.cwd,
    user.role,
    user.enabled,
    user.allowRoot,
    user.inheritLoginEnvironment,
    Object.entries(user.env ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  ]);
}

async function handleOneShot(
  request: Exclude<BrokerRequest, { type: "attachRuntime" | "attachApiRuntime" }>,
  config: RuntimeBrokerConfig,
  attempts: LoginAttemptLimiter,
  configuredTurnstilePath: string | undefined,
  verifyTurnstile: typeof verifyTurnstileTokenDetailed,
  apiStores: { apiKeyStore: ApiKeyStore; apiSessionStore: JulesSessionStore },
): Promise<BrokerResponse> {
  if (request.type === "verifySession") {
    const user = verifyBrokerSession(request.token, config);
    return user
      ? { ok: true, type: "verifySession", user: publicBrokerUser(user) }
      : errorResponse("unauthorized", "登录已失效");
  }

  const paths = resolveBrokerTurnstilePaths(config, configuredTurnstilePath);
  const { rootManaged } = paths;
  const turnstilePath = paths.path ?? "";
  if (request.type === "turnstile/readPublic") {
    const turnstile = rootManaged
      ? await readTurnstileConfigAt(turnstilePath)
      : EMPTY_TURNSTILE_CONFIG;
    return { ok: true, type: "turnstilePublic", rootManaged, config: publicTurnstileConfig(turnstile) };
  }
  if (request.type === "turnstile/verify") {
    if (!rootManaged) return errorResponse("invalid_request", "Turnstile 配置不由 runtime broker 管理");
    const turnstile = await readTurnstileConfigAt(turnstilePath);
    const result = turnstile.enabled
      ? await verifyTurnstile(request.responseToken, turnstile.secretKey, request.remoteAddress)
      : { success: true } as const;
    return { ok: true, type: "turnstileVerified", result };
  }
  if (request.type === "turnstile/update") {
    if (!rootManaged) return errorResponse("invalid_request", "Turnstile 配置不由 runtime broker 管理");
    const user = verifyBrokerSession(request.token, config);
    if (!user) return errorResponse("unauthorized", "登录已失效");
    if (user.osUser !== "root") return errorResponse("forbidden", "只有 root 账号可以管理 Turnstile");
    const current = await readTurnstileConfigAt(turnstilePath);
    const candidate = mergeTurnstileConfig(current, request.update);
    if (candidate.enabled) {
      const verification = await verifyTurnstile(request.responseToken, candidate.secretKey);
      if (!verification.success) return errorResponse("turnstile_failed", turnstileVerificationError(verification));
    }
    const saved = await writeTurnstileConfigAt(request.update, turnstilePath);
    return { ok: true, type: "turnstileUpdated", config: publicTurnstileConfig(saved) };
  }

  if (request.type === "apiKeys/list" || request.type === "apiKeys/create" || request.type === "apiKeys/revoke") {
    const user = verifyBrokerSession(request.token, config);
    if (!user) return errorResponse("unauthorized", "登录已失效");
    if (request.type === "apiKeys/list") {
      return { ok: true, type: "apiKeysList", keys: await apiStores.apiKeyStore.list(user.id) };
    }
    if (request.type === "apiKeys/revoke") {
      const revoked = await apiStores.apiKeyStore.revoke(user.id, request.id);
      return revoked
        ? { ok: true, type: "apiKeyRevoked" }
        : errorResponse("invalid_request", "API key 不存在");
    }
    try {
      const created = await apiStores.apiKeyStore.create({
        userId: user.id,
        name: request.name,
        permissionProfile: request.permissionProfile,
        authBinding: request.authBinding,
        userCredentialVersion: brokerUserCredentialVersion(user, config.sessionSecret),
      });
      return { ok: true, type: "apiKeyCreated", key: created.key, metadata: created.metadata };
    } catch (error) {
      if (error instanceof ApiKeyLimitError) return errorResponse("rate_limited", error.message);
      return errorResponse("invalid_request", error instanceof Error ? error.message : "API key 创建失败");
    }
  }

  if (request.type === "apiKey/verify") {
    const authentication = await verifyApiKey(
      request.apiKey,
      request.authBinding,
      config,
      apiStores.apiKeyStore,
    );
    if (!authentication) return errorResponse("unauthorized", "API key 无效或已失效");
    return {
      ok: true,
      type: "apiKeyVerified",
      user: publicBrokerUser(authentication.user),
      keyId: authentication.verification.id,
      permissionProfile: authentication.verification.permissionProfile,
    };
  }

  if (
    request.type === "julesSessions/list"
    || request.type === "julesSessions/get"
    || request.type === "julesSessions/upsert"
    || request.type === "julesSessions/approve"
    || request.type === "julesSessions/delete"
  ) {
    const authentication = await verifyApiKey(
      request.apiKey,
      request.authBinding,
      config,
      apiStores.apiKeyStore,
    );
    if (!authentication) return errorResponse("unauthorized", "API key 无效或已失效");
    const userId = authentication.user.id;
    if (request.type === "julesSessions/list") {
      return {
        ok: true,
        type: "julesSessionsList",
        sessions: await apiStores.apiSessionStore.list(userId),
      };
    }
    if (request.type === "julesSessions/get") {
      return {
        ok: true,
        type: "julesSessionGet",
        session: await apiStores.apiSessionStore.get(userId, request.threadId),
      };
    }
    if (request.type === "julesSessions/upsert") {
      if (request.session.userId !== userId) {
        return errorResponse("forbidden", "不能为其他账号创建 API Session");
      }
      return {
        ok: true,
        type: "julesSessionUpserted",
        session: await apiStores.apiSessionStore.upsert(request.session),
      };
    }
    if (request.type === "julesSessions/approve") {
      return {
        ok: true,
        type: "julesSessionApproved",
        session: await apiStores.apiSessionStore.approvePlan(
          userId,
          request.threadId,
          request.turnId,
          request.approvedAt,
        ),
      };
    }
    return {
      ok: true,
      type: "julesSessionDeleted",
      deleted: await apiStores.apiSessionStore.delete(userId, request.threadId),
    };
  }

  if (request.type === "ssoLogin") {
    const normalizedEmail = request.email.trim().toLowerCase();
    const user = config.users.find((candidate) => candidate.email === normalizedEmail);
    if (!user?.enabled) {
      return errorResponse("invalid_credentials", "该 SSO 邮箱未在 runtime broker 中授权");
    }
    return {
      ok: true,
      type: "login",
      token: createBrokerSession(user, config),
      user: publicBrokerUser(user),
    };
  }

  const key = request.email.trim().toLowerCase();
  if (!attempts.permit(key)) return errorResponse("rate_limited", "登录尝试过多，请稍后重试");
  const user = config.users.find((candidate) => candidate.email === request.email.trim().toLowerCase());
  const valid = await verifyBrokerPassword(request.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user?.enabled || !valid) {
    attempts.fail(key);
    return errorResponse("invalid_credentials", "邮箱或密码错误");
  }
  attempts.success(key);
  return {
    ok: true,
    type: "login",
    token: createBrokerSession(user, config),
    user: publicBrokerUser(user),
  };
}

async function verifyApiKey(
  apiKey: string,
  authBinding: string,
  config: RuntimeBrokerConfig,
  store: ApiKeyStore,
): Promise<{ user: RuntimeBrokerUserConfig; verification: ApiKeyVerification } | null> {
  const verification = await store.verify(apiKey, {
    authBinding,
    userCredentialVersion: (userId) => {
      const user = config.users.find((candidate) => candidate.id === userId && candidate.enabled);
      return user ? brokerUserCredentialVersion(user, config.sessionSecret) : null;
    },
  });
  if (!verification) return null;
  const user = config.users.find(
    (candidate) => candidate.id === verification.userId && candidate.enabled,
  );
  return user ? { user, verification } : null;
}

class BufferedSocketPeer implements AppServerPeer {
  private active = false;
  private readonly pending: string[] = [];

  constructor(private readonly socket: Socket) {}

  isOpen(): boolean {
    return !this.socket.destroyed && !this.socket.writableEnded && this.socket.writable;
  }

  send(serialized: string): void {
    if (!this.active) {
      this.pending.push(serialized);
      return;
    }
    if (this.isOpen()) this.socket.write(`${serialized}\n`);
  }

  close(): void {
    this.socket.end();
  }

  activate(): void {
    this.active = true;
    for (const serialized of this.pending.splice(0)) {
      if (this.isOpen()) this.socket.write(`${serialized}\n`);
    }
  }
}

class LoginAttemptLimiter {
  private readonly entries = new Map<string, { failures: number; resetAt: number }>();

  permit(key: string, now = Date.now()): boolean {
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) return true;
    return entry.failures < 5;
  }

  fail(key: string, now = Date.now()): void {
    const current = this.entries.get(key);
    const failures = current && current.resetAt > now ? current.failures + 1 : 1;
    this.entries.set(key, { failures, resetAt: now + 15 * 60 * 1_000 });
  }

  success(key: string): void {
    this.entries.delete(key);
  }
}

async function assertSocketPath(path: string): Promise<void> {
  if (!isAbsolute(path)) throw new Error("broker socket 必须使用绝对路径");
  const parent = await lstat(dirname(path));
  if (!parent.isDirectory()) throw new Error("broker socket 父路径必须是目录");
  if ((parent.mode & 0o022) !== 0) throw new Error("broker socket 父目录不能允许组或其他用户写入");
}

function parseRequest(value: unknown): BrokerRequest {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    throw new Error("broker 请求格式无效");
  }
  const request = value as Record<string, unknown>;
  if (request.type === "login") {
    if (typeof request.email !== "string" || typeof request.password !== "string") {
      throw new Error("broker 登录请求格式无效");
    }
    return {
      type: "login",
      email: request.email,
      password: request.password,
      ...(typeof request.remoteAddress === "string" ? { remoteAddress: request.remoteAddress } : {}),
    };
  }
  if (request.type === "ssoLogin") {
    if (typeof request.email !== "string" || !request.email.trim()) {
      throw new Error("broker SSO 登录请求格式无效");
    }
    return { type: "ssoLogin", email: request.email };
  }
  if (request.type === "verifySession" || request.type === "attachRuntime") {
    if (typeof request.token !== "string") throw new Error("broker Session 请求格式无效");
    return { type: request.type, token: request.token };
  }
  if (request.type === "turnstile/readPublic") return { type: request.type };
  if (request.type === "turnstile/verify") {
    if (typeof request.responseToken !== "string") throw new Error("broker Turnstile 验证请求格式无效");
    return {
      type: request.type,
      responseToken: request.responseToken,
      ...(typeof request.remoteAddress === "string" ? { remoteAddress: request.remoteAddress } : {}),
    };
  }
  if (request.type === "turnstile/update") {
    if (
      typeof request.token !== "string"
      || typeof request.responseToken !== "string"
      || typeof request.update !== "object"
      || request.update === null
    ) throw new Error("broker Turnstile 更新请求格式无效");
    const update = request.update as Record<string, unknown>;
    if (
      typeof update.enabled !== "boolean"
      || typeof update.siteKey !== "string"
      || (update.secretKey !== undefined && typeof update.secretKey !== "string")
    ) throw new Error("broker Turnstile 更新配置格式无效");
    return {
      type: request.type,
      token: request.token,
      responseToken: request.responseToken,
      update: {
        enabled: update.enabled,
        siteKey: update.siteKey,
        ...(typeof update.secretKey === "string" ? { secretKey: update.secretKey } : {}),
      },
    };
  }
  if (request.type === "apiKeys/list") {
    if (typeof request.token !== "string") throw new Error("broker API key 列表请求格式无效");
    return { type: request.type, token: request.token };
  }
  if (request.type === "apiKeys/create") {
    if (
      typeof request.token !== "string"
      || typeof request.name !== "string"
      || (request.permissionProfile !== "workspace" && request.permissionProfile !== "full_access")
      || typeof request.authBinding !== "string"
    ) throw new Error("broker API key 创建请求格式无效");
    return {
      type: request.type,
      token: request.token,
      name: request.name,
      permissionProfile: request.permissionProfile,
      authBinding: request.authBinding,
    };
  }
  if (request.type === "apiKeys/revoke") {
    if (typeof request.token !== "string" || typeof request.id !== "string") {
      throw new Error("broker API key 撤销请求格式无效");
    }
    return { type: request.type, token: request.token, id: request.id };
  }
  if (request.type === "apiKey/verify" || request.type === "attachApiRuntime") {
    if (typeof request.apiKey !== "string" || typeof request.authBinding !== "string") {
      throw new Error("broker API key 验证请求格式无效");
    }
    return { type: request.type, apiKey: request.apiKey, authBinding: request.authBinding };
  }
  if (request.type === "julesSessions/list") {
    if (typeof request.apiKey !== "string" || typeof request.authBinding !== "string") {
      throw new Error("broker API Session 列表请求格式无效");
    }
    return { type: request.type, apiKey: request.apiKey, authBinding: request.authBinding };
  }
  if (request.type === "julesSessions/get" || request.type === "julesSessions/delete") {
    if (
      typeof request.apiKey !== "string"
      || typeof request.authBinding !== "string"
      || typeof request.threadId !== "string"
    ) throw new Error("broker API Session 请求格式无效");
    return {
      type: request.type,
      apiKey: request.apiKey,
      authBinding: request.authBinding,
      threadId: request.threadId,
    };
  }
  if (request.type === "julesSessions/upsert") {
    if (
      typeof request.apiKey !== "string"
      || typeof request.authBinding !== "string"
      || !isJulesApiSessionMetadata(request.session)
    ) throw new Error("broker API Session 更新请求格式无效");
    return {
      type: request.type,
      apiKey: request.apiKey,
      authBinding: request.authBinding,
      session: request.session,
    };
  }
  if (request.type === "julesSessions/approve") {
    if (
      typeof request.apiKey !== "string"
      || typeof request.authBinding !== "string"
      || typeof request.threadId !== "string"
      || typeof request.turnId !== "string"
      || typeof request.approvedAt !== "string"
    ) throw new Error("broker API Session 计划批准请求格式无效");
    return {
      type: request.type,
      apiKey: request.apiKey,
      authBinding: request.authBinding,
      threadId: request.threadId,
      turnId: request.turnId,
      approvedAt: request.approvedAt,
    };
  }
  throw new Error("broker 请求类型无效");
}

function isJulesApiSessionMetadata(value: unknown): value is import("./jules-session-store").JulesApiSessionMetadata {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return (
    typeof session.threadId === "string"
    && typeof session.userId === "string"
    && typeof session.sourceId === "string"
    && typeof session.prompt === "string"
    && typeof session.title === "string"
    && typeof session.requirePlanApproval === "boolean"
    && (session.approvedPlanTurnId === null || typeof session.approvedPlanTurnId === "string")
    && (session.approvedPlanAt === null || typeof session.approvedPlanAt === "string")
    && (session.automationMode === undefined
      || session.automationMode === "AUTOMATION_MODE_UNSPECIFIED"
      || session.automationMode === "AUTO_CREATE_PR")
    && (session.startingBranch === undefined
      || session.startingBranch === null
      || typeof session.startingBranch === "string")
    && (session.initialGitSha === undefined
      || session.initialGitSha === null
      || typeof session.initialGitSha === "string")
  );
}

function turnstileVerificationError(result: Exclude<Awaited<ReturnType<typeof verifyTurnstileTokenDetailed>>, { success: true }>): string {
  const codes = result.errorCodes?.join(",") ?? "none";
  return `Turnstile 配置验证失败：reason=${result.reason} codes=${codes}`;
}

function errorResponse(code: BrokerErrorResponse["code"], error: string): BrokerResponse {
  return { ok: false, code, error };
}

function respondAndEnd(socket: Socket, response: BrokerResponse): void {
  if (socket.destroyed || socket.writableEnded || !socket.writable) return;
  writeJsonLine(socket, response);
  socket.end();
}

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => resolve());
  });
}
