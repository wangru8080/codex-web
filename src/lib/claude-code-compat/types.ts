/**
 * types.ts — Anthropic Messages API types for the ClaudeCodeCompat adapter.
 *
 * These match the wire format that Claude Code sends to proxy APIs.
 * Ref: Claude Code services/api/claude.ts
 */

// ── Config ──────────────────────────────────────────────────────

export interface ClaudeCodeCompatConfig {
  apiKey?: string;
  authToken?: string;
  baseUrl: string;
  modelId: string;
  headers?: Record<string, string>;
}

// ── SSE Event Types (from Anthropic streaming API) ──────────────

export type AnthropicSSEEvent =
  | { type: 'message_start'; message: AnthropicMessageStart }
  | { type: 'content_block_start'; index: number; content_block: AnthropicContentBlock }
  | { type: 'content_block_delta'; index: number; delta: AnthropicDelta }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string; stop_sequence?: string | null }; usage: AnthropicUsage }
  | { type: 'message_stop' }
  | { type: 'ping' }
  | { type: 'error'; error: { type: string; message: string } };

export interface AnthropicMessageStart {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  usage: AnthropicUsage;
}

export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: string | Record<string, unknown> };

export type AnthropicDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'input_json_delta'; partial_json: string }
  | { type: 'signature_delta'; signature: string };

// ── Finish Reason Mapping ───────────────────────────────────────

export function mapFinishReason(stopReason: string): { unified: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'; raw: string } {
  const raw = stopReason;
  switch (stopReason) {
    case 'end_turn': return { unified: 'stop', raw };
    case 'tool_use': return { unified: 'tool-calls', raw };
    case 'max_tokens': return { unified: 'length', raw };
    case 'stop_sequence': return { unified: 'stop', raw };
    default: return { unified: 'other', raw };
  }
}
