/**
 * Phase 5b — Codex Responses-API proxy types.
 *
 * Narrowed subset of OpenAI's Responses-API that Codex's HTTP client
 * sends through the `codepilot_proxy` model_provider injection
 * (see `src/lib/codex/provider-proxy.ts`). We don't try to mirror
 * the full Responses surface — only the fields Codex actually emits +
 * the events Codex's reader actually consumes.
 *
 * Source of truth for the wire shape: Codex's
 * `app-server-protocol`'s `Responses` config + Codex CLI's own
 * Responses request/response handling. CodexWeb's adapter sits
 * between this wire format and the ai-sdk `LanguageModelV2` it
 * already uses for the Native runtime — provider resolution happens
 * via `createModel(...)`, and the adapter only translates the
 * Responses envelope ↔ ai-sdk `ModelMessage[] + ToolSet` /
 * `streamText` events.
 *
 * Field-level docstrings explain how each field maps to ai-sdk;
 * the adapter implementation keeps those in lockstep so a future
 * Responses-spec extension flows through with a single touch point.
 */

// ─────────────────────────────────────────────────────────────────────
// Request
// ─────────────────────────────────────────────────────────────────────

/**
 * Codex passes its accumulated turn state as `input: ResponsesInputItem[]`.
 * Three item kinds today:
 *
 *   message            user / assistant text turn
 *   function_call      assistant emitted a tool call (output role)
 *   function_call_output result of a previous function_call (user role)
 *
 * The adapter walks the array in order and flattens it into the
 * `ModelMessage[]` ai-sdk expects.
 */
export type ResponsesInputItem =
  | ResponsesMessageItem
  | ResponsesFunctionCallItem
  | ResponsesFunctionCallOutputItem;

export interface ResponsesMessageItem {
  type: 'message';
  /** Role for the turn. Codex sends `user` or `assistant`. */
  role: 'user' | 'assistant' | 'system' | 'developer';
  /** Content blocks. Codex today emits `input_text` for user input,
   *  `output_text` for assistant text. Image inputs encoded as
   *  `input_image` with a URL string. */
  content: ResponsesContentBlock[];
}

export type ResponsesContentBlock =
  | { type: 'input_text'; text: string }
  | { type: 'output_text'; text: string }
  | { type: 'input_image'; image_url: string };

export interface ResponsesFunctionCallItem {
  type: 'function_call';
  /** Codex emits a unique id per call so subsequent function_call_output
   *  items can reference it. The adapter passes it straight through
   *  to ai-sdk's `toolCallId`. */
  call_id: string;
  /** Tool name. Matches the `name` declared in the request's `tools[]`. */
  name: string;
  /** JSON-encoded arguments. Codex sends a string (not an object) per
   *  the Responses spec. The adapter parses lazily so a malformed
   *  payload surfaces as a runtime error, not a translation error. */
  arguments: string;
}

export interface ResponsesFunctionCallOutputItem {
  type: 'function_call_output';
  call_id: string;
  /** Output payload — JSON-encoded if structured, raw string otherwise.
   *  ai-sdk's tool_result content takes a JSON value, so the adapter
   *  attempts JSON.parse first and falls back to the raw string. */
  output: string;
}

/**
 * Tool declaration in the Responses request.
 *
 * Codex emits the `function` shape (subset of OpenAI's tools[] schema)
 * for everything except the built-in shell/apply_patch tools. The
 * adapter forwards function tools straight to ai-sdk; non-function
 * tools (Codex's custom shell / apply_patch / future plugin types)
 * are preserved as `ClassifiedNonFunctionTool[]` for the bridge layer
 * to inspect — Phase 5c routes around them rather than dropping
 * them silently (the pre-5c behaviour caused GLM/Kimi to see Skill
 * text mentioning a tool that wasn't actually in their function list).
 */
export type ResponsesTool = ResponsesFunctionTool;

