/**
 * mcp-tool-adapter.ts — Convert MCP tools to Vercel AI SDK tools.
 *
 * Takes MCP tool definitions (JSON Schema) from the connection manager
 * and wraps them as Vercel AI SDK dynamicTool() instances for streamText().
 */

import { dynamicTool, jsonSchema, type ToolSet } from 'ai';
import { getAllMcpTools, callMcpTool, type McpToolDefinition } from './mcp-connection-manager';

/**
 * Convert all currently available MCP tools into a ToolSet for streamText().
 *
 * Tool names are fully qualified: `mcp__{serverName}__{toolName}`
 * This prevents collisions between tools from different servers.
 */
export function buildMcpToolSet(): ToolSet {
  const mcpTools = getAllMcpTools();
  const toolSet: ToolSet = {};

  for (const mcpTool of mcpTools) {
    toolSet[mcpTool.qualifiedName] = convertMcpTool(mcpTool);
  }

  return toolSet;
}

/**
 * Convert a single MCP tool definition into a Vercel AI SDK dynamicTool.
 */
function convertMcpTool(mcpTool: McpToolDefinition) {
  // Ensure the schema has required fields for AI SDK
  const schema = {
    ...mcpTool.inputSchema,
    type: 'object' as const,
    properties: (mcpTool.inputSchema.properties as Record<string, unknown>) ?? {},
    additionalProperties: false,
  };

  return dynamicTool({
    description: mcpTool.description || `MCP tool: ${mcpTool.originalName}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inputSchema: jsonSchema(schema as any),
    execute: async (args: unknown) => {
      const result = await callMcpTool(
        mcpTool.serverName,
        mcpTool.originalName,
        args as Record<string, unknown>,
      );

      // MCP callTool returns { content: [...], isError?: boolean }
      if (result && typeof result === 'object' && 'content' in result) {
        const mcpResult = result as { content: Array<{ type: string; text?: string }>; isError?: boolean };
        const text = mcpResult.content
          ?.filter(c => c.type === 'text')
          .map(c => c.text)
          .join('\n');

        if (mcpResult.isError) {
          return `Error: ${text || 'MCP tool returned an error'}`;
        }

        return text || JSON.stringify(result);
      }

      return typeof result === 'string' ? result : JSON.stringify(result);
    },
  });
}
