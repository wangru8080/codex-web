/**
 * Codex approval bridge — Phase 5 Phase 4 Slice 2 (2026-05-13).
 *
 * Routes Codex's server-originated approval requests through
 * CodexWeb's existing PermissionPrompt UI instead of returning a
 * blanket decline-by-default.
 *
 * Flow:
 *
 *   Codex JSON-RPC server request `item/commandExecution/requestApproval`
 *     → CodexAppServerClient.routeServerRequest
 *     → CodexRuntime onServerRequest handler
 *     → handleCodexApprovalRequest (this module):
 *         1. translate to canonical RuntimePermissionEvent via
 *            `translateCodexApproval`
 *         2. write a permission_requests DB row so the existing
 *            `/api/chat/permission` route's validation passes
 *         3. emit an SDK-shaped `permission_request` SSE event so the
 *            existing useSSEStream + PermissionPrompt path picks it up
 *            unchanged (UI doesn't branch on runtime)
 *         4. await `registerPendingPermission` — same registry the SDK
 *            uses; user response from /api/chat/permission resolves it
 *         5. translate PermissionResult → the Codex response shape that
 *            matches THIS approval method (execCommand, fileChange,
 *            permissions, or legacy alias all have different responses)
 *
 * Response shapes per `资料/codex/.../schema/typescript/v2/`:
 *
 *   - `item/commandExecution/requestApproval` →
 *     CommandExecutionRequestApprovalResponse = { decision:
 *       'accept' | 'acceptForSession' | 'decline' | 'cancel' | ...amendments }
 *   - `item/fileChange/requestApproval` →
 *     FileChangeRequestApprovalResponse = { decision: FileChangeApprovalDecision }
 *     where FileChangeApprovalDecision = 'accept' | 'acceptForSession' |
 *       'decline' | 'cancel'
 *   - `item/permissions/requestApproval` →
 *     PermissionsRequestApprovalResponse = { permissions, scope,
 *       strictAutoReview? } — entirely different shape; MVP throws an
 *     error which Codex treats as a failed approval (effectively decline).
 *     Phase 6 wires the full UI for granting specific permission profiles.
 *   - Legacy `execCommandApproval` + `applyPatchApproval` →
 *     ApplyPatchApprovalResponse = { decision: ReviewDecision }
 *     where ReviewDecision = 'approved' | 'approved_for_session' |
 *       'denied' | 'timed_out' | 'abort' | ...amendments
 */

import type { PermissionRequestEvent, PermissionSuggestion } from '@/types';
import type { NativePermissionResult } from '@/lib/types/agent-types';
import { translateCodexApproval } from './event-mapper';
import { createPermissionRequest, getPermissionRequest } from '@/lib/db';
import { registerPendingPermission, buildPermissionResolvedEvent } from '@/lib/permission-registry';

/**
 * Generate a stable permissionRequestId from the Codex JSON-RPC id.
 * The `codex:` prefix lets log scrapers / tests recognize Codex-origin
 * approvals without having to query the registry first.
 */
export function makeCodexPermissionRequestId(jsonRpcId: number | string): string {
  return `codex:${jsonRpcId}`;
}

/**
 * Decode a stored `permission_requests` row back into the
 * `NativePermissionResult` shape so `resultToCodexResponse` can
 * translate it. Used by the duplicate-RPC short-circuit above —
 * `existing.status` is one of `allow / deny / timeout / aborted`,
 * each maps to a `behavior` here. Timeout / aborted both surface
 * as deny on the Codex side since neither produced a user "allow".
 *
 * Exported for unit testing.
 */
