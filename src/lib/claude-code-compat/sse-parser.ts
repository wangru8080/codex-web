/**
 * sse-parser.ts — Parse Anthropic SSE stream into typed events.
 *
 * Handles standard SSE format: events separated by \n\n,
 * each with optional `event:` and `data:` fields.
 */

import type { AnthropicSSEEvent } from './types';

/**
 * Parse a ReadableStream of bytes into an async iterable of Anthropic SSE events.
 */
export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AnthropicSSEEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on double newline (SSE event boundary).
      // Handle both \n\n and \r\n\r\n (common from CDNs/proxies).
      const parts = buffer.split(/\r?\n\r?\n/);
      // Keep the last part as buffer (may be incomplete)
      buffer = parts.pop() || '';

      for (const part of parts) {
        if (!part.trim()) continue;
        const event = parseSSEEvent(part);
        if (event) yield event;
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim()) {
      const event = parseSSEEvent(buffer);
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parse a single SSE event block into an AnthropicSSEEvent.
 */
function parseSSEEvent(block: string): AnthropicSSEEvent | null {
  const lines = block.split(/\r?\n/);
  let eventType = '';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      // Multi-line data: concatenate all data: lines (standard SSE spec)
      dataLines.push(line.slice(5).trim());
    } else if (line.startsWith(':')) {
      // Comment line — ignore (used for keep-alive)
      continue;
    }
  }

  const data = dataLines.join('\n');
  if (!data) return null;

  try {
    const parsed = JSON.parse(data);
    // If the event has a `type` field already (Anthropic format), use it directly
    if (parsed.type) return parsed as AnthropicSSEEvent;
    // Otherwise use the `event:` field as type
    if (eventType) return { ...parsed, type: eventType } as AnthropicSSEEvent;
    return null;
  } catch {
    // Non-JSON data — ignore (e.g. "[DONE]")
    return null;
  }
}
