/**
 * Codex MCP elicitation policy + approval — Phase 8 (Phase 5 root-cause + #31).
 *
 * Under `approvalPolicy: on-request`, Codex sends an MCP tool-call APPROVAL
 * to the client as a `mcpServer/elicitation/request` (server→client). How we
 * answer depends on the built-in server's policy (declared in
 * `builtin-mcp-servers.ts`):
 *
 *   - `auto_accept` (safe-read: memory, widget) → accept immediately.
 *   - `user_approval` (mutating / side-effecting: tasks) → route to the
 *     user's approval flow (reuse `registerPendingPermission` +
 *     `permission_request` SSE, the same path Codex's native approval-bridge
 *     uses); accept ONLY if the user approves. Never auto-run.
 *   - `decline` (unknown server) → safe decline.
 *
 * `codexElicitationPolicy` is a pure classifier (unit-tested) — the
 * regression we must prevent is "someone flips it to blanket accept/decline".
 */

import type { PermissionRequestEvent } from '@/types';
import { createPermissionRequest, getPermissionRequest } from '@/lib/db';
import { registerPendingPermission, buildPermissionResolvedEvent } from '@/lib/permission-registry';
import { getBuiltinMcpServer, type ElicitationPolicy } from './builtin-mcp-servers';

/** Shape of `McpServerElicitationRequestResponse` (codex 0.133 v2). */
export interface CodexElicitationResponse {
  action: 'accept' | 'decline';
  content: Record<string, never> | null;
  _meta: null;
}

export type CodexElicitationDecision = ElicitationPolicy | 'decline';

export const ACCEPT_ELICITATION: CodexElicitationResponse = { action: 'accept', content: {}, _meta: null };
export const DECLINE_ELICITATION: CodexElicitationResponse = { action: 'decline', content: null, _meta: null };

/**
 * Classify how to answer an elicitation by its originating MCP server name.
 * Known built-ins use their declared `elicitationPolicy`; anything else
 * declines (the safe default — never blanket-accept an unknown server).
 */
export function codexElicitationPolicy(serverName: string | null | undefined): CodexElicitationDecision {
  if (!serverName) return 'decline';
  const entry = getBuiltinMcpServer(serverName);
  return entry ? entry.elicitationPolicy : 'decline';
}

/**
 * Route a mutating built-in's tool-call approval to the USER, reusing the
 * exact `permission_request` SSE + `registerPendingPermission` path the
 * native Codex approval-bridge uses (so the existing PermissionPrompt UI
 * renders it). Accept iff the user approves. Never throws — a failure or a
 * duplicate RPC resolves to a safe decline rather than auto-running.
 */
export async function handleCodexMcpElicitationApproval(args: {
  sessionId: string;
  jsonRpcId: number | string;
  serverName: string;
  message?: string;
  /**
   * Codex elicitation `mode` + `requestedSchema`. Kept in the audit
   * toolInput so a too-generic `message` still yields a judgeable prompt
   * (the user sees what shape of input / which mode is being requested).
   */
  mode?: string;
  requestedSchema?: unknown;
  emitSse: (line: string) => void;
}): Promise<CodexElicitationResponse> {
  // Scope the id by sessionId. A JSON-RPC id is only unique within ONE
  // Codex connection, so the same numeric id recurs across sessions /
  // reconnects; an unscoped id could collide with a stale DB row and get
  // soft-declined as a bogus "duplicate". (Codex review — non-blocking.)
  const requestId = `codex-mcp-elicit:${args.sessionId}:${args.jsonRpcId}`;

  // Idempotency: a duplicate elicitation RPC must NOT double-prompt or
  // re-INSERT (UNIQUE id). Soft-decline the duplicate; the original prompt
  // drives the real decision for the original RPC.
  if (getPermissionRequest(requestId)) {
    return DECLINE_ELICITATION;
  }

  const toolName = `${args.serverName} (MCP tool)`;
  const description = args.message?.trim()
    ? args.message
    : `The ${args.serverName} MCP server wants to run a tool.`;
  const toolInput: Record<string, unknown> = {
    server: args.serverName,
    message: args.message ?? null,
  };
  // Enrich the audit trail / prompt for side-effect tools: carry the
  // elicitation mode + requested schema so the approval is judgeable even
  // when `message` is vague. (Codex review — non-blocking.)
  if (args.mode != null) toolInput.mode = args.mode;
  if (args.requestedSchema != null) toolInput.requestedSchema = args.requestedSchema;
  const sdkPermission: PermissionRequestEvent = {
    permissionRequestId: requestId,
    toolName,
    toolInput,
    toolUseId: '',
    description,
  };

  try {
    createPermissionRequest({
      id: requestId,
      sessionId: args.sessionId,
      toolName,
      toolInput: JSON.stringify(toolInput),
      decisionReason: description,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    console.warn('[codex.mcp-elicitation] createPermissionRequest failed:', err);
  }

  args.emitSse(
    `data: ${JSON.stringify({ type: 'permission_request', data: JSON.stringify(sdkPermission) })}\n\n`,
  );

  // Resolves via /api/chat/permission → resolvePendingPermission (same as SDK).
  // onTimeout pushes permission_resolved(timeout) so an MCP elicitation that
  // times out shows the same auto-deny UI as every other path (A5 Step 2).
  const result = await registerPendingPermission(
    requestId,
    toolInput,
    undefined,
    () => {
      try {
        args.emitSse(`data: ${JSON.stringify(buildPermissionResolvedEvent(requestId))}\n\n`);
      } catch {
        // stream already closed — deny still applies
      }
    },
  );
  return result.behavior === 'allow' ? ACCEPT_ELICITATION : DECLINE_ELICITATION;
}
