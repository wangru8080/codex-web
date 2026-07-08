import type { NativePermissionResult } from './types/agent-types';
import { resolvePermissionRequest as dbResolvePermission } from './db';

// Use our own type. SDK path casts to this at the boundary.
type PermissionResult = NativePermissionResult;

interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  createdAt: number;
  abortSignal?: AbortSignal;
  toolInput: Record<string, unknown>;
  timer: ReturnType<typeof setTimeout>;
}

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Use globalThis to ensure the Map is shared across all module instances.
// In Next.js dev mode (Turbopack), different API routes may load separate
// module instances, so a module-level variable would NOT be shared.
const globalKey = '__pendingPermissions__' as const;

function getMap(): Map<string, PendingPermission> {
  if (!(globalThis as Record<string, unknown>)[globalKey]) {
    (globalThis as Record<string, unknown>)[globalKey] = new Map<string, PendingPermission>();
  }
  return (globalThis as Record<string, unknown>)[globalKey] as Map<string, PendingPermission>;
}

/**
 * The deny reason surfaced when a request is auto-denied because the user
 * never responded within TIMEOUT_MS. Named constant so the timeout path and
 * anything that needs to recognise "this was a timeout, not a manual deny"
 * stay in sync (codebase-health A5).
 */
const TIMEOUT_MESSAGE = 'Permission request timed out';

/**
 * Shape of the `permission_resolved` SSE event payload (codebase-health A5
 * Step 2). Emitted only when the registry auto-resolves WITHOUT user action so
 * the frontend can distinguish an auto-deny from one the user clicked. Today
 * the only auto-resolve reason surfaced to the UI is `timeout`; abort is the
 * user's own Stop, so it isn't pushed.
 */
export interface PermissionResolvedEventData {
  permissionRequestId: string;
  status: 'timeout';
}

/**
 * Build the transport-agnostic `{ type, data }` SSE event object every caller
 * emits on timeout. Single source so the event name / payload field names
 * can't drift across the four registration sites (SDK / native tools / Codex
 * approval / Codex MCP elicitation), each of which has a different emit
 * transport (controller.enqueue / ctx.emitSSE / raw string).
 */
export function buildPermissionResolvedEvent(
  permissionRequestId: string,
): { type: 'permission_resolved'; data: string } {
  return {
    type: 'permission_resolved',
    data: JSON.stringify({
      permissionRequestId,
      status: 'timeout',
    } satisfies PermissionResolvedEventData),
  };
}

/**
 * Single finalize exit for a pending permission (codebase-health A5 Step 1).
 *
 * allow / deny / timeout / abort all converge here so the four-step teardown
 * — clearTimeout, persist to DB, resolve the in-memory waiter, drop the map
 * entry — can't drift between paths. Previously each of the three paths
 * re-implemented it and they had already diverged in DB-write ordering.
 *
 * DB write happens BEFORE resolve(): resolvePendingPermission documented that
 * ordering ("persist before resolving in-memory") and the other paths now
 * share it. A DB failure is swallowed so it can never block the in-memory
 * resolve that unblocks the agent turn.
 *
 * Returns true if a pending entry was found and finalized, false otherwise
 * (already resolved / unknown id) — callers no-op idempotently on false.
 */
function finalizePermission(
  id: string,
  result: PermissionResult,
  dbStatus: 'allow' | 'deny' | 'timeout' | 'aborted',
  dbExtra?: {
    updatedPermissions?: unknown[];
    updatedInput?: Record<string, unknown>;
    message?: string;
  },
): boolean {
  const map = getMap();
  const entry = map.get(id);
  if (!entry) return false;
  clearTimeout(entry.timer);
  try {
    dbResolvePermission(id, dbStatus, dbExtra);
  } catch {
    // DB write failure should not affect in-memory path
  }
  entry.resolve(result);
  map.delete(id);
  return true;
}

/**
 * Deny and remove a pending permission entry (abort / timeout paths).
 * Thin wrapper over finalizePermission so it shares the one exit.
 */
function denyAndRemove(id: string, message: string, dbStatus: 'timeout' | 'aborted' = 'aborted') {
  finalizePermission(id, { behavior: 'deny', message }, dbStatus, { message });
}

/**
 * Register a pending permission request.
 * Returns a Promise that resolves when the user responds or after TIMEOUT_MS.
 */
export function registerPendingPermission(
  id: string,
  toolInput: Record<string, unknown>,
  abortSignal?: AbortSignal,
  // codebase-health A5 Step 2 — invoked when (and only when) the request
  // auto-denies on TIMEOUT, so the caller can push a `permission_resolved`
  // event down its still-open stream and the chat UI can show "auto-denied,
  // timed out" instead of the request silently vanishing. Not called on user
  // resolve (UI is optimistic) or abort (user's own Stop).
  onTimeout?: () => void,
): Promise<PermissionResult> {
  const map = getMap();

  return new Promise<PermissionResult>((resolve) => {
    // Per-request independent timer: auto-deny after TIMEOUT_MS.
    // `.unref()` so this timer doesn't prevent Node process from exiting
    // during graceful shutdown — if the app is closing, we don't need to
    // fire the timeout handler.
    const timer = setTimeout(() => {
      if (map.has(id)) {
        console.warn(`[permission-registry] Permission request ${id} timed out after ${TIMEOUT_MS / 1000}s`);
        // Notify the UI via the caller's still-open stream BEFORE finalizing,
        // so a `permission_resolved(timeout)` event rides the same channel the
        // original `permission_request` did. Guarded: if the stream is already
        // closing/errored the enqueue can throw — the deny must still apply.
        try {
          onTimeout?.();
        } catch {
          // stream may be closing; the deny below still unblocks the turn
        }
        finalizePermission(
          id,
          { behavior: 'deny', message: TIMEOUT_MESSAGE },
          'timeout',
          { message: TIMEOUT_MESSAGE },
        );
      }
    }, TIMEOUT_MS);
    if (typeof timer === 'object' && 'unref' in timer) {
      (timer as NodeJS.Timeout).unref();
    }

    map.set(id, {
      resolve,
      createdAt: Date.now(),
      abortSignal,
      toolInput,
      timer,
    });

    // Auto-deny if the abort signal fires (client disconnect / stop button)
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => denyAndRemove(id, 'Request aborted'), { once: true });
    }
  });
}

/**
 * Resolve a pending permission request with the user's decision.
 * Returns true if the permission was found and resolved, false otherwise.
 */
export function resolvePendingPermission(
  id: string,
  result: PermissionResult,
): boolean {
  const map = getMap();
  const entry = map.get(id);
  if (!entry) return false;

  // Default updatedInput to the originally-requested toolInput on allow —
  // needs the entry, so resolved here before delegating to the shared exit.
  if (result.behavior === 'allow' && !result.updatedInput) {
    result = { ...result, updatedInput: entry.toolInput };
  }

  const dbStatus = result.behavior === 'allow' ? 'allow' as const : 'deny' as const;
  return finalizePermission(id, result, dbStatus, {
    updatedPermissions: result.behavior === 'allow' ? (result.updatedPermissions as unknown[]) : undefined,
    updatedInput: result.behavior === 'allow' ? (result.updatedInput as Record<string, unknown>) : undefined,
    message: result.behavior === 'deny' ? result.message : undefined,
  });
}
