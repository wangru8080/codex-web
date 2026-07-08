/**
 * builtin-tools/memory-search.ts — Workspace memory search tools (Native Runtime).
 *
 * Phase 5d Phase 2 slice 2d (2026-05-17) — system prompt is now
 * re-exported from the canonical MCP-side source. Pre-fix this file
 * carried a 5-line abridged paraphrase that drifted from
 * `memory-search-mcp.ts MEMORY_SEARCH_SYSTEM_PROMPT` (the 15-line
 * authority with the "first-turn must call memory_recent" rule).
 * The Expected Differences Ledger entry for this drift is removed
 * as part of this commit.
 */

import { tool } from 'ai';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { MEMORY_SEARCH_SYSTEM_PROMPT as CANONICAL_MEMORY_SEARCH_SYSTEM_PROMPT } from '@/lib/memory-search-mcp';

export const MEMORY_SEARCH_SYSTEM_PROMPT = CANONICAL_MEMORY_SEARCH_SYSTEM_PROMPT;

export function createMemorySearchTools(workspacePath: string) {
  return {
    codepilot_memory_search: tool({
      description: 'Search assistant workspace memory files with keyword matching. Supports filtering by tags (Obsidian-style #tags from YAML frontmatter) and file type.',
      inputSchema: z.object({
        query: z.string().describe('Search query'),
        tags: z.array(z.string()).optional().describe('Filter by YAML frontmatter tags (e.g. ["project", "design"])'),
        file_type: z.enum(['all', 'daily', 'longterm', 'notes']).optional()
          .describe('Filter by type: "daily" = memory/daily/*.md, "longterm" = memory.md, "notes" = other workspace files'),
        limit: z.number().optional(),
      }),
      // Phase 5e Phase 0.5 P1 parity (2026-05-17) — pre-fix this
      // Native handler accepted `tags` / `file_type` parameters but
      // passed them straight through to `searchWorkspace` without
      // any filtering. The MCP-side handler (`memory-search-mcp.ts`)
      // applies both filters server-side. Native is the product
      // baseline → must match. Mirror the MCP filter pipeline:
      // type-filter → tag-filter → temporal decay handled inside
      // searchWorkspace.
      execute: async ({ query, tags, file_type, limit }) => {
        try {
          const { searchWorkspace } = await import('@/lib/workspace-retrieval');
          // Over-fetch x3 so the filter steps have room to keep
          // `limit` matches after type / tag filtering.
          let results = await searchWorkspace(workspacePath, query, {
            limit: (limit || 5) * 3,
          });

          // File-type filter — same logic as memory-search-mcp.ts:64-71
          if (file_type && file_type !== 'all') {
            const isMemoryFile = (p: string) => /^memory\.md$/i.test(p);
            results = results.filter((r: { path: string }) => {
              if (file_type === 'daily') return r.path.startsWith('memory/daily/');
              if (file_type === 'longterm') return isMemoryFile(r.path);
              if (file_type === 'notes') return !r.path.startsWith('memory/') && !isMemoryFile(r.path);
              return true;
            });
          }

          // Tag filter — manifest lookup. memory-search-mcp.ts:74-87
          if (tags && tags.length > 0) {
            const tagsLower = tags.map((t) => t.toLowerCase().replace(/^#/, ''));
            try {
              const { loadManifest } = await import('@/lib/workspace-indexer');
              const manifest = loadManifest(workspacePath);
              results = results.filter((r: { path: string }) => {
                const entry = manifest.find(
                  (e: { path: string; tags?: string[] }) => e.path === r.path,
                );
                if (!entry?.tags?.length) return false;
                const entryTagsLower = entry.tags.map((t: string) => t.toLowerCase());
                return tagsLower.some((t) => entryTagsLower.includes(t));
              });
            } catch {
              // manifest unavailable — skip tag filtering rather than
              // hide results the user might want
            }
          }

          // Final slice to caller-requested limit.
          const trimmed = results.slice(0, limit || 5);

          if (!trimmed || trimmed.length === 0) return 'No matching memories found.';
          return trimmed
            .map(
              (r: { path: string; snippet: string; score: number }) =>
                `**${r.path}** (score: ${r.score.toFixed(2)})\n${r.snippet}`,
            )
            .join('\n\n');
        } catch (err) { return `Search failed: ${err instanceof Error ? err.message : 'unknown'}`; }
      },
    }),

    codepilot_memory_get: tool({
      description: 'Read a specific file from the assistant workspace.',
      inputSchema: z.object({
        file_path: z.string().describe('Path relative to workspace'),
        line_start: z.number().optional(),
        line_end: z.number().optional(),
      }),
      execute: async ({ file_path, line_start, line_end }) => {
        try {
          const fullPath = path.resolve(workspacePath, file_path);
          // Security: ensure path is within workspace
          if (!fullPath.startsWith(path.resolve(workspacePath))) {
            return 'Error: Path is outside workspace.';
          }
          if (!fs.existsSync(fullPath)) return `File not found: ${file_path}`;
          let content = fs.readFileSync(fullPath, 'utf-8');
          if (line_start !== undefined || line_end !== undefined) {
            const lines = content.split('\n');
            content = lines.slice(line_start || 0, line_end).join('\n');
          }
          return content;
        } catch (err) { return `Failed: ${err instanceof Error ? err.message : 'unknown'}`; }
      },
    }),

    codepilot_memory_recent: tool({
      description: 'Get recent daily memories (last 3 days) and long-term memory summary. Call at the START of each conversation to review recent context.',
      inputSchema: z.object({}),
      // Phase 5e Phase 0.5 P1 parity (2026-05-17) — pre-fix this
      // Native handler read `<workspace>/daily/` + `<workspace>/longterm/summary.md`.
      // The MCP authority (`memory-search-mcp.ts:182-` recent tool)
      // uses `<workspace>/memory.md` (with `Memory.md` / `MEMORY.md`
      // case fallback) + `<workspace>/memory/daily/<YYYY-MM-DD>.md`.
      // Native is the product baseline → must match the authoritative
      // layout. Falls back to legacy `daily/` + `longterm/summary.md`
      // for users whose workspace still has the older shape.
      execute: async () => {
        try {
          const parts: string[] = [];

          // Long-term memory summary — case-variant fallback like MCP
          const memoryVariants = ['memory.md', 'Memory.md', 'MEMORY.md'];
          for (const variant of memoryVariants) {
            const memPath = path.join(workspacePath, variant);
            if (fs.existsSync(memPath)) {
              const memContent = fs.readFileSync(memPath, 'utf-8').trim();
              if (memContent) {
                const summary =
                  memContent.length > 500
                    ? memContent.slice(0, 500) + '...'
                    : memContent;
                parts.push(`## Long-term Memory\n${summary}`);
              }
              break;
            }
          }

          // Recent daily memories — primary layout `memory/daily/`
          const dailyDir = path.join(workspacePath, 'memory', 'daily');
          let dailyEntries: string[] = [];
          if (fs.existsSync(dailyDir)) {
            dailyEntries = fs
              .readdirSync(dailyDir)
              .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
              .sort()
              .slice(-3);
            for (const entry of dailyEntries) {
              const content = fs.readFileSync(path.join(dailyDir, entry), 'utf-8');
              parts.push(`### ${entry}\n${content.slice(0, 500)}`);
            }
          } else {
            // Legacy fallback: pre-Phase-5e workspaces used `daily/`
            // at the workspace root and `longterm/summary.md`. Keep
            // reading those so existing users don't get a sudden
            // "No memories" regression.
            const legacyDailyDir = path.join(workspacePath, 'daily');
            if (fs.existsSync(legacyDailyDir)) {
              const legacy = fs
                .readdirSync(legacyDailyDir)
                .filter((f) => f.endsWith('.md'))
                .sort()
                .slice(-3);
              for (const entry of legacy) {
                const content = fs.readFileSync(path.join(legacyDailyDir, entry), 'utf-8');
                parts.push(`### ${entry}\n${content.slice(0, 500)}`);
              }
            }
            const legacyLt = path.join(workspacePath, 'longterm', 'summary.md');
            if (parts.length === 0 && fs.existsSync(legacyLt)) {
              const ltContent = fs.readFileSync(legacyLt, 'utf-8');
              parts.push(`### Long-term Memory (legacy)\n${ltContent.slice(0, 500)}`);
            }
          }

          return parts.join('\n\n') || 'No recent memories.';
        } catch (err) { return `Failed: ${err instanceof Error ? err.message : 'unknown'}`; }
      },
    }),
  };
}
