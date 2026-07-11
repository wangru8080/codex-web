import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";

const codexHome = process.env.CODEX_HOME;
if (!codexHome) {
  console.error("CODEX_HOME is required");
  process.exit(1);
}

const turnCount = Number.parseInt(process.argv[2] ?? "35", 10);
if (!Number.isInteger(turnCount) || turnCount < 31) {
  console.error("Usage: tsx scripts/create-long-history-fixture.ts <turn-count>=35");
  console.error("turn-count must be an integer >= 31");
  process.exit(1);
}

const threadId = randomUUID();
const createdAt = new Date("2026-07-11T15:30:00.000Z");
const dayDir = path.join(codexHome, "sessions", "2026", "07", "11");
const fileTimestamp = createdAt.toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/, "");
const rolloutPath = path.join(dayDir, `rollout-${fileTimestamp}-${threadId}.jsonl`);
const cwd = "/home/rrssnas/code/codex/web";

function iso(offsetSeconds: number): string {
  return new Date(createdAt.getTime() + offsetSeconds * 1000).toISOString();
}

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

const lines: string[] = [];
lines.push(
  line({
    timestamp: iso(0),
    type: "session_meta",
    payload: {
      session_id: threadId,
      id: threadId,
      timestamp: iso(0),
      cwd,
      originator: "codex_web_phase6o_fixture",
      cli_version: "0.144.1",
      source: "cli",
      thread_source: "codex_web_phase6o",
      model_provider: "OpenAI",
    },
  }),
);

for (let index = 1; index <= turnCount; index += 1) {
  const turnId = randomUUID();
  const startedAt = 1783783800 + index * 10;
  const completedAt = startedAt + 1;
  const padded = String(index).padStart(2, "0");
  const userText = `phase6o-user-${padded}`;
  const assistantText = `phase6o-answer-${padded}`;

  lines.push(
    line({
      timestamp: iso(index * 10),
      type: "event_msg",
      payload: {
        type: "task_started",
        turn_id: turnId,
        started_at: startedAt,
        model_context_window: 258400,
        collaboration_mode_kind: "default",
      },
    }),
    line({
      timestamp: iso(index * 10 + 1),
      type: "event_msg",
      payload: {
        type: "user_message",
        message: userText,
        images: [],
        local_images: [],
        text_elements: [],
      },
    }),
    line({
      timestamp: iso(index * 10 + 2),
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: assistantText,
        phase: "final_answer",
        memory_citation: null,
      },
    }),
    line({
      timestamp: iso(index * 10 + 3),
      type: "event_msg",
      payload: {
        type: "task_complete",
        turn_id: turnId,
        last_agent_message: assistantText,
        completed_at: completedAt,
        duration_ms: 1000,
        time_to_first_token_ms: 500,
      },
    }),
  );
}

await mkdir(dayDir, { recursive: true });
const handle = await open(rolloutPath, "wx");
try {
  await handle.writeFile(lines.join(""), "utf8");
} finally {
  await handle.close();
}

console.log(`threadId=${threadId}`);
console.log(`turnCount=${turnCount}`);
console.log(`rolloutPath=${rolloutPath}`);
