/**
 * Phase 5b — Responses input items → ai-sdk ModelMessage[].
 *
 * Codex sends turn state as a flat `ResponsesInputItem[]`. ai-sdk's
 * `streamText` consumes `messages: ModelMessage[]` with the
 * conversation already arranged into role-tagged turns. The
 * translator walks the input array and emits one ModelMessage per
 * logical turn, merging contiguous function_call_output items into
 * the tool-result message they belong to.
 *
 * Mapping:
 *
 *   { type: 'message', role: 'user', content: [{ input_text }, ...] }
 *     → { role: 'user', content: <flattened> }
 *   { type: 'message', role: 'assistant', content: [{ output_text }, ...] }
 *     → { role: 'assistant', content: <flattened> }
 *   { type: 'function_call', ... }
 *     → assistant message with content: [{ type: 'tool-call', ... }]
 *       (merged into the previous assistant message if it exists)
 *   { type: 'function_call_output', ... }
 *     → tool message: { role: 'tool', content: [{ type: 'tool-result', ... }] }
 *
 * Image content blocks (input_image) pass through as ai-sdk's
 * `ImagePart`. Codex doesn't currently emit those for chat, but the
 * adapter handles them so we don't surprise a future Codex version.
 *
 * Reasoning blocks (Anthropic thinking) inside the assistant
 * message would need a per-SDK provider-specific path; Codex doesn't
 * emit them in the request today, so we don't translate them here.
 */

import type { ModelMessage } from 'ai';
import type {
  ResponsesInputItem,
  ResponsesContentBlock,
} from './types';

/** Mirror of ai-sdk's JSONValue — recursive primitive/array/object. */
type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Fallback toolName when we can't correlate a function_call_output back
 *  to its function_call. Surfaced so the chain is debuggable downstream
 *  instead of disappearing into a misnamed tool-result. */
const ORPHAN_TOOL_RESULT_SENTINEL = '__orphan_function_call_output__';

/**
 * Translate a Responses input array into ai-sdk ModelMessage[].
 * Caller prepends the system message (from `instructions`) if any.
 *
 * Phase 5b smoke round 7 (2026-05-16) — tool-result toolName fix.
 *
 * Codex's Responses request body interleaves `function_call` and
 * `function_call_output` items keyed by `call_id`. ai-sdk's
 * `tool-result` content part also expects a `toolName` that matches
 * what was declared on the preceding `tool-call` — providers like
 * Anthropic and OpenAI Responses use the name to look up the tool
 * schema and route the result back to the model.
 *
 * Pre-fix the translator wrote a sentinel string `'__from_responses_proxy__'`
 * for every tool-result and relied on the comment "ai-sdk doesn't use
 * this for routing; the toolCallId is the matcher". That comment was
 * wrong: downstream providers DO use the name. The visible symptom
 * was tool calls finishing without continuation (e.g. GPT-Image-2.0
 * skill completes but Codex never produces the final assistant turn
 * because the provider can't reconcile the result).
 *
 * The fix walks the input array once first to build a call_id →
 * function_call.name map, then translates linearly using that map.
 * Orphan function_call_outputs (no matching function_call in the same
 * request — should only happen on malformed inputs) fall back to a
 * named sentinel so the divergence stays visible.
 */
