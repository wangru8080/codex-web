import { chmod, lstat } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, isAbsolute } from "node:path";

import type { AppServerPeer } from "./app-server-peer";
import type { RuntimeBrokerConfig, RuntimeBrokerUserConfig } from "./runtime-broker-config";
import { listenJsonLines, writeJsonLine } from "./runtime-broker-framing";
import { verifyBrokerPassword } from "./runtime-broker-password";
import type { BrokerErrorResponse, BrokerRequest, BrokerResponse } from "./runtime-broker-protocol";
import { publicBrokerUser } from "./runtime-broker-protocol";
import { createBrokerSession, verifyBrokerSession } from "./runtime-broker-session";
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
  verifyTurnstile?: typeof verifyTurnstileTokenDetailed;
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

const DUMMY_PASSWORD_HASH = "scrypt$v1$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function createRuntimeBrokerServer(options: BrokerServerOptions): Promise<RuntimeBrokerServer> {
  await assertSocketPath(options.socketPath);
  let config = options.config;
  const registry = new UserRuntimeRegistry({
    disconnectGraceMs: config.disconnectGraceMs,
    maxActiveAppServers: config.maxActiveAppServers,
    createRuntime: options.createRuntime,
  });
  const sockets = new Set<Socket>();
  const attempts = new LoginAttemptLimiter();
  const configuredTurnstilePath = options.turnstileConfigPath;
  const verifyTurnstile = options.verifyTurnstile ?? verifyTurnstileTokenDetailed;
  const server = createServer((socket) => {
    sockets.add(socket);
    handleSocket(socket, () => config, registry, attempts, configuredTurnstilePath, verifyTurnstile);
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
): void {
  let attached: { userId: string; peer: BufferedSocketPeer } | null = null;
  let handledRequest = false;
  const cleanup = listenJsonLines(socket, (value) => {
    if (attached) {
      registry.handleClientMessage(attached.userId, attached.peer, value as JsonRpcMessage);
      return;
    }
    if (handledRequest) throw new Error("broker one-shot 连接只能发送一个请求");
    handledRequest = true;
    const request = parseRequest(value);
    if (request.type === "attachRuntime") {
      const user = verifyBrokerSession(request.token, getConfig());
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
      writeJsonLine(socket, {
        ok: true,
        type: "attached",
        user: publicBrokerUser(user),
        ...(runtime.pid === undefined ? {} : { pid: runtime.pid }),
      } satisfies BrokerResponse);
      peer.activate();
      return;
    }
    void handleOneShot(request, getConfig(), attempts, configuredTurnstilePath, verifyTurnstile).then(
      (response) => respondAndEnd(socket, response),
      () => respondAndEnd(socket, errorResponse("unavailable", "runtime broker 请求失败")),
    );
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
  request: Exclude<BrokerRequest, { type: "attachRuntime" }>,
  config: RuntimeBrokerConfig,
  attempts: LoginAttemptLimiter,
  configuredTurnstilePath: string | undefined,
  verifyTurnstile: typeof verifyTurnstileTokenDetailed,
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
  throw new Error("broker 请求类型无效");
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
