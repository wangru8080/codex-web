/**
 * builtin-mcp-bridge.ts — Bridge between SDK MCP tool format and AI SDK tool format.
 *
 * The 7 built-in MCP servers (notification, memory, dashboard, cli-tools, media,
 * image-gen, widget) are defined using SDK's createSdkMcpServer + tool() format.
 * This bridge extracts their tool handlers and re-wraps them as Vercel AI SDK tools,
 * making them available in the Native Runtime without SDK dependency at runtime.
 *
 * This avoids rewriting 22 tool handlers across 7 files.
 * The SDK files remain the source of truth for handler logic.
 */

import { tool as aiTool, type ToolSet } from 'ai';
import { z } from 'zod';

/**
 * Adapter: convert a SDK-style MCP tool into a Vercel AI SDK tool.
 *
 * SDK tool format: tool(name, description, zodSchema, handler)
 *   where handler returns { content: [{ type: 'text', text: string }] }
 *
 * AI SDK tool format: tool({ description, inputSchema, execute })
 *   where execute returns a string
 */
export function bridgeMcpTool(
  name: string,
  description: string,
  schema: z.ZodType,
  handler: (input: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }>,
) {
  return aiTool({
    description,
    inputSchema: schema,
    execute: async (input: unknown) => {
      try {
        const result = await handler(input);
        // Extract text from MCP-style response
        const text = result.content
          ?.filter((c: { type: string }) => c.type === 'text')
          .map((c: { text?: string }) => c.text || '')
          .join('\n');
        return text || '(no output)';
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

/**
 * Registration metadata for a built-in MCP server.
 */
export interface BuiltinMcpRegistration {
  /** Server name */
  name: string;
  /** System prompt to inject when this server's tools are active */
  systemPrompt?: string;
  /** Condition for when to include these tools */
  condition: 'always' | 'workspace' | { keywords: RegExp };
  /** The tools as AI SDK ToolSet */
  tools: ToolSet;
}

/**
 * Collect all built-in MCP tools for the Native Runtime.
 * Lazy-loads each server module to avoid import errors when SDK isn't installed.
 *
 * Each server's tools are wrapped via bridgeMcpTool to convert from SDK format.
 * The actual handler functions remain in the original MCP server files.
 */
export function getBuiltinMcpTools(options: {
  workspacePath?: string;
  prompt?: string;
}): { tools: ToolSet; systemPrompts: string[] } {
  const tools: ToolSet = {};
  const systemPrompts: string[] = [];

  // For now, return empty — individual servers will be bridged incrementally.
  // Each server needs its own bridge file that imports handlers without SDK dependency.
  // This is the registration point where they'll be added.

  return { tools, systemPrompts };
}
