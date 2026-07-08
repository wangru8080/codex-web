/**
 * Phase 3 Step 4b — headless `streamClaude` consumer.
 *
 * Wraps `streamClaude(options)` (which returns a `ReadableStream<string>`
 * of SSE-formatted lines intended for an HTTP response) and consumes
 * it server-side, accumulating events into a single result object.
 * Lets the agent task runner go through the same Runtime / Agent
 * execution chain as interactive chat, but **without** an SSE consumer
 * downstream:
 *
 *   - `text` events → accumulated into `assistantText`.
 *   - `tool_use` events → counted (`toolUseCount`). Body is NOT appended
 *     to assistantText (the SDK round produces a separate text event
 *     with the actual narrative around tool calls). The count lets the
 *     pseudo-XML detector below decide whether real tools fired.
 *   - `tool_result` events → counted (`toolResultCount`). Same rationale.
 *   - `tool_output` events → observed (the SDK uses these for streaming
 *     tool stderr / progress). Not part of the final transcript.
 *   - `permission_request` event → cleanly cancel the underlying agent
 *     via `abortController.abort()` (the SDK's pending permission
 *     await respects the signal and rejects), capture the partial
 *     `assistantText` + the requested `toolName / toolInput`, and
 *     return `status: 'waiting_for_permission'`.
 *   - `error` event → abort + return `status: 'failed'` with the
 *     error message.
 *   - `done` event (or stream end) → return `status: 'succeeded'`,
 *     UNLESS the pseudo-XML detector trips (see below).
 *   - `thinking` / `status` / `result` / etc. → observed; result+status
 *     pull out `session_id` for SDK resume on the next run.
 *
 * **Pseudo tool-call XML detection** (Codex P2 follow-up):
 *
 * Some non-Claude models behind Anthropic-compat proxies (notably GLM
 * via certain providers) emit tool calls as XML inside the `text`
 * event payload — the proxy fails to translate the model's native
 * tool-call format into the SDK's structured `tool_use` event. The
 * SDK then never recognises a real tool call, never executes a tool,
 * never produces a `tool_result`, and the run still terminates with
 * a clean `done`. The runner used to write that raw XML into the
 * task session as if it were the model's answer, and mark the run
 * `succeeded`.
 *
 * Defence: at end of stream, if `toolResultCount === 0` AND
 * `assistantText` matches a pseudo-tool-call XML pattern (`<tool_call>`
 * or `<tool_call_list>`), flip status to `'failed'` with a clear
 * "tools not executed" error. The runner persists that pseudo-XML to
 * the chat session anyway (so the user can see what the model
 * actually said) but the run row is correctly terminal-failed and
 * the recurring-task scheduler doesn't keep firing into a broken
 * config.
 *
 * **No durable resume** — the v2 plan's hard line. When the runner
 * sees `permission_request` it cancels the stream completely. The
 * partial assistant text is persisted with `task_run_id` metadata so
 * the user can see what the agent was thinking; choosing "Re-run"
 * starts a brand new run with a fresh runId from scratch.
 */

import type { ClaudeStreamOptions, SSEEventType } from '@/types';

export type HeadlessRunStatus = 'succeeded' | 'failed' | 'waiting_for_permission';

export interface HeadlessRunResult {
  status: HeadlessRunStatus;
  /** Accumulated assistant text from `text` SSE events. */
  assistantText: string;
  /** When status='waiting_for_permission', the tool that triggered the gate. */
  pendingPermission?: {
    toolName: string;
    toolInput: unknown;
  };
  /** When status='failed', the error message. */
  error?: string;
  /**
   * SDK session id captured from `status` (init) or `result` (final)
   * events. The runner persists this back to `chat_sessions.sdk_session_id`
   * so the next scheduled run can SDK-resume instead of starting from
   * scratch. Undefined when streamClaude never emitted one (e.g. early
   * permission abort before init landed).
   */
  sdkSessionId?: string;
  /** Number of `tool_use` events the SDK emitted during this run. */
  toolUseCount: number;
  /** Number of `tool_result` events the SDK emitted during this run. */
  toolResultCount: number;
}

