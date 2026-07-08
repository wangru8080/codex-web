/**
 * agent-tools.ts — Tool assembly layer for the native Agent Loop.
 *
 * Selects which tools to pass to streamText() based on session mode,
 * keyword-gating, and MCP server availability.
 * Wraps tools with permission checking when a permissionContext is provided.
 */

import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

/** Tool names that are safe in read-only (plan) mode */
export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'] as const;

// Phase 5e Phase 5 (2026-05-17) — promote the Phase 0.5 P0 hand-
// written `PERMISSION_SAFE_TOOLS` allowlist to a derived value
// driven by per-tool `mutationLevel` classification. Same fail-safe
// semantics: unknown tools route to `ask`; only `safe_read` skips
// the wrapper. The classification table lives in
// `src/lib/harness/mutation-level.ts` so adding a new codepilot_*
// tool is a one-line declaration at the canonical location instead
// of a remember-to-update-the-allowlist hazard.
import {
  CODEXWEB_TOOL_MUTATION_LEVELS,
  CORE_SAFE_READ_TOOLS,
} from './harness/mutation-level';

/**
 * Explicit allowlist of tools the permission wrapper waves through.
 *
 * **Now derived** from `mutationLevel === 'safe_read'` declarations
 * in `harness/mutation-level.ts`. The `PERMISSION_SAFE_TOOLS` symbol
 * is preserved as the public contract so existing imports + the
 * `agent-tools-permission-allowlist.test.ts` regression suite keep
 * working unchanged. Membership rule:
 *
 *   - Core read-only tools (Read / Glob / Grep / Skill — declared in
 *     `CORE_SAFE_READ_TOOLS`)
 *   - CodexWeb built-in tools declared as `safe_read` in
 *     `CODEXWEB_TOOL_MUTATION_LEVELS`
 *
 * Source-pinned in
 * `src/__tests__/unit/agent-tools-permission-allowlist.test.ts`:
 *   - exact contents (each entry rationale documented)
 *   - regression forbid: `name.startsWith('codepilot_')` cannot
 *     re-appear in this file
 *   - forbid: any known-mutating tool (notify / schedule_task /
 *     cli_tools_install / dashboard_pin / generate_image / etc.)
 *     accidentally classified as `safe_read`
 *   - set-equality with `EXPECTED_ALLOWLIST` so silent expansion is
 *     impossible
 */
export const PERMISSION_SAFE_TOOLS: ReadonlySet<string> = (() => {
  const set = new Set<string>(CORE_SAFE_READ_TOOLS);
  for (const [name, level] of Object.entries(CODEXWEB_TOOL_MUTATION_LEVELS)) {
    if (level === 'safe_read') set.add(name);
  }
  return set;
})();
import { createBuiltinTools } from './tools';
import { buildMcpToolSet } from './mcp-tool-adapter';
import { getBuiltinTools } from './builtin-tools';
import { checkPermission, type PermissionMode } from './permission-checker';
import { registerPendingPermission, buildPermissionResolvedEvent } from './permission-registry';
import { emit as emitEvent } from './runtime/event-bus';
import { createPermissionRequest } from './db';
import crypto from 'crypto';

export interface AssembleToolsOptions {
  workingDirectory?: string;
  prompt?: string;
  mode?: string;
  /** Provider ID (passed to sub-agents for inheritance) */
  providerId?: string;
  /** Session provider ID (passed to sub-agents for inheritance) */
  sessionProviderId?: string;
  /** Model (passed to sub-agents for inheritance) */
  model?: string;
  /** Permission context — when set, tools are wrapped with permission checks */
  permissionContext?: {
    sessionId: string;
    permissionMode: PermissionMode;
    /** Callback to emit SSE events (for permission_request) */
    emitSSE: (event: { type: string; data: string }) => void;
    abortSignal?: AbortSignal;
  };
}

export interface AssembleToolsResult {
  tools: ToolSet;
  /** System prompt snippets from builtin tool groups (notification, media, etc.) */
  systemPrompts: string[];
}