export function decodeStoredPermission(existing: {
  status: string;
  updated_permissions: string;
  updated_input: string | null;
  message: string;
}): NativePermissionResult {
  if (existing.status === 'allow') {
    let updatedPermissions: unknown[] = [];
    try {
      if (existing.updated_permissions) {
        const parsed = JSON.parse(existing.updated_permissions);
        if (Array.isArray(parsed)) updatedPermissions = parsed;
      }
    } catch {
      // Best-effort decode; malformed legacy rows fall back to empty.
    }
    let updatedInput: Record<string, unknown> | undefined;
    try {
      if (existing.updated_input) {
        const parsed = JSON.parse(existing.updated_input);
        if (parsed && typeof parsed === 'object') {
          updatedInput = parsed as Record<string, unknown>;
        }
      }
    } catch {
      // Same — best-effort.
    }
    return {
      behavior: 'allow',
      updatedPermissions,
      ...(updatedInput ? { updatedInput } : {}),
    };
  }
  return {
    behavior: 'deny',
    message: existing.message || `Already resolved (status: ${existing.status})`,
  };
}

interface HandleArgs {
  sessionId: string;
  jsonRpcId: number | string;
  method: string;
  params: unknown;
  /** Emit an SSE line into the chat stream. */
  emitSse: (line: string) => void;
}

/**
 * Handle one Codex approval request end-to-end. Resolves with the
 * runtime-specific response shape Codex expects, OR throws to surface
 * an error response to Codex (which it treats as failed approval).
 */