interface ParsedSSEEvent {
  type: SSEEventType;
  data: unknown;
}

/**
 * Codex P2 fix — `formatSSE` in claude-client wraps an SSEEvent
 * `{type, data: string}` into `data: <JSON>\n\n`, where the inner
 * `data` is itself a JSON-stringified payload (see e.g. claude-client
 * line ~1011 for permission_request, ~1515 for result, ~1735 for
 * status). After `JSON.parse` the SSE block, our `evt.data` is a
 * STRING containing the real JSON, not the parsed object. Earlier rev
 * checked `typeof evt.data === 'object'` → permanently false → tool
 * name / input / sdk_session_id were silently lost.
 *
 * normalizeEventData attempts a single `JSON.parse` on string inputs
 * and returns the parsed object on success. On parse failure (e.g.
 * a `text` event whose data is a raw text delta, not JSON) it falls
 * back to the original value so existing string-data branches keep
 * working unchanged.
 */
function normalizeEventData(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

/**
 * Pure helper: parse SSE event blocks out of an accumulating string
 * buffer. Each event is `data: <json>\n\n` per `formatSSE` in
 * claude-client. Returns parsed events + the trailing incomplete
 * remainder so the caller can re-feed it on the next read.
 *
 * Exported for testability.
 */
export function parseSSEBuffer(buffer: string): {
  events: ParsedSSEEvent[];
  remaining: string;
} {
  const events: ParsedSSEEvent[] = [];
  // Block separator is the canonical SSE \n\n. Everything before the
  // last separator is complete; anything after is partial.
  const lastSep = buffer.lastIndexOf('\n\n');
  if (lastSep === -1) {
    return { events: [], remaining: buffer };
  }
  const completeBlocks = buffer.slice(0, lastSep).split('\n\n');
  const remaining = buffer.slice(lastSep + 2);
  for (const block of completeBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith('data:')) continue;
    const jsonStr = trimmed.slice(5).trim();
    try {
      const parsed = JSON.parse(jsonStr) as { type?: string; data?: unknown };
      if (parsed && typeof parsed.type === 'string') {
        events.push({ type: parsed.type as SSEEventType, data: parsed.data });
      }
    } catch {
      // skip malformed event
    }
  }
  return { events, remaining };
}

/**
 * Codex P2 follow-up — pseudo tool-call XML detector.
 *
 * Pattern targets the two shapes proxied non-Claude models (GLM in
 * particular) emit when their native tool-call format isn't
 * translated into the SDK's `tool_use` protocol:
 *
 *   - `<tool_call name="...">...</tool_call>`
 *   - `<tool_call_list>...</tool_call_list>`
 *
 * Match is case-insensitive + tolerates leading attributes / whitespace.
 * Anchored at `<tool_call` so we don't false-match user prose that
 * happens to mention the phrase ("we have a tool_call concept").
 *
 * Exported for unit tests.
 */
export function detectPseudoToolCallXml(text: string): boolean {
  return /<tool_call(?:_list)?[\s>]/i.test(text);
}

/**
 * Codex P1 — timeout fuses on top of the consume loop.
 *
 * `maxTotalMs` (default 5 min) caps the total wall-clock for ONE
 * headless run. Catches "tool-call loops on a runtime that doesn't
 * emit a final `done`": every step completes successfully, the SDK
 * says step_complete, but no `done` event ever arrives so the
 * consumer blocks on reader.read() forever. The total fuse aborts
 * the underlying stream and returns failed status.
 *
 * `maxIdleMs` (default 90s) caps the gap between consecutive SSE
 * events. The total fuse alone can't catch the case where a model
 * is stuck on a single very long step; idle covers that.
 *
 * Both are fuses, NOT the experience layer. Heartbeats with a tight
 * prompt should typically finish in <30s and never trip these. If
 * they routinely do, the prompt is wrong, not the timeout.
 */