/**
 * Assemble the tool set for the native Agent Loop.
 * Returns both tools and their associated system prompt snippets.
 */
export function assembleTools(options: AssembleToolsOptions = {}): AssembleToolsResult {
  const cwd = options.workingDirectory || process.cwd();

  // Built-in coding tools — pass permission context through so sub-agents
  // (Agent tool) can inherit the parent's permission mode and SSE emitter.
  const builtinTools = createBuiltinTools({
    workingDirectory: cwd,
    sessionId: options.permissionContext?.sessionId,
    providerId: options.providerId,
    sessionProviderId: options.sessionProviderId,
    model: options.model,
    permissionMode: options.permissionContext?.permissionMode,
    emitSSE: options.permissionContext?.emitSSE,
    abortSignal: options.permissionContext?.abortSignal,
  });

  // In 'plan' mode, restrict to read-only tools — but #26: keep the
  // safe_read Harness capabilities (codepilot_load_widget_guidelines,
  // memory reads, …) and their compiler prompts (widget wire-format spec),
  // not just Read/Glob/Grep. Mutating tools (Write/Edit/Bash + image gen /
  // dashboard / schedule / notify / media import) stay out. Restores Native
  // Plan mode's ability to produce Widgets without granting side effects.
  // Every resulting tool skips the permission check by construction, so no
  // permission wrapping is needed.
  if (options.mode === 'plan') {
    const { tools: safeMcpTools, systemPrompts } = getBuiltinTools({
      workspacePath: cwd,
      prompt: options.prompt,
      sessionId: options.permissionContext?.sessionId,
      safeReadOnly: true,
    });
    const safeBuiltin = Object.fromEntries(
      Object.entries(builtinTools).filter(([name]) => PERMISSION_SAFE_TOOLS.has(name)),
    );
    return { tools: { ...safeBuiltin, ...safeMcpTools }, systemPrompts };
  }

  // Built-in MCP-equivalent tools (notification, memory, dashboard, etc.)
  // Pass through sessionId so codepilot_schedule_task can inject
  // origin_session_id + working_directory into /api/tasks/schedule
  // POST body. Without this, AI tasks created by the model would be
  // unanchored and the runner couldn't tell which project session the
  // result belongs to.
  const { tools: builtinMcpTools, systemPrompts } = getBuiltinTools({
    workspacePath: cwd,
    prompt: options.prompt,
    sessionId: options.permissionContext?.sessionId,
  });

  // External MCP tools from connected servers
  const mcpTools = buildMcpToolSet();

  const allTools = { ...builtinTools, ...builtinMcpTools, ...mcpTools };

  // Wrap with permission checks if context provided
  if (options.permissionContext) {
    return { tools: wrapWithPermissions(allTools, options.permissionContext), systemPrompts };
  }

  return { tools: allTools, systemPrompts };
}

// ── Permission wrapper ──────────────────────────────────────────

// Session-level auto-approved rules (accumulated from "allow for session" responses)
const sessionApprovals = new Map<string, Array<{ toolName: string; pattern: string }>>();

function getSessionRules(sessionId: string): Array<{ permission: string; pattern: string; action: 'allow' | 'deny' | 'ask' }> {
  const approvals = sessionApprovals.get(sessionId) || [];
  return approvals.map(a => ({ permission: a.toolName, pattern: a.pattern, action: 'allow' as const }));
}

