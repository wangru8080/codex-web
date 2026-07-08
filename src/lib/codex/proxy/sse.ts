/**
 * Phase 5b — SSE encoder for the Codex Responses proxy.
 *
 * Codex's HTTP client (and the official `@openai/codex-sdk`'s
 * `responsesProxy.ts` test fixture, which is the canonical contract
 * source) consumes the OpenAI Responses streaming format with the
 * `event: <type>` line REQUIRED in every frame:
 *
 *   event: response.created\n
 *   data: {"type":"response.created","response":{"id":"..."}}\n\n
 *
 *   event: response.output_text.delta\n
 *   data: {"type":"response.output_text.delta","delta":"hi"}\n\n
 *
 *   event: response.output_item.done\n
 *   data: {"type":"response.output_item.done","item":{...}}\n\n
 *
 *   event: response.completed\n
 *   data: {"type":"response.completed","response":{...}}\n\n
 *
 *   data: [DONE]\n\n
 *
 * Pre-fix this encoder emitted only `data: ...` lines. Codex tolerated
 * `response.created` / `response.completed` either way but the SDK's
 * fixture explicitly tags every event, so we now match the fixture
 * to avoid quirks downstream.
 *
 * The encoder is intentionally bare — one `encodeEvent` for the JSON
 * frame, one `encodeDone` for the terminator. The adapter pushes
 * `ResponsesEvent` objects into a `ReadableStream<Uint8Array>` via
 * these helpers; the route file returns that stream as the response
 * body with `Content-Type: text/event-stream`.
 */

import type { ResponsesEvent, ResponsesFailedEvent } from './types';

const encoder = new TextEncoder();

export function encodeEvent(event: ResponsesEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export function encodeDone(): Uint8Array {
  return encoder.encode(`data: [DONE]\n\n`);
}

/**
 * Build a single-event stream body for the "we failed before the
 * adapter ever made it to the upstream" path. Codex's app-server
 * parser (`codex-rs/codex-api/src/sse/responses.rs`
 * `process_responses_event`) only consumes `response.failed` for
 * stream errors — the SDK fixture's `{type: 'error'}` form falls
 * through unhandled. We use `response.failed` here so the failure
 * surfaces as a structured ApiError on the Codex side instead of
 * "stream closed before response.completed".
 *
 * The DONE marker is still required: Codex's reader exits the read
 * loop on `[DONE]` regardless of what preceded it.
 */
export function makeFailureStream(failed: ResponsesFailedEvent): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encodeEvent(failed));
      controller.enqueue(encodeDone());
      controller.close();
    },
  });
}
