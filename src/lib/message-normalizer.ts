/**
 * Message Normalizer — shared message content cleaning for fallback and compression.
 *
 * Two layers of processing:
 * 1. normalizeMessageContent — strips metadata, summarizes tool blocks (always applied)
 * 2. microCompactMessage — age-based token truncation for old messages (fallback path only)
 *
 * Used by buildFallbackContext (claude-client.ts) and compressConversation (context-compressor.ts).
 */

// ── Microcompaction constants ───────────────────────────────────────

/** Max chars for tool-related content in recent messages */
const RECENT_CONTENT_LIMIT = 5000;
/** Max chars for tool-related content in old messages (>30 turns ago) */
const OLD_CONTENT_LIMIT = 1000;
/** Messages older than this many turns from the end get aggressive truncation */
const OLD_MESSAGE_THRESHOLD = 30;

/**
 * Normalize a single message for context injection or compression.
 * - Strips internal file attachment metadata (<!--files:...-->)
 * - Extracts text + tool summaries from assistant JSON messages
 */
export function normalizeMessageContent(role: string, raw: string): string {
  // Strip internal file attachment metadata
  let content = raw.replace(/<!--files:[\s\S]*?-->/g, '');

  // For assistant messages with structured content (JSON arrays),
  // extract text + brief tool summaries instead of dropping tools entirely.
  //
  // IMPORTANT: markers for thinking/tool_use use XML-style self-closing tags
  // rather than prose like "(used Read: {...})". Prose-style markers caused
  // few-shot mimicry: after a compaction-driven fallback, the model would
  // start writing pseudo tool calls as plain text ("(used Edit: {...})")
  // instead of emitting real tool_use blocks. XML tags read as structured
  // metadata that Claude is trained not to reproduce in its own output.
  if (role === 'assistant' && content.startsWith('[')) {
    try {
      const blocks = JSON.parse(content);
      const parts: string[] = [];
      for (const b of blocks) {
        if (b.type === 'thinking' && b.thinking) {
          const thinkingText = String(b.thinking);
          const boldMatch = thinkingText.match(/\*\*(.+?)\*\*/);
          const headingMatch = thinkingText.match(/^#{1,4}\s+(.+)$/m);
          const summary = boldMatch?.[1] || headingMatch?.[1] || thinkingText.slice(0, 80);
          parts.push(`<prior-reasoning>${escapeXmlAttr(summary)}</prior-reasoning>`);
        } else if (b.type === 'text' && b.text) {
          parts.push(b.text);
        } else if (b.type === 'tool_use') {
          const name = b.name || 'unknown_tool';
          const inputStr = typeof b.input === 'object' ? JSON.stringify(b.input) : String(b.input || '');
          const truncated = inputStr.length > 80 ? inputStr.slice(0, 80) + '...' : inputStr;
          parts.push(`<prior-tool-call name="${escapeXmlAttr(name)}" input="${escapeXmlAttr(truncated)}"/>`);
        }
        // tool_result blocks are skipped — the summary above captures intent
      }
      content = parts.length > 0 ? parts.join('\n') : '<prior-assistant-turn tools-only="true"/>';
    } catch {
      // Not JSON, use as-is
    }
  }
  return content;
}

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, ' ');
}

// ── Microcompaction ─────────────────────────────────────────────────

/**
 * Truncate a string using head+tail strategy, preserving context at both ends.
 */
function headTailTruncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const headSize = Math.floor(limit * 0.7);
  const tailSize = limit - headSize - 20; // 20 chars for the marker
  return text.slice(0, headSize) + '\n[...truncated...]\n' + text.slice(-tailSize);
}

/**
 * Apply age-based token truncation to a message.
 *
 * This is the second layer of processing after normalizeMessageContent.
 * Recent messages get a generous limit; older messages are more aggressively
 * truncated since they're less likely to be directly relevant.
 *
 * @param role - Message role ('user' or 'assistant')
 * @param content - Already-normalized content from normalizeMessageContent
 * @param ageFromEnd - How many messages from the end (0 = most recent)
 */
export function microCompactMessage(role: string, content: string, ageFromEnd: number): string {
  const limit = ageFromEnd > OLD_MESSAGE_THRESHOLD ? OLD_CONTENT_LIMIT : RECENT_CONTENT_LIMIT;

  // Short content — no truncation needed
  if (content.length <= limit) return content;

  return headTailTruncate(content, limit);
}
