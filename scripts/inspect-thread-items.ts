import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { appServerInitializeCapabilities } from "../src/codex-web/app-server-capabilities";

type JsonRpcMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

type JsonRecord = Record<string, unknown>;

type ThreadItemSummary = {
  id: string | null;
  type: string | null;
  status: string | null;
  command: string | null;
  server: string | null;
  tool: string | null;
};

const threadId = process.argv[2];

if (!threadId) {
  console.error("Usage: tsx scripts/inspect-thread-items.ts <thread-id>");
  process.exit(1);
}

const codexHome = process.env.CODEX_HOME;

if (!codexHome) {
  console.error("CODEX_HOME is required");
  process.exit(1);
}

let nextId = 1;
const pending = new Map<number, (message: JsonRpcMessage) => void>();

const child = spawn("codex", ["app-server", "--stdio"], {
  env: {
    ...process.env,
    CODEX_HOME: codexHome,
    RUST_LOG: process.env.RUST_LOG ?? "warn",
  },
  stdio: ["pipe", "pipe", "inherit"],
});

const rl = createInterface({ input: child.stdout });

rl.on("line", (line) => {
  if (!line.trim()) {
    return;
  }

  const message = JSON.parse(line) as JsonRpcMessage;
  if (typeof message.id === "number") {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  }
});

child.once("exit", (code, signal) => {
  const message = `app-server exited before all requests completed (code=${String(code)} signal=${String(signal)})`;
  for (const id of pending.keys()) {
    pending.get(id)?.({ id, error: { message } });
  }
  pending.clear();
});

function request(method: string, params?: unknown): Promise<unknown> {
  const id = nextId++;
  const payload = params === undefined ? { id, method } : { id, method, params };

  return new Promise((resolve, reject) => {
    pending.set(id, (message) => {
      if (message.error) {
        reject(new Error(message.error.message ?? "app-server request failed"));
        return;
      }
      resolve(message.result);
    });
    try {
      child.stdin.write(`${JSON.stringify(payload)}\n`);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function notify(method: string, params?: unknown): void {
  const payload = params === undefined ? { method } : { method, params };
  child.stdin.write(`${JSON.stringify(payload)}\n`);
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function stringField(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function summarizeItem(item: JsonRecord): ThreadItemSummary {
  return {
    id: stringField(item, "id"),
    type: stringField(item, "type"),
    status: stringField(item, "status"),
    command: stringField(item, "command"),
    server: stringField(item, "server"),
    tool: stringField(item, "tool"),
  };
}

try {
  const initialize = await request("initialize", {
    clientInfo: { name: "codex-web-phase6f-inspector", version: "0.0.0" },
    capabilities: appServerInitializeCapabilities(),
  });
  notify("initialized");

  const response = asRecord(await request("thread/read", { threadId, includeTurns: true }));
  const thread = asRecord(response?.thread);
  if (!thread) {
    throw new Error("thread/read returned no thread");
  }

  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  console.log(`thread=${String(thread.id)}`);
  console.log(`turns=${turns.length}`);

  for (const [turnIndex, rawTurn] of turns.entries()) {
    const turn = asRecord(rawTurn) ?? {};
    const items = Array.isArray(turn.items) ? turn.items : [];
    console.log(`turn[${turnIndex}] id=${String(turn.id)} status=${String(turn.status)} items=${items.length}`);

    for (const [itemIndex, rawItem] of items.entries()) {
      const item = asRecord(rawItem) ?? {};
      console.log(`  item[${itemIndex}] ${JSON.stringify(summarizeItem(item))}`);
    }
  }

  console.log(`initialize=${JSON.stringify(initialize)}`);
} finally {
  rl.close();
  child.stdin.end();
  child.kill();
}