export async function handleCodexApprovalRequest(args: HandleArgs): Promise<unknown> {
  const requestId = makeCodexPermissionRequestId(args.jsonRpcId);

  // Phase 5d Phase 3 review fix #3 (P1, 2026-05-17) — idempotent handling
  // of duplicate approval RPCs for the same `codex:${jsonRpcId}`.
  //
  // Pre-fix the bridge always called `createPermissionRequest` which is
  // a plain INSERT on a UNIQUE id column. A duplicate RPC (Codex
  // transport retry, reconnect replay, concurrent handler trigger) hit
  // the UNIQUE constraint; the catch block only `console.warn`-ed,
  // then went on to emit a second SSE permission_request AND
  // registerPendingPermission again — overwriting the in-memory waiter
  // for the original prompt. User would see two prompts; clicking Deny
  // on one resolved the DB row, so the OTHER `/api/chat/permission`
  // POST hit the `dbRecord.status !== 'pending'` branch and returned
  // 409 ALREADY_RESOLVED. The original Codex turn's waiter promise
  // never resolved (timeout-only) → "chain not clean" after Deny.
  //
  // Fix: short-circuit before any side effect (DB write, SSE emit, in-
  // memory register) when the same requestId is already on record.
  const existing = getPermissionRequest(requestId);
  if (existing) {
    if (existing.status !== 'pending') {
      // Already resolved — replay the stored decision so Codex sees
      // the same response it would have gotten for the original RPC.
      const stored = decodeStoredPermission(existing);
      return resultToCodexResponse(stored, args.method);
    }
    // Still pending — the user is mid-decision on the original prompt.
    // Don't emit a duplicate UI prompt and don't overwrite the in-
    // memory waiter; tell Codex "decline" for this duplicate. The
    // user's eventual decision on the original prompt resolves the
    // original turn normally; this duplicate RPC just gets a clean
    // soft-decline instead of a hang.
    return resultToCodexResponse(
      { behavior: 'deny', message: 'Duplicate approval request — original prompt still pending' },
      args.method,
    );
  }

  const canonical = translateCodexApproval({
    method: args.method,
    params: args.params,
    sessionId: args.sessionId,
    requestId,
  });

  // Conservative fallback: unmapped approval kinds → permission_unavailable.
  // Don't emit a permission_request to UI; respond with an error so
  // Codex treats it as decline-failed rather than hanging.
  // (Type narrowing: translateCodexApproval only returns request OR
  // unavailable; this guard collapses the union to permission_request.)
  if (canonical.type !== 'permission_request') {
    throw new Error(`Codex approval kind not yet supported: ${args.method}`);
  }

  // Translate canonical → SDK-shaped PermissionRequestEvent so the
  // existing useSSEStream / PermissionPrompt pipeline picks it up
  // unchanged. UI doesn't care about runtime; the bridge does the
  // shape adaptation.
  const sdkPermission: PermissionRequestEvent = {
    permissionRequestId: requestId,
    toolName: canonical.toolName,
    toolInput: canonical.toolInput ?? {},
    toolUseId: canonical.toolUseId ?? '',
    description: canonical.subject,
    decisionReason: canonical.details,
    suggestions: canonical.permissionHints?.map((h): PermissionSuggestion => ({
      type: h.type,
      ...(h.rules ? { rules: [...h.rules] } : {}),
      ...(h.behavior !== undefined ? { behavior: h.behavior } : {}),
      ...(h.destination !== undefined ? { destination: h.destination } : {}),
    })),
  };

  // Persist to permission_requests so the existing /api/chat/permission
  // route's `getPermissionRequest(id)` validation succeeds.
  try {
    createPermissionRequest({
      id: requestId,
      sessionId: args.sessionId,
      toolName: canonical.toolName,
      toolInput: JSON.stringify(canonical.toolInput ?? {}),
      decisionReason: canonical.details,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    // Logging-only failure; the in-memory registry is the source of
    // truth for resolution. A DB write failure won't block approval.
    console.warn('[codex.approval] createPermissionRequest failed:', err);
  }

  // Emit SSE permission_request event so PermissionPrompt renders.
  args.emitSse(
    `data: ${JSON.stringify({
      type: 'permission_request',
      data: JSON.stringify(sdkPermission),
    })}\n\n`,
  );

  // Wait for the user's decision. registerPendingPermission resolves
  // via /api/chat/permission → resolvePendingPermission — the same
  // path the SDK uses, so PermissionPrompt's existing wire-up works.
  // onTimeout mirrors the SDK path: push permission_resolved(timeout) so a
  // Codex approval that times out shows the same auto-deny UI (A5 Step 2).
  const result = await registerPendingPermission(
    requestId,
    canonical.toolInput ?? {},
    undefined,
    () => {
      try {
        args.emitSse(`data: ${JSON.stringify(buildPermissionResolvedEvent(requestId))}\n\n`);
      } catch {
        // stream already closed — deny still applies
      }
    },
  );

  return resultToCodexResponse(result, args.method);
}

/**
 * Translate the SDK-shaped `NativePermissionResult` into the Codex
 * response payload that matches the approval method.
 *
 * Mapping rules:
 *
 *   allow + updatedPermissions.length > 0  → "acceptForSession" (canonical)
 *                                          / "approved_for_session" (legacy)
 *   allow                                  → "accept" (canonical)
 *                                          / "approved" (legacy)
 *   deny                                   → "decline" (canonical)
 *                                          / "denied" (legacy)
 *
 * `item/permissions/requestApproval` requires an entirely different
 * shape; for MVP we don't reach this fn for that method — the
 * handleCodexApprovalRequest path throws above. Phase 6 wires the
 * full permission-grant UI and replaces the throw with a structured
 * GrantedPermissionProfile.
 */
/**
 * Exported for unit testing the mapping table. Not part of the
 * public adapter surface — runtime call sites use
 * `handleCodexApprovalRequest`.
 */
export function resultToCodexResponse(
  result: NativePermissionResult,
  method: string,
): { decision: string } {
  const legacy = method === 'execCommandApproval' || method === 'applyPatchApproval';
  const sessionScope =
    result.behavior === 'allow' &&
    Array.isArray(result.updatedPermissions) &&
    result.updatedPermissions.length > 0;

  if (result.behavior === 'allow') {
    return {
      decision: sessionScope
        ? legacy ? 'approved_for_session' : 'acceptForSession'
        : legacy ? 'approved' : 'accept',
    };
  }
  return { decision: legacy ? 'denied' : 'decline' };
}