export interface ResponsesFunctionTool {
  type: 'function';
  /** Tool identifier. Matches the `name` referenced by function_call items. */
  name: string;
  /** Short description for the model. */
  description?: string;
  /** JSON Schema for the arguments. ai-sdk consumes this verbatim. */
  parameters?: Record<string, unknown>;
  /** Strict-mode flag — ai-sdk doesn't expose a direct equivalent;
   *  the adapter ignores this field but preserves it on tool_call
   *  echo so Codex's correlator stays consistent. */
  strict?: boolean;
}

/**
 * Phase 5c (2026-05-16) — non-function tools encountered in the
 * incoming Responses request.
 *
 * Codex's real `turn/start` payload mixes function tools with
 * Codex-specific entries like `{ type: 'custom', ... }` (shell /
 * apply_patch surfaces). Pre-5c we silently dropped them — the
 * "non-function tools NOT supported yet" branch in
 * `translate-tools.ts` was the visible part of that policy. The drop
 * was load-bearing for two failure modes:
 *
 *   1. Codex native tools (shell / apply_patch) reach the proxy when
 *      a CodexWeb provider is targeted; the proxy can't execute
 *      them, but knowing they were requested helps diagnose smoke
 *      failures.
 *   2. Future Codex plugin types would land here as `type: 'plugin'`
 *      or similar; surfacing them as `unsupported_tool_kind` (rather
 *      than dropping) tells the user the proxy hasn't been taught
 *      that shape yet.
 *
 * `rawType` carries Codex's original `type` string verbatim so the
 * bridge / log line can distinguish `custom` from `plugin` from a
 * spelling error.
 */
export interface ClassifiedNonFunctionTool {
  /** Raw `type` field from Codex's tool entry (e.g. `'custom'`). */
  rawType: string;
  /** Optional `name` if Codex supplied one. Codex's `custom` shape
   *  carries name + schema; future shapes may omit them. */
  name?: string;
  /** Whatever extra fields Codex sent (kept JSON-safe). The bridge
   *  layer can stringify for diagnostic logs without re-validating. */
  payload: Record<string, unknown>;
}