function wrapWithPermissions(
  tools: ToolSet,
  ctx: NonNullable<AssembleToolsOptions['permissionContext']>,
): ToolSet {
  const wrapped: ToolSet = {};

  for (const [name, t] of Object.entries(tools)) {
    // Skip permission checks for tools known to be safe / read-only.
    //
    // Phase 5e Phase 0.5 review fix (P0 止血, 2026-05-17) — pre-fix the
    // allowlist used `name.startsWith('codepilot_')` to wave through
    // every CodexWeb built-in tool as "trusted internal". That was
    // wrong: `codepilot_cli_tools_install / update / remove` shell out
    // to npm / brew / pip; `codepilot_notify` fires system-level toasts
    // / Electron notifications / Telegram bridges; `codepilot_dashboard_pin /
    // update / remove` mutate the user's pinned widgets; `codepilot_schedule_task`
    // writes durable DB rows that fire later cross-session. The model
    // could call any of these silently under Native Runtime with no
    // permission gate, which conflicted with the user's mental model
    // (ClaudeCode-style "shell touches require approval").
    //
    // The new allowlist is EXPLICIT and READ-ONLY. Every entry below
    // must be a tool that:
    //   - reads filesystem / DB / network state (no writes)
    //   - returns the data inline (no side effects on user surfaces)
    //   - does NOT execute shell commands or install/uninstall software
    //
    // Anything not on this list — including future codepilot_* tools —
    // falls through to the permission wrapper below. fail-safe default.
    //
    // The matching regression test in
    // `src/__tests__/unit/agent-tools-permission-allowlist.test.ts`
    // pins this exact list + forbids `name.startsWith('codepilot_')`
    // from re-appearing.
    if (PERMISSION_SAFE_TOOLS.has(name)) {
      wrapped[name] = t;
      continue;
    }

    // Wrap execute with permission check
    const original = t as { description?: string; inputSchema?: unknown; execute?: (...args: unknown[]) => unknown };
    wrapped[name] = tool({
      description: original.description || name,
      inputSchema: (original.inputSchema || z.object({})) as z.ZodType,
      execute: async (input: unknown, execOptions: unknown) => {
        emitEvent('tool:pre-use', { sessionId: ctx.sessionId, toolName: name, input });
        const result = checkPermission(name, input, ctx.permissionMode, getSessionRules(ctx.sessionId));

        if (result.action === 'deny') {
          return `Permission denied: ${result.reason || 'Tool not allowed in current mode'}`;
        }

        if (result.action === 'ask') {
          // Emit permission_request SSE and wait for user response
          const permId = crypto.randomBytes(8).toString('hex');

          // Persist to DB
          try {
            createPermissionRequest({
              id: permId,
              sessionId: ctx.sessionId,
              toolName: name,
              toolInput: JSON.stringify(input),
              expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            });
          } catch { /* non-critical */ }

          emitEvent('permission:request', { sessionId: ctx.sessionId, toolName: name, permissionId: permId });

          // Emit SSE
          ctx.emitSSE({
            type: 'permission_request',
            data: JSON.stringify({
              permissionRequestId: permId,
              toolName: name,
              toolInput: input,
              description: result.reason,
            }),
          });

          // Wait for user response. onTimeout pushes a permission_resolved
          // (timeout) event down the same SSE stream so the chat UI shows the
          // auto-deny instead of the prompt silently vanishing (A5 Step 2).
          const permResult = await registerPendingPermission(
            permId,
            (input || {}) as Record<string, unknown>,
            ctx.abortSignal,
            () => {
              try {
                ctx.emitSSE(buildPermissionResolvedEvent(permId));
              } catch {
                // stream already closed — deny still applies
              }
            },
          );

          emitEvent('permission:resolved', { sessionId: ctx.sessionId, toolName: name, behavior: permResult.behavior });

          if (permResult.behavior === 'deny') {
            return `Permission denied by user: ${permResult.message || 'Denied'}`;
          }

          // Apply user-modified input if provided (e.g. user edited the command)
          if (permResult.updatedInput) {
            input = permResult.updatedInput;
          }

          // Save session-level approval for future calls (allow_session)
          if (permResult.updatedPermissions && Array.isArray(permResult.updatedPermissions)) {
            const existing = sessionApprovals.get(ctx.sessionId) || [];
            existing.push({ toolName: name, pattern: '*' });
            sessionApprovals.set(ctx.sessionId, existing);
          }
        }

        // Execute the original tool (with possibly updated input from permission approval)
        if (original.execute) {
          const output = await original.execute(input, execOptions);
          emitEvent('tool:post-use', { sessionId: ctx.sessionId, toolName: name });
          return output;
        }
        return '(tool has no execute function)';
      },
    });
  }

  return wrapped;
}

