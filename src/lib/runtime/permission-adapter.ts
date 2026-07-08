/**
 * Permission adapter — Phase 0.5 Slice D (2026-05-13).
 *
 * Each runtime adapter translates its native approval / sandbox /
 * confirm events into the canonical 4-event `RuntimePermissionEvent`
 * union (request / granted / denied / unavailable). PermissionPrompt
 * and the stream manager consume only the canonical union — they
 * don't branch on runtime-private shapes.
 *
 * Translators today:
 *   - `translateClaudeCodePermissionRequest` — Claude Code SDK's
 *     `PermissionRequestEvent` → `permission_request`. Preserves the
 *     SDK's permissionRequestId verbatim so the SDK-side resume path
 *     can echo it back.
 *   - `emitPermissionGranted` / `emitPermissionDenied` /
 *     `emitPermissionUnavailable` — adapter helpers that produce the
 *     terminal events with the right runtimeId + requestId.
 *
 * Translators tomorrow:
 *   - When Codex Runtime lands, add `translateCodexApproval` here
 *     mapping `approval/required` / `approval/granted` / sandbox
 *     events onto the same canonical union. UI doesn't change.
 *
 * Conservative default contract: when the adapter cannot determine
 * the semantics of a native approval event (e.g. the upstream
 * runtime adds a new approval kind we haven't mapped yet), the
 * adapter MUST emit `permission_unavailable` with a `reason` —
 * NEVER silently `permission_granted`. The 4th event type exists
 * specifically to make "we don't know" an explicit, visible state.
 */

import type { PermissionRequestEvent } from '@/types';
import type { RuntimePermissionEvent } from './contract';
import type { RuntimeId } from './runtime-id';

type RequestEvent = Extract<RuntimePermissionEvent, { type: 'permission_request' }>;
type GrantedEvent = Extract<RuntimePermissionEvent, { type: 'permission_granted' }>;
type DeniedEvent = Extract<RuntimePermissionEvent, { type: 'permission_denied' }>;
type UnavailableEvent = Extract<RuntimePermissionEvent, { type: 'permission_unavailable' }>;

/**
 * Translate Claude Code SDK's native `PermissionRequestEvent` into
 * the canonical `permission_request` event.
 *
 * Phase 0.5 Slice E.1 fix (2026-05-13) — earlier revision dropped
 * `toolName` / `toolInput` / `suggestions` / `toolUseId` into a
 * collapsed subject/details pair, which broke PermissionPrompt's
 * ExitPlanMode / AskUserQuestion / "Allow for session" affordances
 * downstream (Codex P1 finding). The canonical event now keeps
 * these as first-class fields so UI consumers can switch on
 * `toolName`, render `toolInput`, and surface `permissionHints` —
 * future Codex adapter populates the same fields from its native
 * shape.
 *
 * `nativeRequestRef` carries the raw SDK event so the SDK-side
 * resume path can echo it back. UI MUST NOT inspect `nativeRequestRef.raw`.
 */
export function translateClaudeCodePermissionRequest(
  sdkEvent: PermissionRequestEvent,
  sessionId: string,
): RequestEvent {
  const subjectParts = [sdkEvent.toolName];
  if (sdkEvent.blockedPath) subjectParts.push(sdkEvent.blockedPath);

  const detailLines: string[] = [];
  if (sdkEvent.description) detailLines.push(sdkEvent.description);
  if (sdkEvent.decisionReason) detailLines.push(sdkEvent.decisionReason);

  // SDK `PermissionSuggestion[]` maps 1:1 to canonical `PermissionHint[]`
  // — fields are structurally identical today. Codex adapter will
  // normalize its proposal shape into the same hint structure.
  const permissionHints = sdkEvent.suggestions?.map((s) => ({
    type: s.type,
    rules: s.rules,
    behavior: s.behavior,
    destination: s.destination,
  }));

  return {
    type: 'permission_request',
    runtimeId: 'claude_code',
    sessionId,
    requestId: sdkEvent.permissionRequestId,
    toolName: sdkEvent.toolName,
    toolInput: sdkEvent.toolInput,
    toolUseId: sdkEvent.toolUseId,
    subject: subjectParts.join(' · '),
    details: detailLines.length > 0 ? detailLines.join('\n') : undefined,
    permissionHints: permissionHints && permissionHints.length > 0 ? permissionHints : undefined,
    nativeRequestRef: {
      runtimeId: 'claude_code',
      raw: sdkEvent,
    },
  };
}

/** Adapter helper — emits a `permission_granted` terminal event. */
export function emitPermissionGranted(
  runtimeId: RuntimeId,
  sessionId: string,
  requestId: string,
): GrantedEvent {
  return { type: 'permission_granted', runtimeId, sessionId, requestId };
}

/** Adapter helper — emits a `permission_denied` terminal event. */
export function emitPermissionDenied(
  runtimeId: RuntimeId,
  sessionId: string,
  requestId: string,
  reason?: string,
): DeniedEvent {
  return reason !== undefined
    ? { type: 'permission_denied', runtimeId, sessionId, requestId, reason }
    : { type: 'permission_denied', runtimeId, sessionId, requestId };
}

/**
 * Adapter helper — emits `permission_unavailable`. Use this when the
 * native approval event semantics are unknown / unmappable. NEVER
 * substitute `permission_granted` for an unknown native event — the
 * fall-through-to-allow is exactly the failure mode this event
 * type exists to prevent.
 */
export function emitPermissionUnavailable(
  runtimeId: RuntimeId,
  sessionId: string,
  requestId: string,
  reason: string,
): UnavailableEvent {
  return {
    type: 'permission_unavailable',
    runtimeId,
    sessionId,
    requestId,
    reason,
  };
}