export interface ConsumeHeadlessStreamOptions {
  maxTotalMs?: number;
  maxIdleMs?: number;
}

export const DEFAULT_HEADLESS_MAX_TOTAL_MS = 5 * 60 * 1000;
export const DEFAULT_HEADLESS_MAX_IDLE_MS = 90 * 1000;

/**
 * Consume a streamClaude-shaped ReadableStream<string> server-side.
 * Extracted from runClaudeHeadless so unit tests can feed a hand-
 * constructed SSE stream (mocking `text` + `tool_use` + `tool_result`
 * + `done` sequences) without monkey-patching the streamClaude module.
 *
 * `abortController` is the same controller that was passed to
 * `streamClaude`; this consumer calls `.abort()` on permission_request
 * / error so the underlying agent loop tears down instead of leaking.
 */
export async function consumeHeadlessStream(
  stream: ReadableStream<string | Uint8Array>,
  abortController: AbortController,
  opts: ConsumeHeadlessStreamOptions = {},
): Promise<HeadlessRunResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  let assistantText = '';
  let status: HeadlessRunStatus = 'succeeded';
  let pendingPermission: HeadlessRunResult['pendingPermission'] | undefined;
  let errorMsg: string | undefined;
  let earlyExit = false;
  let capturedSdkSessionId: string | undefined;
  let toolUseCount = 0;
  let toolResultCount = 0;

  // Timeout fuses (Codex P1).
  const maxTotalMs = opts.maxTotalMs ?? DEFAULT_HEADLESS_MAX_TOTAL_MS;
  const maxIdleMs = opts.maxIdleMs ?? DEFAULT_HEADLESS_MAX_IDLE_MS;
  const startedAt = Date.now();
  let lastEventAt = startedAt;
  let timedOutReason: 'total' | 'idle' | undefined;
  // Race reader.read() against a timer that resolves "timeout" the
  // moment we exceed either fuse. The timer recomputes on each read
  // so it covers idle gaps relative to the LAST event received.
  const readWithFuses = async (): Promise<{ value: string | Uint8Array | undefined; done: boolean }> => {
    const now = Date.now();
    const totalRemaining = maxTotalMs - (now - startedAt);
    const idleRemaining = maxIdleMs - (now - lastEventAt);
    const remaining = Math.max(0, Math.min(totalRemaining, idleRemaining));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<{ value: undefined; done: true; __timeout: 'total' | 'idle' }>((resolve) => {
      timer = setTimeout(() => {
        const reason: 'total' | 'idle' = (Date.now() - startedAt) >= maxTotalMs ? 'total' : 'idle';
        resolve({ value: undefined, done: true, __timeout: reason });
      }, remaining);
    });
    try {
      const result = await Promise.race([reader.read(), timeoutPromise]);
      const r = result as { value?: string | Uint8Array; done: boolean; __timeout?: 'total' | 'idle' };
      if (r.__timeout) {
        timedOutReason = r.__timeout;
        return { value: undefined, done: true };
      }
      return { value: r.value as string | Uint8Array | undefined, done: r.done };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  try {
    while (!earlyExit) {
      const { value, done } = await readWithFuses();
      if (done) break;
      lastEventAt = Date.now();
      buffer += typeof value === 'string' ? value : decoder.decode(value, { stream: true });

      const parsed = parseSSEBuffer(buffer);
      buffer = parsed.remaining;

      for (const evt of parsed.events) {
        if (evt.type === 'text') {
          // `text` data is the raw text delta (claude-client enqueues
          // `data: <delta>` directly, not stringified JSON). Skip the
          // normalize step — JSON.parse on `"true"` / `"42"` / `null`
          // would silently turn a legitimate text fragment into a
          // boolean/number/null and drop it.
          if (typeof evt.data === 'string') {
            assistantText += evt.data;
          }
          continue;
        }

        // Codex P2 — every non-text event carries a JSON-stringified
        // payload (formatSSE wraps `{type, data: <stringified>}`),
        // so we must JSON.parse `evt.data` before reading fields.
        // Without this normalize step, permission_request loses
        // tool name/input and result/status loses session_id.
        const data = normalizeEventData(evt.data);

        if (evt.type === 'tool_use') {
          // Count only — the SDK's surrounding `text` events carry
          // the model's narrative; the tool_use block itself is the
          // structured call (name + input). For headless task
          // sessions the user wants the FINAL prose answer, not the
          // tool internals. We still need the count so the
          // pseudo-XML detector below can distinguish "model emitted
          // fake XML" from "model used real tools".
          toolUseCount += 1;
        } else if (evt.type === 'tool_result') {
          // Same: count only. tool_result content gets re-fed to the
          // model and surfaces in the next text event as part of the
          // model's answer.
          toolResultCount += 1;
        } else if (evt.type === 'tool_output') {
          // SDK streams stderr / progress here during tool execution.
          // Headless treats it as observed-but-noisy: don't append to
          // assistantText (it's tool internals), don't count (it's
          // not a discrete tool round).
        } else if (evt.type === 'permission_request') {
          // Capture the pending permission, then abort the stream
          // so the SDK's `await registerPendingPermission(...)` rejects
          // and the agent process tears down cleanly. The runner
          // treats this as a paused run: partial text gets persisted,
          // user must re-run or abandon (no durable resume).
          let toolName = '';
          let toolInput: unknown = undefined;
          if (data && typeof data === 'object') {
            const d = data as { toolName?: string; toolInput?: unknown; tool_name?: string; tool_input?: unknown };
            toolName = d.toolName ?? d.tool_name ?? '';
            toolInput = d.toolInput ?? d.tool_input;
          }
          pendingPermission = { toolName, toolInput };
          status = 'waiting_for_permission';
          earlyExit = true;
          try { abortController.abort(); } catch { /* ignore */ }
          break;
        } else if (evt.type === 'error') {
          errorMsg = (typeof data === 'string' ? data : JSON.stringify(data)) || 'Stream error';
          status = 'failed';
          earlyExit = true;
          try { abortController.abort(); } catch { /* ignore */ }
          break;
        } else if (evt.type === 'status') {
          // Init / runtime status events carry `session_id` once the
          // SDK assigns it. Capture for runner-side persist parity
          // with chat route.ts collectStreamResponse status branch.
          if (data && typeof data === 'object') {
            const sid = (data as { session_id?: unknown }).session_id;
            if (typeof sid === 'string' && sid) capturedSdkSessionId = sid;
          }
        } else if (evt.type === 'result') {
          // Final result event also carries the SDK session id; chat
          // route.ts double-captures here in case status was missed.
          // We mirror the same defense.
          if (data && typeof data === 'object') {
            const sid = (data as { session_id?: unknown }).session_id;
            if (typeof sid === 'string' && sid) capturedSdkSessionId = sid;
          }
        } else if (evt.type === 'done') {
          earlyExit = true;
          break;
        }
        // thinking / mode_changed / task_update / keep_alive / etc.
        // — observed but not added to the message body in v1.
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  // Codex P1 — timeout fuses tripped: tear down the underlying stream
  // and mark the run failed with a reason the user can act on. The
  // pseudo-XML / integrity branch below is skipped: a timeout is the
  // most specific diagnosis we have, no need to second-guess.
  if (timedOutReason) {
    try { abortController.abort(); } catch { /* ignore */ }
    status = 'failed';
    errorMsg = errorMsg
      || (timedOutReason === 'total'
        ? `Headless run exceeded the maximum wall-clock window (${Math.round(maxTotalMs / 1000)}s). The agent likely got stuck in a tool-call loop without emitting a final \`done\`. This is a fuse, not a normal failure mode — investigate the prompt / runtime if you see it routinely.`
        : `Headless run idle for too long (${Math.round(maxIdleMs / 1000)}s without any SSE event). The agent is stalled mid-step.`);
  }

  // Two complementary integrity checks on the otherwise-succeeded
  // path. permission_request / error already wrote their own status;
  // an explicit failure shouldn't be re-overwritten by either of
  // these.
  if (status === 'succeeded') {
    if (toolUseCount > toolResultCount) {
      // Codex P2 follow-up — tool-execution integrity. The SDK
      // emitted N tool_use events but only K (< N) tool_result
      // events made it back. Possible causes: tool runtime crashed
      // mid-call, aborted handler, SDK bug, network drop. The
      // model's final text says it's "done", but at least one tool
      // call silently lost its result. Mark failed so the recurring
      // scheduler doesn't trust the partial outcome — and the user
      // sees a clear "工具调用未返回结果" instead of a fake
      // "completed".
      //
      // This branch wins over pseudo-XML because if any tool_use
      // fired, the SDK *did* recognise tools — the failure mode is
      // mid-execution loss, not a non-translating proxy.
      status = 'failed';
      errorMsg = errorMsg
        || `工具调用未返回结果：SDK 发出了 ${toolUseCount} 个 tool_use 事件，但只收到 ${toolResultCount} 个 tool_result。工具调用可能在执行中失败或被中断，模型最终的回答不可信。`;
    } else if (toolUseCount === 0 && toolResultCount === 0 && detectPseudoToolCallXml(assistantText)) {
      // Pseudo-tool-call XML — a separate failure mode from above.
      // Here the SDK saw NO tool events at all, which means the
      // model's tool-call format never reached the SDK as
      // structured `tool_use`. The proxy isn't translating, the
      // provider doesn't expose tools, or both. The model just
      // dumped its native tool-call XML into the text channel.
      // Recurring scheduler must stop firing into this config.
      status = 'failed';
      errorMsg = errorMsg
        || '工具未执行：模型输出了 <tool_call> 形式的伪工具调用 XML，但 SDK / 代理没有把它翻译成真正的 tool_use 事件，没有任何工具被实际调用。请检查当前 provider/runtime 是否正确暴露了工具（MCP 服务器、内置工具是否启用）。';
    }
  }

  return {
    status,
    assistantText,
    pendingPermission,
    error: errorMsg,
    sdkSessionId: capturedSdkSessionId,
    toolUseCount,
    toolResultCount,
  };
}

/**
 * Headless wrapper around streamClaude. Returns a single result;
 * never throws on agent / permission events (only on infrastructure
 * failures like the underlying streamClaude itself throwing).
 *
 * `headlessOptions` lets the caller dial the consumer-side timeout
 * fuses (defaults are deliberately conservative — see
 * `DEFAULT_HEADLESS_MAX_TOTAL_MS` / `DEFAULT_HEADLESS_MAX_IDLE_MS`).
 * Heartbeat callers tighten these because heartbeat work is by
 * design short; normal ai_task callers can leave them at default.
 */
export async function runClaudeHeadless(
  options: ClaudeStreamOptions,
  headlessOptions: ConsumeHeadlessStreamOptions = {},
): Promise<HeadlessRunResult> {
  // Lazy-import to keep the runner's static graph small and avoid
  // pulling claude-client into module-load-time graphs.
  const { streamClaude } = await import('./claude-client');

  // Always own an abort controller so we can stop the underlying
  // agent on permission_request / error. If caller passed one, we
  // still call abort() through it to share the signal.
  const abortController = options.abortController ?? new AbortController();
  const opts: ClaudeStreamOptions = { ...options, abortController };

  const stream = streamClaude(opts);
  return consumeHeadlessStream(stream, abortController, headlessOptions);
}
