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
import { UserRuntimeRegistry, type UserRuntimeServer } from "./user-runtime-registry";
import type { JsonRpcMessage } from "../src/codex/protocol/json-rpc";

type BrokerServerOptions = {
  socketPath: string;
  config: RuntimeBrokerConfig;
  createRuntime: (
    user: RuntimeBrokerUserConfig,
    onNotification: (message: JsonRpcMessage) => void,
  ) => UserRuntimeServer;
};

export type RuntimeBrokerServer = {
  socketPath: string;
  runtimeCount: () => number;
  close: () => Promise<void>;
};

const DUMMY_PASSWORD_HASH = "scrypt$v1$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function createRuntimeBrokerServer(options: BrokerServerOptions): Promise<RuntimeBrokerServer> {
  await assertSocketPath(options.socketPath);
  const registry = new UserRuntimeRegistry({
    disconnectGraceMs: options.config.disconnectGraceMs,
    createRuntime: options.createRuntime,
  });
  const sockets = new Set<Socket>();
  const attempts = new LoginAttemptLimiter();
  const server = createServer((socket) => {
    sockets.add(socket);
    handleSocket(socket, options.config, registry, attempts);
    socket.once("close", () => sockets.delete(socket));
  });
  await listen(server, options.socketPath);
  await chmod(options.socketPath, 0o660);

  return {
    socketPath: options.socketPath,
    runtimeCount: () => registry.runtimeCount(),
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
  config: RuntimeBrokerConfig,
  registry: UserRuntimeRegistry,
  attempts: LoginAttemptLimiter,
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
      const user = verifyBrokerSession(request.token, config);
      if (!user) {
        respondAndEnd(socket, errorResponse("unauthorized", "登录已失效"));
        return;
      }
      const peer = new BufferedSocketPeer(socket);
      const runtime = registry.attach(user, peer);
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
    void handleOneShot(request, config, attempts).then(
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

async function handleOneShot(
  request: Exclude<BrokerRequest, { type: "attachRuntime" }>,
  config: RuntimeBrokerConfig,
  attempts: LoginAttemptLimiter,
): Promise<BrokerResponse> {
  if (request.type === "verifySession") {
    const user = verifyBrokerSession(request.token, config);
    return user
      ? { ok: true, type: "verifySession", user: publicBrokerUser(user) }
      : errorResponse("unauthorized", "登录已失效");
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
    return !this.socket.destroyed && this.socket.writable;
  }

  send(serialized: string): void {
    if (!this.active) {
      this.pending.push(serialized);
      return;
    }
    this.socket.write(`${serialized}\n`);
  }

  close(): void {
    this.socket.end();
  }

  activate(): void {
    this.active = true;
    for (const serialized of this.pending.splice(0)) this.socket.write(`${serialized}\n`);
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
  throw new Error("broker 请求类型无效");
}

function errorResponse(code: BrokerErrorResponse["code"], error: string): BrokerResponse {
  return { ok: false, code, error };
}

function respondAndEnd(socket: Socket, response: BrokerResponse): void {
  if (socket.destroyed) return;
  writeJsonLine(socket, response);
  socket.end();
}

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => resolve());
  });
}