export interface ResponsesRequestBody {
  /** Model id from Codex's perspective — the codex_codepilot proxy
   *  decides what to do with it. Codex sends the model name the user
   *  picked in their flow; the adapter resolves the corresponding
   *  CodexWeb provider model via `provider-resolver`. */
  model: string;
  /** Conversation state flattened into ordered items. */
  input: ResponsesInputItem[];
  /** Function-typed tools from the Responses request. `undefined` /
   *  `[]` means no function tools available. Non-function tools live
   *  in `passthroughTools` so the adapter can still see them. */
  tools?: ResponsesTool[];
  /** Phase 5c (2026-05-16) — non-function tools Codex sent (custom /
   *  plugin / etc.). Kept for diagnostics + future bridge work; the
   *  unified adapter logs them so smoke runs can see which Codex
   *  surfaces a CodexWeb provider was being asked to satisfy. */
  passthroughTools?: ClassifiedNonFunctionTool[];
  /** Whether to stream the response. Codex defaults to `true`. */
  stream?: boolean;
  /** Instructions block — Codex's developer-message hook. The
   *  adapter passes through as a `system` ModelMessage prepended
   *  to the conversation. */
  instructions?: string;
  /** Free-form metadata. The adapter ignores. */
  metadata?: Record<string, unknown>;
  /** Reasoning effort. Codex propagates the user's `effort` selection
   *  here; the adapter forwards to ai-sdk via providerOptions when
   *  the underlying SDK accepts it (Anthropic thinking, OpenAI o1
   *  reasoning_effort, etc.). */
  reasoning?: {
    effort?: 'minimal' | 'low' | 'medium' | 'high' | 'max';
  };
  /** OpenAI Responses-API `store` field. The Codex `/responses`
   *  endpoint (chatgpt.com/backend-api/codex/responses) requires
   *  `store: false` on every call; sending true returns HTTP 400
   *  "Store must be set to false". Codex's own HTTP client always
   *  sets this field, so we preserve it and forward it via
   *  `providerOptions.openai.store` in the unified adapter. Default
   *  (when caller omits) is `false` for the openai-oauth path; other
   *  wire formats ignore the field. */
  store?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Stream events (SSE)
//
// Contract sources (Phase 5b smoke round 6, 2026-05-16):
//   - resources/codex/sdk/typescript/tests/responsesProxy.ts
//     (public SDK test fixture — success path event shapes)
//   - resources/codex/codex-rs/codex-api/src/sse/responses.rs
//     `process_responses_event` (Codex app-server's actual stream
//     parser — defines the events Codex production consumes)
//
// Critical asymmetry between the two sources: the SDK fixture's
// `responseFailed()` emits `{type: 'error', error: {code, message}}`,
// but Codex's app-server parser (`process_responses_event`) only
// matches `response.failed`, NOT `error`. Phase 5b smoke round 5
// initially aligned the error path with the SDK fixture; round 6
// reverted that — the app-server JSON-RPC path is the production
// channel today, so streaming failures MUST use `response.failed` or
// they fall through to "stream closed before response.completed" and
// the user sees a silent failure. The success path stays aligned to
// the SDK fixture (which is what both Codex's parser AND the SDK's
// own reader accept).
//
// Load-bearing events:
//
//   response.created           Marker; carries response.id Codex echoes back.
//   response.output_item.added Optional but recommended; signals a new item.
//   response.output_text.delta Incremental assistant text. Streamed greedily.
//   response.output_item.done  REQUIRED to LAND an assistant message or
//                              function_call. `handle_output_item_done`
//                              in `codex-rs/core/src/stream_events_utils.rs`
//                              is what records the item into the turn.
//                              Pre-Phase-5b smoke saw GLM/Kimi return
//                              "completed but blank" because we emitted
//                              only output_text.delta + completed without
//                              this event.
//   response.completed         Final marker. `response.usage` only — NO
//                              `status` / `finish_reason`. Usage shape is
//                              `{ input_tokens, input_tokens_details: { cached_tokens } | null,
//                                 output_tokens, output_tokens_details: { reasoning_tokens } | null,
//                                 total_tokens }`.
//   response.failed            Terminal error event. Shape per Codex
//                              app-server parser:
//                              `{ type: 'response.failed', response: { id, error: { code, message } } }`.
//                              Codex reads `response.error.code` to
//                              classify (ContextWindowExceeded /
//                              QuotaExceeded / ServerOverloaded etc.);
//                              `error.message` is surfaced verbatim
//                              to the user.
// ─────────────────────────────────────────────────────────────────────

export type ResponsesEvent =
  | ResponsesCreatedEvent
  | ResponsesInProgressEvent
  | ResponsesOutputItemAddedEvent
  | ResponsesOutputTextDeltaEvent
  | ResponsesOutputItemDoneEvent
  | ResponsesCompletedEvent
  | ResponsesFailedEvent;

export interface ResponsesCreatedEvent {
  type: 'response.created';
  response: { id: string; model?: string; created_at?: number };
}

export interface ResponsesInProgressEvent {
  type: 'response.in_progress';
  response: { id: string };
}

/**
 * `response.output_item.added` — optional pre-amble for a new output
 * item. The SDK fixture only emits `output_item.done`; the added
 * event is what Codex's streaming reader uses to mount an
 * incremental UI slot. Phase 5b only emits `added` for message
 * items today — function_call lands wholesale in `done` since we
 * don't stream args separately.
 */
export interface ResponsesOutputItemAddedEvent {
  type: 'response.output_item.added';
  output_index?: number;
  item: {
    id: string;
    type: 'message';
    role: 'assistant';
    content: { type: 'output_text'; text: string }[];
  };
}

export interface ResponsesOutputTextDeltaEvent {
  type: 'response.output_text.delta';
  /** `output_index` and `item_id` are optional but Codex includes
   *  both upstream. We send `item_id` when present so a future Codex
   *  version that correlates deltas to items doesn't choke. */
  output_index?: number;
  item_id?: string;
  delta: string;
}

/**
 * `response.output_item.done` — REQUIRED. Codex's
 * `handle_output_item_done` (codex-rs/core/src/stream_events_utils.rs)
 * is what records the final item into the turn's items array. Missing
 * this event = "completed but blank" UI failure.
 *
 * The `item` payload mirrors Codex's `ResponseItem` enum: message,
 * function_call, reasoning, web_search_call, image_generation_call.
 * Phase 5b only emits message + function_call. Shape is shared with
 * the non-stream `ResponsesOutputItem` declared below — they're the
 * same conceptual record (the final form of an output item).
 */
export interface ResponsesOutputItemDoneEvent {
  type: 'response.output_item.done';
  output_index?: number;
  item: ResponsesOutputItem;
}

export interface ResponsesCompletedEvent {
  type: 'response.completed';
  response: {
    id: string;
    usage?: ResponsesUsage;
  };
}

/**
 * Terminal error event consumed by Codex's app-server SSE parser
 * (`codex-rs/codex-api/src/sse/responses.rs`
 * `process_responses_event` → `"response.failed"` arm). The parser
 * reads `response.error.code` to classify the failure into one of:
 *   - context_length_exceeded → ApiError::ContextWindowExceeded
 *   - insufficient_quota / rate_limit → ApiError::QuotaExceeded
 *   - usage_not_included → ApiError::UsageNotIncluded
 *   - cyber_policy → ApiError::CyberPolicy
 *   - invalid_prompt → ApiError::InvalidRequest
 *   - server_overloaded → ApiError::ServerOverloaded
 *   - otherwise → ApiError::Retryable with message + retry-after
 *
 * `error.message` is the user-facing string surfaced in the chat.
 *
 * Phase 5b smoke round 5 mistakenly aligned this with the public
 * SDK fixture's `{type: 'error', error}` shape, but the app-server
 * parser doesn't match `error` — falls through to the trace
 * "unhandled responses event" branch, then `[DONE]` never converts
 * to a completed event, and Codex throws "stream closed before
 * response.completed". Round 6 reverted to `response.failed` so the
 * failure surfaces as a proper structured error.
 *
 * The SDK runStreamed() POC (if/when we adopt @openai/codex-sdk for
 * execution) will use the `error` shape — at that point this type
 * gets paired with a sibling SDK-flavoured failure event, and the
 * caller picks one based on the path.
 */
export interface ResponsesFailedEvent {
  type: 'response.failed';
  response: {
    id: string;
    /** Codex's parser also tolerates `status: 'failed'` / `usage: null`
     *  fields — both optional. We omit unless a future contract test
     *  demands them. */
    error: { code: string; message: string };
  };
}

/**
 * Usage shape per SDK fixture
 * (`sdk/typescript/tests/responsesProxy.ts` + Rust common test fixtures).
 * The `_details` fields can be `null` (matching Codex's serializer)
 * but downstream readers tolerate omission too. We always emit them
 * to stay schema-strict.
 */
export interface ResponsesUsage {
  input_tokens: number;
  input_tokens_details: { cached_tokens: number } | null;
  output_tokens: number;
  output_tokens_details: { reasoning_tokens: number } | null;
  total_tokens: number;
}

// ─────────────────────────────────────────────────────────────────────
// Non-stream response
// ─────────────────────────────────────────────────────────────────────

export interface ResponsesNonStreamResponse {
  id: string;
  object: 'response';
  created_at: number;
  status: 'completed' | 'failed' | 'cancelled';
  model: string;
  output: ResponsesOutputItem[];
  usage: ResponsesUsage;
  finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  error?: ResponsesErrorPayload;
}

/**
 * Final shape of an output item — used both inside
 * `response.output_item.done` (SSE stream) and inside
 * `ResponsesNonStreamResponse.output[]` (non-stream JSON). Codex's
 * `handle_output_item_done` accepts this shape uniformly.
 */
export type ResponsesOutputItem =
  | { id: string; type: 'message'; role: 'assistant'; content: ResponsesContentBlock[] }
  | { id?: string; type: 'function_call'; call_id: string; name: string; arguments: string };

// ─────────────────────────────────────────────────────────────────────
// Errors
//
// Structured error envelope shared by stream `response.failed` and
// non-stream `error` field. The adapter is the single producer; all
// upstream errors (provider HTTP failures, credential missing, quota,
// timeout, tool translation errors) map to one of these codes so
// Codex's reader / our own surface can branch on code rather than
// pattern-matching the message.
// ─────────────────────────────────────────────────────────────────────

export type ResponsesErrorCode =
  /** Bad / unparseable Responses request body. */
  | 'invalid_request'
  /** `x-codepilot-target-provider` header missing or unknown. */
  | 'provider_not_targeted'
  | 'provider_not_found'
  /** Provider has no credentials configured (api_key / oauth missing). */
  | 'credentials_missing'
  /** Provider sat in the catalog but the proxy can't route the
   *  request through an adapter — almost always the `unknown` compat
   *  tier (wire format unidentified). Carries `compat` and `family`
   *  in context for diagnostics. */
  | 'adapter_not_implemented'
  /** Upstream provider returned 4xx (other than 401). */
  | 'upstream_client_error'
  /** Upstream provider returned 401. */
  | 'upstream_unauthorized'
  /** Upstream provider returned 429 / quota exceeded. */
  | 'upstream_rate_limited'
  /** Upstream provider returned 5xx. */
  | 'upstream_server_error'
  /** Total / idle timeout on the upstream call. */
  | 'upstream_timeout'
  /** Tool call referenced a tool not declared in the tools[] array. */
  | 'unknown_tool'
  /** Tool kind we don't translate yet (built-in shell / apply_patch). */
  | 'unsupported_tool_kind'
  /** Anything we didn't classify. Carries `cause` in context. */
  | 'internal_error';

export interface ResponsesErrorPayload {
  code: ResponsesErrorCode;
  /** Human-readable. UI surfaces this directly; use proper sentence
   *  with the constraint named (no codes, no stack traces). */
  message: string;
  /** Optional structured context — provider id, compat tier, upstream
   *  status code, etc. Stays JSON-serialisable. */
  context?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────
// Adapter contract
//
// Single entry point: parse + validate the incoming request, resolve
// the target provider, route through ai-sdk, translate output. All
// the wire-format work lives behind this interface so the route file
// stays a thin HTTP shell.
// ─────────────────────────────────────────────────────────────────────

export interface ProxyHandlerInput {
  /** Raw `x-codepilot-target-provider` header value. */
  targetProviderId: string;
  /** Phase 5c (2026-05-16) — `x-codepilot-session-id` header set by
   *  the runtime injection (see `provider-proxy.ts`
   *  `buildCodexProviderProxyInjection`). The unified adapter uses it
   *  to:
   *    1. Mount CodexWeb built-in tools so the targeted provider
   *       gets `codepilot_generate_image` etc. in its tool list.
   *    2. Address the side-channel event bus so tool execution
   *       results flow back to the user's chat UI.
   *  Empty when CodexRuntime didn't supply it (older builds or a
   *  manual smoke run). When empty the bridge is not mounted — the
   *  proxy still serves the original chat-only flow. */
  sessionId: string;
  /** Phase 5c (2026-05-16) — `x-codepilot-workspace-path` header.
   *  Forwarded into bridge tools that need a working directory
   *  (image gen reference-path resolution, memory workspace lookup,
   *  scheduled-task origin recording). May be empty even when
   *  sessionId is present (some chats never set a workspace). */
  workspacePath: string;
  /** Parsed Responses request body. */
  body: ResponsesRequestBody;
  /** Per-call abort signal — wired to the inbound request so Codex
   *  closing the connection cancels the upstream call too. */
  signal: AbortSignal;
}

export interface ProxyStreamResult {
  kind: 'stream';
  /** SSE response body — `data: ${JSON}\n\n` framed. */
  body: ReadableStream<Uint8Array>;
}

export interface ProxyNonStreamResult {
  kind: 'json';
  body: ResponsesNonStreamResponse;
}

export interface ProxyErrorResult {
  kind: 'error';
  /** HTTP status code we return to Codex's HTTP client.
   *  Stream variant: 200 + an SSE body whose first event is
   *  `response.failed`. Non-stream variant: 4xx/5xx + JSON body
   *  with `error.code`. */
  status: number;
  error: ResponsesErrorPayload;
}

export type ProxyResult = ProxyStreamResult | ProxyNonStreamResult | ProxyErrorResult;
