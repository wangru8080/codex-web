/**
 * builtin-tools/session-search.ts — Historical session search tool.
 *
 * Exposes a `codepilot_session_search` tool to the model so it can search
 * across past conversations. The underlying SQLite `messages` table stores
 * the complete history; this tool makes it queryable by the agent without
 * requiring the user to manually copy / paste from old chats.
 *
 * Design: mirrors the structure of memory-search.ts — AI SDK `tool()`
 * definition with a Zod schema, delegating the heavy lifting to a
 * dynamically-imported db function (`searchMessages`). The implementation
 * uses LIKE queries (no FTS5) to keep the schema requirements minimal;
 * upgrade to FTS5 can be a follow-up if perf becomes an issue.
 *
 * Reference: docs/research/hermes-agent-analysis.md §3.4
 */

import { tool } from 'ai';
import { z } from 'zod';

export const SESSION_SEARCH_SYSTEM_PROMPT = `## 历史会话搜索

如果用户提到之前讨论过某件事，或你需要检索过往对话中的上下文：

- codepilot_session_search: 在所有历史会话的消息中按关键词搜索，返回匹配的会话标题 + 时间 + 片段`;

export function createSessionSearchTools() {
  return {
    codepilot_session_search: tool({
      description:
        'Search past conversation messages across all sessions using keyword matching. ' +
        'Returns matching messages with session title, role, timestamp, and a snippet. ' +
        'Use this when the user references past discussions or when context from a previous session is needed.',
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe('Keyword or phrase to search for in message content'),
        sessionId: z
          .string()
          .optional()
          .describe('Optional: restrict the search to a specific session ID'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Max results to return (default 5, max 50)'),
      }),
      execute: async ({ query, sessionId, limit }) => {
        try {
          // Dynamic import to keep builtin-tools registration lightweight
          // and avoid pulling db on every tool assembly.
          const { searchMessages } = await import('@/lib/db');
          const results = searchMessages(query, { sessionId, limit });

          if (!results || results.length === 0) {
            return 'No matching messages found.';
          }

          return results
            .map((r, i) => {
              const roleLabel = r.role === 'user' ? '👤 User' : '🤖 Assistant';
              return [
                `**${i + 1}. ${r.sessionTitle}** — ${roleLabel}`,
                `Session: \`${r.sessionId}\` · ${r.createdAt}`,
                r.snippet.trim(),
              ].join('\n');
            })
            .join('\n\n---\n\n');
        } catch (err) {
          return `Search failed: ${err instanceof Error ? err.message : 'unknown error'}`;
        }
      },
    }),
  };
}