export function translateResponsesInput(
  input: ResponsesInputItem[],
): ModelMessage[] {
  // Pass 1 — collect call_id → toolName from every function_call.
  // Codex emits function_call BEFORE the corresponding _output in the
  // same request, but we do a separate pass first so any future
  // re-ordering doesn't quietly break correlation.
  const callIdToToolName = new Map<string, string>();
  for (const item of input) {
    if (item.type === 'function_call') {
      callIdToToolName.set(item.call_id, item.name);
    }
  }

  const out: ModelMessage[] = [];

  for (const item of input) {
    if (item.type === 'message') {
      if (item.role === 'system' || item.role === 'developer') {
        // ai-sdk treats developer as system. Both map to the
        // `system` role since the SDK doesn't expose a developer
        // distinction.
        out.push({
          role: 'system',
          content: flattenTextOnly(item.content),
        });
      } else if (item.role === 'user') {
        out.push({
          role: 'user',
          content: translateUserContent(item.content),
        });
      } else if (item.role === 'assistant') {
        out.push({
          role: 'assistant',
          content: translateAssistantContent(item.content),
        });
      }
    } else if (item.type === 'function_call') {
      // Merge into the previous assistant message if the previous
      // item was already an assistant message (typical Codex shape:
      // assistant text → function_call → function_call →
      // function_call_output → assistant text). ai-sdk's tool-call
      // content part lives on the assistant message.
      const prev = out[out.length - 1];
      const toolCallPart = {
        type: 'tool-call' as const,
        toolCallId: item.call_id,
        toolName: item.name,
        input: safeParseJson(item.arguments) ?? item.arguments,
      };
      if (prev && prev.role === 'assistant' && Array.isArray(prev.content)) {
        prev.content.push(toolCallPart);
      } else {
        out.push({
          role: 'assistant',
          content: [toolCallPart],
        });
      }
    } else if (item.type === 'function_call_output') {
      // ai-sdk tool result messages MUST come after the matching
      // assistant tool-call AND carry the real toolName so the
      // downstream provider (Anthropic, OpenAI Responses, etc.) can
      // route the result back to the tool definition. The call_id
      // alone isn't enough — that's the round-7 regression we hit.
      const resolvedName = callIdToToolName.get(item.call_id);
      const toolName = resolvedName ?? ORPHAN_TOOL_RESULT_SENTINEL;
      if (!resolvedName) {
        // Visible warning so an orphan result doesn't disappear into
        // a misnamed message. The proxy adapter classifies upstream
        // failures via classifyUpstreamError; this surfaces in
        // dev/prod logs without dropping the request entirely.
        console.warn(
          `[codex.proxy.translate-input] function_call_output(call_id=${item.call_id}) has no matching function_call in this request. ` +
            `Routing result to sentinel toolName "${ORPHAN_TOOL_RESULT_SENTINEL}" — provider may fail to reconcile.`,
        );
      }
      // Output is JSON-parsed when possible (so the model sees a
      // structured value), falls back to plain text otherwise. This
      // matches how Codex itself encodes tool output downstream.
      const parsed = safeParseJson(item.output);
      const output = parsed !== undefined
        ? { type: 'json' as const, value: parsed as JsonValue }
        : { type: 'text' as const, value: item.output };
      out.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result' as const,
            toolCallId: item.call_id,
            toolName,
            output,
          },
        ],
      });
    }
  }

  return out;
}

/** Best-effort JSON.parse — returns undefined on failure. */
function safeParseJson(raw: string): unknown | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Flatten text-only content (for system / developer roles). */
function flattenTextOnly(content: ResponsesContentBlock[]): string {
  return content
    .filter(b => b.type === 'input_text' || b.type === 'output_text')
    .map(b => (b.type === 'input_text' || b.type === 'output_text') ? b.text : '')
    .join('\n');
}

type UserContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string };

/** Translate user-side content (text + image) for ai-sdk. */
function translateUserContent(content: ResponsesContentBlock[]): UserContentPart[] {
  const parts: UserContentPart[] = [];
  for (const block of content) {
    if (block.type === 'input_text') {
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'output_text') {
      // Shouldn't normally appear on a user message, but Codex may
      // include echoed text in odd cases. Treat as plain text.
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'input_image') {
      parts.push({ type: 'image', image: block.image_url });
    }
  }
  return parts;
}

type AssistantContentPart =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown };

/** Translate assistant-side content (text only at this layer — tool calls handled separately). */
function translateAssistantContent(content: ResponsesContentBlock[]): AssistantContentPart[] {
  const parts: AssistantContentPart[] = [];
  for (const block of content) {
    if (block.type === 'output_text' || block.type === 'input_text') {
      parts.push({ type: 'text', text: block.text });
    }
    // input_image on assistant role: shouldn't happen; ignore.
  }
  return parts;
}
