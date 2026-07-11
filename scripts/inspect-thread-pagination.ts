import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { appServerInitializeCapabilities } from "../src/codex-web/app-server-capabilities";

type JsonRpcMessage = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
};

type JsonRecord = Record<string, unknown>;

const threadId = process.argv[2];
const limit = Number.parseInt(process.argv[3] ?? "30", 10);

if (!threadId || !Number.isInteger(limit) || limit < 1) {
  console.error("Usage: tsx scripts/inspect-thread-pagination.ts <thread-id> <limit=30>");
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
  if (!line.trim()) return;

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

function textFromTurn(rawTurn: unknown): string {
  const turn = asRecord(rawTurn);
  const items = Array.isArray(turn?.items) ? turn.items : [];
  const texts: string[] = [];
  for (const rawItem of items) {
    const item = asRecord(rawItem);
    if (item?.type === "userMessage" && Array.isArray(item.content)) {
      for (const rawInput of item.content) {
        const input = asRecord(rawInput);
        if (input?.type === "text" && typeof input.text === "string") {
          texts.push(input.text);
        }
      }
    }
    if (item?.type === "agentMessage" && typeof item.text === "string") {
      texts.push(item.text);
    }
  }
  return texts.join(" | ");
}

try {
  await request("initialize", {
    clientInfo: { name: "codex-web-phase6o-pagination", version: "0.0.0" },
    capabilities: appServerInitializeCapabilities(),
  });
  notify("initialized");

  const metadataResponse = asRecord(await request("thread/read", { threadId, includeTurns: false }));
  const thread = asRecord(metadataResponse?.thread);
  console.log(`thread=${String(thread?.id ?? null)}`);
  console.log(`preview=${String(thread?.preview ?? "")}`);

  let cursor: string | null = null;
  let pageIndex = 1;
  const seenTurnIds: string[] = [];

  while (pageIndex <= 3) {
    const response = asRecord(await request("thread/turns/list", {
      threadId,
      cursor,
      limit,
      sortDirection: "desc",
      itemsView: "full",
    }));
    const turns = Array.isArray(response?.data) ? response.data : [];
    const ids = turns.map((turn) => String(asRecord(turn)?.id ?? ""));
    seenTurnIds.push(...ids);
    console.log(
      `page=${pageIndex} count=${turns.length} nextCursor=${String(response?.nextCursor ?? null)} backwardsCursor=${String(response?.backwardsCursor ?? null)}`,
    );
    console.log(`page=${pageIndex} newest=${textFromTurn(turns[0])}`);
    console.log(`page=${pageIndex} oldest=${textFromTurn(turns[turns.length - 1])}`);
    cursor = typeof response?.nextCursor === "string" ? response.nextCursor : null;
    if (!cursor) break;
    pageIndex += 1;
  }

  console.log(`seenTurns=${seenTurnIds.length}`);
  console.log(`uniqueTurns=${new Set(seenTurnIds).size}`);
} finally {
  rl.close();
  child.stdin.end();
  child.kill();
}
