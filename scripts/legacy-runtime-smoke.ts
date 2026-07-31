import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import WebSocket from "ws";

const tempRoot = "/volume2/SSD/codex/Temp";
const requestTimeoutMs = 30_000;

export type LegacySmokeSummary = {
  baseUrl: string;
  bridgeUrl: string;
  codexHome: string;
  methods: string[];
};

export function parseLegacyServerLine(line: string): { baseUrl?: string; bridgeUrl?: string } {
  const baseUrl = line.match(/^Codex Web: (https?:\/\/\S+)$/)?.[1];
  const bridgeUrl = line.match(/^Codex Web bridge: (ws:\/\/\S+)$/)?.[1];
  return { ...(baseUrl ? { baseUrl } : {}), ...(bridgeUrl ? { bridgeUrl } : {}) };
}

function redactBridgeUrl(url: string): string {
  return url.replace(/([?&]token=)[^&\s]+/g, "$1[已脱敏]");
}

async function main(): Promise<void> {
  const codexHome = await mkdtemp(join(tempRoot, "codex-web-legacy-smoke-"));
  const port = 0;
  const email = "legacy-smoke@example.test";
  const password = `legacy-smoke-${Date.now()}`;
  const sessionSecret = "legacy-runtime-smoke-session-secret-2026-08-01";
  const child = spawn(process.execPath, ["--import", "tsx/esm", "scripts/start-next-with-bridge.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      CODEX_WEB_LOGIN_EMAIL: email,
      CODEX_WEB_LOGIN_PASSWORD: password,
      CODEX_WEB_SESSION_SECRET: sessionSecret,
      CODEX_WEB_RUNTIME_BROKER_SOCKET: "",
      PORT: String(port),
      CODEX_WEB_NEXT_HOST: "127.0.0.1",
      CODEX_WEB_PUBLIC_HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const append = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    output += text;
    process.stdout.write(text.replace(/([?&]token=)[^\s]+/g, "$1[已脱敏]"));
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  try {
    const urls = await waitForServer(child, () => {
      let parsed: { baseUrl?: string; bridgeUrl?: string } = {};
      for (const line of output.split(/\r?\n/)) parsed = { ...parsed, ...parseLegacyServerLine(line) };
      return parsed.baseUrl && parsed.bridgeUrl ? parsed : null;
    });
    await waitForHttp(`${urls.baseUrl}/login`);

    const client = await LegacyRpcClient.connect(urls.bridgeUrl);
    const methods: string[] = [];
    const initialize = await client.request("initialize", {
      clientInfo: { name: "codex_web_legacy_smoke", title: "Codex Web Legacy Smoke", version: "0.0.0" },
      capabilities: {},
    });
    methods.push("initialize");
    if (typeof initialize.codexHome !== "string" || initialize.codexHome !== codexHome) {
      throw new Error(`legacy initialize 未返回隔离 CODEX_HOME: ${JSON.stringify(initialize)}`);
    }
    await client.notify("initialized");
    await client.request("model/list", { includeHidden: false });
    methods.push("model/list");
    await client.request("account/read", { refreshToken: false });
    methods.push("account/read");
    await client.request("thread/list", { archived: false, sortKey: "updated_at", sortDirection: "desc", limit: 20 });
    methods.push("thread/list");
    client.close();

    const summary: LegacySmokeSummary = {
      baseUrl: urls.baseUrl,
      bridgeUrl: urls.bridgeUrl,
      codexHome,
      methods,
    };
    console.log(`Legacy 单用户 smoke 通过：${JSON.stringify({ ...summary, bridgeUrl: redactBridgeUrl(summary.bridgeUrl) })}`);
  } finally {
    await stopChild(child);
  }
}

async function waitForServer(
  child: ChildProcess,
  read: () => { baseUrl?: string; bridgeUrl?: string } | null,
): Promise<{ baseUrl: string; bridgeUrl: string }> {
  const deadline = Date.now() + requestTimeoutMs;
  while (Date.now() < deadline) {
    const urls = read();
    if (urls?.baseUrl && urls.bridgeUrl) return urls as { baseUrl: string; bridgeUrl: string };
    if (child.exitCode !== null) throw new Error(`legacy Web 提前退出（${child.exitCode}）`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("等待 legacy Web 启动超时");
}

async function waitForHttp(url: string): Promise<void> {
  const deadline = Date.now() + requestTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status === 200 || response.status === 307) return;
    } catch {
      // server 尚未监听，继续轮询
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`等待 HTTP 入口超时：${url}`);
}

class LegacyRpcClient {
  private constructor(private readonly socket: WebSocket) {}

  static async connect(url: string): Promise<LegacyRpcClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("连接 legacy bridge 超时")), requestTimeoutMs);
      socket.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("error", reject);
    });
    return new LegacyRpcClient(socket);
  }

  async notify(method: string): Promise<void> {
    this.socket.send(JSON.stringify({ method }));
  }

  async request(method: string, params: unknown): Promise<any> {
    const id = `${method}-${Date.now()}-${Math.random()}`;
    this.socket.send(JSON.stringify({ id, method, params }));
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`legacy bridge 请求超时：${method}`)), requestTimeoutMs);
      const onMessage = (data: WebSocket.RawData) => {
        const response = JSON.parse(data.toString()) as { id?: unknown; result?: unknown; error?: { message?: string } };
        if (response.id !== id) return;
        clearTimeout(timer);
        this.socket.off("message", onMessage);
        if (response.error) reject(new Error(`${method} 失败：${response.error.message ?? "未知错误"}`));
        else resolve(response.result);
      };
      this.socket.on("message", onMessage);
      this.socket.once("error", reject);
    });
  }

  close(): void {
    this.socket.close();
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGINT");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    console.error(`Legacy 单用户 smoke 失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
