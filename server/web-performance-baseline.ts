import { percentile95 } from "../src/lib/web-performance";

export type WebPerformanceMode = "dev" | "production";
export type WebPerformanceProfile = "default" | "no-mcp" | "mcp-heavy";

export type WebPerformanceScenario = {
  name: string;
  path: string;
  resetStorage: boolean;
};

export type WebPerformanceScenarioResult = {
  name: string;
  ok: boolean;
  error?: string;
  interactiveMs: number | null;
  routeDurationMs: number | null;
  inputLatencyMs: number | null;
  longTaskCount: number;
  maxLongTaskDuration: number | null;
};

export function buildWebPerformanceScenarioMatrix(options: {
  ordinaryThreadId: string;
  longThreadId: string;
  plainMarkdownThreadId: string;
  mathMarkdownThreadId: string;
  mermaidMarkdownThreadId: string;
  codeMarkdownThreadId: string;
}): WebPerformanceScenario[] {
  return [
    { name: "empty-chat-cold", path: "/chat", resetStorage: true },
    { name: "empty-chat-warm", path: "/chat", resetStorage: false },
    { name: "ordinary-history", path: `/chat/${options.ordinaryThreadId}`, resetStorage: false },
    { name: "long-history", path: `/chat/${options.longThreadId}`, resetStorage: false },
    { name: "optional-markdown-plain", path: `/chat/${options.plainMarkdownThreadId}`, resetStorage: false },
    { name: "optional-markdown-math", path: `/chat/${options.mathMarkdownThreadId}`, resetStorage: false },
    { name: "optional-markdown-mermaid", path: `/chat/${options.mermaidMarkdownThreadId}`, resetStorage: false },
    { name: "optional-markdown-code", path: `/chat/${options.codeMarkdownThreadId}`, resetStorage: false },
    { name: "settings-first", path: "/settings/codex", resetStorage: false },
    { name: "settings-second", path: "/settings/codex", resetStorage: false },
  ];
}

export function webPerformanceRunDirectoryName(
  now: Date,
  mode: WebPerformanceMode,
  profile: WebPerformanceProfile,
): string {
  return `${now.toISOString().replaceAll(":", "-").replace(".", "-")}-${mode}-${profile}`;
}

export function summarizeWebPerformanceResults(results: readonly WebPerformanceScenarioResult[]) {
  const succeeded = results.filter((result) => result.ok).length;
  const values = <K extends "interactiveMs" | "routeDurationMs" | "inputLatencyMs">(key: K) =>
    results.flatMap((result) => typeof result[key] === "number" ? [result[key] as number] : []);
  const maxLongTaskDuration = results.reduce<number | null>((maximum, result) => {
    if (result.maxLongTaskDuration === null) return maximum;
    return maximum === null ? result.maxLongTaskDuration : Math.max(maximum, result.maxLongTaskDuration);
  }, null);

  return {
    scenarioCount: results.length,
    succeeded,
    failed: results.length - succeeded,
    p95InteractiveMs: percentile95(values("interactiveMs")),
    p95RouteDurationMs: percentile95(values("routeDurationMs")),
    p95InputLatencyMs: percentile95(values("inputLatencyMs")),
    totalLongTasks: results.reduce((total, result) => total + result.longTaskCount, 0),
    maxLongTaskDuration,
  };
}

export function createHistoryFixtureJsonl(options: {
  threadId: string;
  turnCount: number;
  markerPrefix: string;
  cwd: string;
  assistantText?: (index: number) => string;
}): string {
  const createdAt = new Date("2026-07-23T12:00:00.000Z");
  const lines: unknown[] = [
    {
      timestamp: createdAt.toISOString(),
      type: "session_meta",
      payload: {
        session_id: options.threadId,
        id: options.threadId,
        timestamp: createdAt.toISOString(),
        cwd: options.cwd,
        originator: "codex_web_performance_fixture",
        cli_version: "0.144.1",
        source: "cli",
        thread_source: "codex_web_performance_baseline",
        model_provider: "OpenAI",
      },
    },
  ];

  for (let index = 1; index <= options.turnCount; index += 1) {
    const padded = String(index).padStart(3, "0");
    const turnId = `${options.threadId.slice(0, -3)}${padded}`;
    const timestamp = new Date(createdAt.getTime() + index * 10_000).toISOString();
    const userText = `${options.markerPrefix}-user-${padded}`;
    const assistantText = options.assistantText?.(index)
      ?? `${options.markerPrefix}-answer-${padded}\n\n\`\`\`ts\nconst turn = ${index};\n\`\`\``;
    lines.push(
      { timestamp, type: "event_msg", payload: { type: "task_started", turn_id: turnId, started_at: 1784808000 + index * 10, model_context_window: 258400, collaboration_mode_kind: "default" } },
      { timestamp, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: userText }], internal_chat_message_metadata_passthrough: { turn_id: turnId } } },
      { timestamp, type: "event_msg", payload: { type: "user_message", message: userText, images: [], local_images: [], text_elements: [] } },
      { timestamp, type: "event_msg", payload: { type: "agent_message", message: assistantText, phase: "final_answer", memory_citation: null } },
      { timestamp, type: "response_item", payload: { type: "message", id: `msg_${turnId.replaceAll("-", "")}`, role: "assistant", content: [{ type: "output_text", text: assistantText }], phase: "final_answer", internal_chat_message_metadata_passthrough: { turn_id: turnId } } },
      { timestamp, type: "event_msg", payload: { type: "task_complete", turn_id: turnId, last_agent_message: assistantText, completed_at: 1784808001 + index * 10, duration_ms: 1_000, time_to_first_token_ms: 500 } },
    );
  }

  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}
