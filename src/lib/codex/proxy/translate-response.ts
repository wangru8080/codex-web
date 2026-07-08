/**
 * Phase 5b — ai-sdk `GenerateTextResult` → Codex Responses JSON body.
 *
 * Used when the inbound request had `stream:false`. Walks the ai-sdk
 * result's content / tool calls and builds the Responses output[]
 * array Codex's reader expects.
 *
 * Mapping:
 *
 *   result.text                → output[0] = message with output_text block
 *   result.toolCalls[i]        → output[i+1] = function_call item
 *   result.usage               → usage (totalUsage preferred)
 *   result.finishReason        → finish_reason (kebab → snake)
 *
 * Tool calls produced by `generateText` are static or dynamic — both
 * carry `toolCallId`, `toolName`, `input`. We forward verbatim.
 */

import type { ResponsesNonStreamResponse, ResponsesUsage } from './types';

interface ToolCallLite {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

interface UsageLite {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  outputTokenDetails?: { reasoningTokens?: number };
}

interface NonStreamResultLite {
  text: string;
  toolCalls: ToolCallLite[];
  finishReason: string;
  totalUsage?: UsageLite;
  usage?: UsageLite;
}

interface TranslateResponseOptions {
  responseId: string;
  model: string;
  result: NonStreamResultLite;
  /** Phase 5c (2026-05-16) — names belonging to the CodexWeb
   *  built-in tool bridge. function_call entries with these names
   *  are dropped from the Codex-visible output[] because the bridge
   *  already executed them server-side. */
  builtinToolNames?: ReadonlySet<string>;
}

export function translateNonStreamResponse(
  opts: TranslateResponseOptions,
): ResponsesNonStreamResponse {
  const { responseId, model, result } = opts;
  const builtinToolNames = opts.builtinToolNames ?? new Set<string>();
  const output: ResponsesNonStreamResponse['output'] = [];

  let idx = 0;
  if (result.text && result.text.length > 0) {
    output.push({
      id: `msg_${responseId}_${idx++}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: result.text }],
    });
  }
  for (const call of result.toolCalls ?? []) {
    // Phase 5c — skip bridge-owned tool calls; Codex doesn't need to
    // see them (matches the suppression rule in translate-stream).
    if (builtinToolNames.has(call.toolName)) continue;
    output.push({
      id: `tool_${responseId}_${idx++}`,
      type: 'function_call',
      call_id: call.toolCallId,
      name: call.toolName,
      arguments: stringifyInput(call.input),
    });
  }

  return {
    id: responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model,
    output,
    usage: translateUsage(result.totalUsage ?? result.usage),
    finish_reason: translateFinishReason(result.finishReason),
  };
}

function stringifyInput(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input === null || input === undefined) return '{}';
  try {
    return JSON.stringify(input);
  } catch {
    return '{}';
  }
}

function translateUsage(usage: UsageLite | undefined): ResponsesUsage {
  const input = usage?.inputTokens ?? 0;
  const output = usage?.outputTokens ?? 0;
  const total = usage?.totalTokens ?? input + output;
  const reasoning =
    usage?.outputTokenDetails?.reasoningTokens ?? usage?.reasoningTokens;
  return {
    input_tokens: input,
    input_tokens_details: null,
    output_tokens: output,
    output_tokens_details: typeof reasoning === 'number' ? { reasoning_tokens: reasoning } : null,
    total_tokens: total,
  };
}

function translateFinishReason(
  reason: string | undefined,
): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' | undefined {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool-calls':
      return 'tool_calls';
    case 'content-filter':
      return 'content_filter';
    case 'error':
      return 'error';
    default:
      return undefined;
  }
}
