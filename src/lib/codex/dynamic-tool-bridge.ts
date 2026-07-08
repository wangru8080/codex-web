/**
 * Codex dynamic tool-call bridge — Phase 8 Phase 5 (2026-05-27).
 *
 * When the model AUTONOMOUSLY calls a tool mid-turn, Codex's app-server
 * sends the CLIENT a server-originated `item/tool/call` request (a
 * "dynamic tool call", params `DynamicToolCallParams`) — NOT the
 * client→server `mcpServer/tool/call` our Phase 0 POC drove. Without a
 * handler, `CodexAppServerClient.routeServerRequest` answers
 * `-32601 method-not-found` and Codex marks the call rejected. That is
 * exactly why the Phase 5 login smoke saw the model call
 * `codepilot_memory.codepilot_memory_recent {}` and then get "rejected":
 * the MCP injection + the model's decision to call were already working;
 * only this client-side execution bridge was missing.
 *
 * This bridge forwards an ALLOWED memory dynamic tool call back to Codex's
 * own MCP manager via `mcpServer/tool/call` (so we do NOT bypass Codex's
 * MCP server lifecycle), then converts the MCP result into the
 * `DynamicToolCallResponse` shape Codex expects.
 *
 * Scope (this slice): only the read-only Memory MCP (`codepilot_memory`
 * recent/search/get) auto-forwards — memory tools are `safe_read`. User
 * MCP / mutating tools must later route through mutationLevel / permission
 * policy before being allowed here; until then they fall through to a
 * graceful `success: false` (never an unhandled rejection).
 *
 * Shapes mirror the live app-server schema (codex 0.133 v2):
 *   DynamicToolCallParams / DynamicToolCallResponse /
 *   DynamicToolCallOutputContentItem.
 */

export interface CodexDynamicToolCallParams {
  threadId: string;
  turnId: string;
  callId: string;
  /** MCP server name the tool belongs to. `null` for non-namespaced. */
  namespace: string | null;
  tool: string;
  arguments?: unknown;
}

export type DynamicToolCallOutputContentItem =
  | { type: 'inputText'; text: string }
  | { type: 'inputImage'; imageUrl: string };

export interface CodexDynamicToolCallResponse {
  contentItems: DynamicToolCallOutputContentItem[];
  success: boolean;
}

/** Minimal shape of an `mcpServer/tool/call` result. */
export interface McpToolCallResultLike {
  content?: ReadonlyArray<unknown>;
  structuredContent?: unknown;
  isError?: boolean;
}

/** Tools allowed to auto-forward from a model-autonomous dynamic call.
 *  Memory only (all three are safe_read). Keep this the single source of
 *  truth for "what the model may invoke dynamically on Codex". */
export const ALLOWED_DYNAMIC_TOOLS: Readonly<Record<string, ReadonlySet<string>>> = {
  codepilot_memory: new Set([
    'codepilot_memory_recent',
    'codepilot_memory_search',
    'codepilot_memory_get',
  ]),
};

function inputText(text: string): DynamicToolCallOutputContentItem {
  return { type: 'inputText', text };
}

/** Extract a plain-text rendering from an MCP tool result: prefer the
 *  `text` content items; fall back to structuredContent or the raw
 *  content as JSON so nothing is silently dropped. */
function resultToText(result: McpToolCallResultLike): string {
  const content = result?.content;
  if (Array.isArray(content)) {
    const texts = content
      .filter(
        (c): c is { type: 'text'; text: string } =>
          !!c &&
          typeof c === 'object' &&
          (c as { type?: unknown }).type === 'text' &&
          typeof (c as { text?: unknown }).text === 'string',
      )
      .map((c) => c.text);
    if (texts.length > 0) return texts.join('\n');
  }
  if (result?.structuredContent != null) return JSON.stringify(result.structuredContent);
  return JSON.stringify(content ?? null);
}

function isAllowed(namespace: string, tool: string): boolean {
  return ALLOWED_DYNAMIC_TOOLS[namespace]?.has(tool) ?? false;
}

/**
 * Handle a Codex `item/tool/call` (dynamic tool call) by forwarding an
 * allowed memory tool to Codex's MCP manager and shaping the response.
 * `forward` is `client.request('mcpServer/tool/call', ...)` in production;
 * tests inject a fake. NEVER throws — an unsupported tool or a forward
 * failure becomes a graceful `success: false` response (throwing would
 * surface as `-32603` and Codex would treat the call as a hard error).
 */
export async function handleCodexDynamicToolCall(
  params: CodexDynamicToolCallParams,
  forward: (req: {
    threadId: string;
    server: string;
    tool: string;
    arguments?: unknown;
  }) => Promise<McpToolCallResultLike>,
): Promise<CodexDynamicToolCallResponse> {
  const namespace = params.namespace ?? '';
  if (!isAllowed(namespace, params.tool)) {
    return {
      success: false,
      contentItems: [
        inputText(
          `Dynamic tool "${namespace || '(none)'}.${params.tool}" is not available for autonomous calls on the Codex Runtime. Only the read-only Memory MCP is wired in this version.`,
        ),
      ],
    };
  }
  try {
    const result = await forward({
      threadId: params.threadId,
      server: namespace,
      tool: params.tool,
      arguments: params.arguments,
    });
    return {
      success: result?.isError !== true,
      contentItems: [inputText(resultToText(result))],
    };
  } catch (err) {
    return {
      success: false,
      contentItems: [
        inputText(`Memory tool call failed: ${err instanceof Error ? err.message : String(err)}`),
      ],
    };
  }
}
