import { useRef, useCallback } from 'react';
import type { SSEEvent, TokenUsage, PermissionRequestEvent, MediaBlock } from '@/types';

interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  media?: MediaBlock[];
}

export interface SkillNudgeData {
  message: string;
  step: number;
  distinctToolCount: number;
  toolNames: string[];
}

export interface SSECallbacks {
  onText: (accumulated: string) => void;
  onToolUse: (tool: ToolUseInfo) => void;
  onToolResult: (result: ToolResultInfo) => void;
  onToolOutput: (data: string) => void;
  onToolProgress: (toolName: string, elapsedSeconds: number) => void;
  onStatus: (text: string | undefined) => void;
  onResult: (usage: TokenUsage | null, meta?: { terminalReason?: string }) => void;
  /** SDK 0.2.111 subscription rate-limit telemetry. Fires only on
   *  claude.ai subscription paths; absent for API-key sessions. */
  onRateLimit?: (info: RateLimitInfo) => void;
  /** SDK 0.2.111 post-turn context-usage snapshot. Used by the chat
   *  page's indicator to replace char:token estimation for ~60s after
   *  capture. */
  onContextUsage?: (snapshot: ContextUsageSnapshot) => void;
  onPermissionRequest: (data: PermissionRequestEvent) => void;
  /** Server-side auto-resolve of a pending permission (currently only
   *  'timeout'). Lets the chat UI show "auto-denied — timed out" instead of
   *  the prompt silently vanishing (codebase-health A5 Step 2). */
  onPermissionResolved?: (permissionRequestId: string, status: 'timeout') => void;
  onToolTimeout: (toolName: string, elapsedSeconds: number) => void;
  onModeChanged: (mode: string) => void;
  onTaskUpdate: (sessionId: string) => void;
  onRewindPoint: (sdkUserMessageId: string) => void;
  /**
   * Phase 5 Phase 4 (2026-05-13) — explicit file-change channel.
   * Codex Runtime emits this for fs/changed + fileChange item events;
   * stream-session-manager hands the paths to `dispatchFileChanged`
   * so PreviewPanel auto-refreshes via the existing
   * `codepilot:file-changed` window event channel (same channel the
   * ClaudeCode SDK tool_result path already uses).
   *
   * SDK path doesn't emit this event — file changes from ClaudeCode
   * write/edit tools still flow through `isWriteTool` inspection
   * inside the onToolResult handler. The channels converge at
   * `dispatchFileChanged` in stream-session-manager.
   */
  onFileChanged?: (paths: string[]) => void;
  onThinking?: (delta: string) => void;
  onKeepAlive: () => void;
  onError: (accumulated: string) => void;
  onSkillNudge?: (data: SkillNudgeData) => void;
  onContextCompressed?: (data: { message: string; messagesCompressed: number; tokensSaved: number }) => void;
  onInitMeta?: (meta: {
    tools?: unknown;
    slash_commands?: unknown;
    skills?: unknown;
    plugins?: Array<{ name: string; path: string }>;
    mcp_servers?: unknown;
    output_style?: string;
  }) => void;
}

/**
 * Post-turn context-usage snapshot from Query.getContextUsage()
 * (SDK 0.2.111 Phase 5). Captured on the server and forwarded verbatim.
 */
export interface ContextUsageSnapshot {
  totalTokens: number;
  maxTokens: number;
  rawMaxTokens: number;
  percentage: number;
  model: string;
  capturedAt: number;
}

/**
 * Subscription rate-limit info payload mirroring SDKRateLimitInfo.
 * Forwarded verbatim from the server for Phase 2 of agent-sdk-0-2-111.
 */
export interface RateLimitInfo {
  status: 'allowed' | 'allowed_warning' | 'rejected';
  resetsAt?: number;
  rateLimitType?: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'overage';
  utilization?: number;
  overageStatus?: 'allowed' | 'allowed_warning' | 'rejected';
  overageResetsAt?: number;
  overageDisabledReason?: string;
  isUsingOverage?: boolean;
}

/**
 * Notification codes that must persist past the next setStatusText() call.
 * Scoped narrowly — only codes that represent one-shot decisions the user
 * needs to see regardless of subsequent streaming progress belong here.
 */
export const TOAST_STATUS_CODES = new Set<string>([
  'RUNTIME_EFFORT_IGNORED', // Opus 4.7+ family on native runtime — explicit effort dropped
  'THINKING_ALWAYS_ON', // Fable 5 — thinking:'disabled' cannot be honored, adaptive runs anyway
]);

/**
 * Inspect a parsed status event payload and fire a toast when it carries a
 * whitelisted code. Exposed so both useSSEStream's helper and inline SSE
 * parsers in page-level components can share toast routing without
 * duplicating the whitelist. No-op when the code isn't on the whitelist
 * or when the browser toast registry hasn't initialized (tests / SSR).
 */
export function maybeShowStatusToast(statusData: { code?: string; message?: string; title?: string }): void {
  if (!statusData?.code || !TOAST_STATUS_CODES.has(statusData.code)) return;
  void import('./useToast').then(({ showToast }) => {
    showToast({
      type: statusData.code === 'RUNTIME_EFFORT_IGNORED' || statusData.code === 'THINKING_ALWAYS_ON' ? 'warning' : 'info',
      message: statusData.message || statusData.title || 'Status notification',
      duration: 8000,
    });
  }).catch(() => { /* toast system unavailable — caller falls back to status text */ });
}

/**
 * Parse a single SSE line (after stripping "data: " prefix) and dispatch
 * to the appropriate callback.  Returns the updated accumulated text.
 */
function handleSSEEvent(
  event: SSEEvent,
  accumulated: string,
  callbacks: SSECallbacks,
): string {
  switch (event.type) {
    case 'text': {
      const next = accumulated + event.data;
      callbacks.onText(next);
      return next;
    }

    case 'thinking': {
      callbacks.onThinking?.(event.data);
      return accumulated;
    }

    case 'tool_use': {
      try {
        const toolData = JSON.parse(event.data);
        callbacks.onToolUse({
          id: toolData.id,
          name: toolData.name,
          input: toolData.input,
        });
      } catch (err) {
        // A dropped tool_use leaves no UI trace and orphans the later
        // tool_result — log enough to diagnose it from the console.
        console.error('[SSE] malformed tool_use event, dropped:', event.data.slice(0, 200), err);
      }
      return accumulated;
    }

    case 'tool_result': {
      try {
        const resultData = JSON.parse(event.data);
        callbacks.onToolResult({
          tool_use_id: resultData.tool_use_id,
          content: resultData.content,
          ...(resultData.is_error ? { is_error: true } : {}),
          ...(Array.isArray(resultData.media) && resultData.media.length > 0
            ? { media: resultData.media }
            : {}),
        });
      } catch (err) {
        // A dropped tool_result leaves its tool stuck in "running" in
        // the UI — log enough to diagnose it from the console.
        console.error('[SSE] malformed tool_result event, dropped:', event.data.slice(0, 200), err);
      }
      return accumulated;
    }

    case 'tool_output': {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed._progress) {
          callbacks.onToolProgress(parsed.tool_name, Math.round(parsed.elapsed_time_seconds));
          return accumulated;
        }
      } catch {
        // Not JSON - raw stderr output, fall through
      }
      callbacks.onToolOutput(event.data);
      return accumulated;
    }

    case 'status': {
      try {
        const statusData = JSON.parse(event.data);
        // Skip internal-only status events (e.g. resume fallback notifications)
        if (statusData._internal) {
          return accumulated;
        }
        // Skill nudge — dedicated handler for persistent UI banner
        if (statusData.subtype === 'skill_nudge' && statusData.payload) {
          callbacks.onSkillNudge?.({
            message: statusData.message || statusData.payload.message || '',
            step: statusData.payload.reason?.step || 0,
            distinctToolCount: statusData.payload.reason?.distinctToolCount || 0,
            toolNames: statusData.payload.reason?.toolNames || [],
          });
          return accumulated;
        }
        // Context compressed — dedicated handler so stream-session-manager
        // dispatches the 'context-compressed' window event (drives hasSummary
        // state in ChatView). Before the human-readable message change,
        // onStatus received the literal string 'context_compressed' and the
        // manager matched it directly. Now the SSE payload has subtype +
        // structured stats, so we intercept here before it hits the generic
        // notification branch which would pass the full message string.
        if (statusData.subtype === 'context_compressed') {
          callbacks.onContextCompressed?.({
            message: statusData.message || '',
            messagesCompressed: statusData.stats?.messagesCompressed || 0,
            tokensSaved: statusData.stats?.tokensSaved || 0,
          });
          return accumulated;
        }
        if (statusData.session_id) {
          callbacks.onStatus(`Connected (${statusData.requested_model || statusData.model || 'claude'})`);
          callbacks.onInitMeta?.({
            tools: statusData.tools,
            slash_commands: statusData.slash_commands,
            skills: statusData.skills,
            plugins: statusData.plugins,
            mcp_servers: statusData.mcp_servers,
            output_style: statusData.output_style,
          });
        } else if (statusData.notification) {
          // Code-driven toasts (e.g. Opus 4.7 native-runtime
          // RUNTIME_EFFORT_IGNORED): route through the shared helper so
          // the inline parser in app/chat/page.tsx can reuse the same
          // whitelist without duplicating the toast import logic.
          maybeShowStatusToast(statusData);
          callbacks.onStatus(statusData.message || statusData.title || undefined);
        } else if (statusData.apiRetry) {
          // #635 — api_retry status has no display text of its own; show human
          // copy (NOT the raw JSON) and still call onStatus so the idle timer is
          // refreshed (markActive). `attempt` is the SDK's raw value. (Full i18n
          // of the status bar — incl. the existing English "Connected" — is a
          // separate follow-up.)
          callbacks.onStatus(
            typeof statusData.attempt === 'number'
              ? `Retrying upstream (attempt ${statusData.attempt})…`
              : 'Retrying upstream…',
          );
        } else {
          callbacks.onStatus(typeof event.data === 'string' ? event.data : undefined);
        }
      } catch {
        callbacks.onStatus(event.data || undefined);
      }
      return accumulated;
    }

    case 'result': {
      try {
        const resultData = JSON.parse(event.data);
        const meta = resultData.terminal_reason ? { terminalReason: resultData.terminal_reason as string } : undefined;
        callbacks.onResult(resultData.usage || null, meta);
      } catch {
        callbacks.onResult(null);
      }
      callbacks.onStatus(undefined);
      return accumulated;
    }

    case 'rate_limit': {
      // SDK 0.2.111 subscription rate-limit event. Structured payload
      // forwarded from claude-client.ts verbatim.
      try {
        const info = JSON.parse(event.data) as RateLimitInfo;
        callbacks.onRateLimit?.(info);
      } catch {
        // skip malformed payload — better to miss a rate-limit update
        // than to crash the stream
      }
      return accumulated;
    }

    case 'context_usage': {
      // Phase 5 — post-turn context-usage snapshot. Swallow parse errors
      // silently; estimator fallback already covers the no-snapshot case.
      try {
        const snap = JSON.parse(event.data) as ContextUsageSnapshot;
        callbacks.onContextUsage?.(snap);
      } catch { /* estimator still applies */ }
      return accumulated;
    }

    case 'permission_request': {
      try {
        const permData: PermissionRequestEvent = JSON.parse(event.data);
        callbacks.onPermissionRequest(permData);
      } catch {
        // skip malformed permission_request data
      }
      return accumulated;
    }

    case 'permission_resolved': {
      // A5 Step 2 — registry timed out a pending request and auto-denied it.
      try {
        const data = JSON.parse(event.data) as { permissionRequestId: string; status: 'timeout' };
        callbacks.onPermissionResolved?.(data.permissionRequestId, data.status);
      } catch {
        // skip malformed permission_resolved data
      }
      return accumulated;
    }

    case 'tool_timeout': {
      try {
        const timeoutData = JSON.parse(event.data);
        callbacks.onToolTimeout(timeoutData.tool_name, timeoutData.elapsed_seconds);
      } catch {
        // skip malformed timeout data
      }
      return accumulated;
    }

    case 'mode_changed': {
      callbacks.onModeChanged(event.data);
      return accumulated;
    }

    case 'file_changed': {
      // Phase 5 Phase 4 (2026-05-13). Codex Runtime emits this with a
      // JSON payload `{ paths: string[] }`. Stream-session-manager
      // forwards to dispatchFileChanged so PreviewPanel quiet-refreshes.
      try {
        const payload = JSON.parse(event.data) as { paths?: unknown };
        if (Array.isArray(payload.paths)) {
          const paths = payload.paths.filter((p): p is string => typeof p === 'string');
          if (paths.length > 0) callbacks.onFileChanged?.(paths);
        }
      } catch {
        // Malformed payload — drop silently (the event channel is
        // best-effort; missing a refresh is worse than crashing the
        // stream, so we tolerate parse errors here).
      }
      return accumulated;
    }

    case 'task_update': {
      try {
        const taskData = JSON.parse(event.data);
        callbacks.onTaskUpdate(taskData.session_id);
      } catch {
        // skip malformed task_update data
      }
      return accumulated;
    }

    case 'rewind_point': {
      try {
        const rpData = JSON.parse(event.data);
        if (rpData.userMessageId) {
          callbacks.onRewindPoint(rpData.userMessageId);
        }
      } catch {
        // skip malformed rewind_point data
      }
      return accumulated;
    }

    case 'keep_alive': {
      callbacks.onKeepAlive();
      return accumulated;
    }

    case 'error': {
      // Try to parse structured error JSON from error-classifier
      let errorDisplay: string;
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.category && parsed.userMessage) {
          // Structured error from classifier
          errorDisplay = parsed.userMessage;
          if (parsed.actionHint) {
            errorDisplay += `\n\n**What to do:** ${parsed.actionHint}`;
          }
          if (parsed.details) {
            errorDisplay += `\n\nDetails: ${parsed.details}`;
          }
          // Render recovery actions as markdown links
          if (parsed.recoveryActions && parsed.recoveryActions.length > 0) {
            const links: string[] = [];
            for (const a of parsed.recoveryActions as Array<{ label: string; url?: string; action?: string }>) {
              if (a.url) {
                links.push(`[${a.label}](${a.url})`);
              } else if (a.action === 'open_settings') {
                links.push(`[${a.label}](/settings/codex)`);
              } else if (a.action === 'new_conversation') {
                links.push(`[${a.label}](/chat)`);
              }
              // 'retry' is handled by the retryable flag, not as a link
            }
            if (links.length > 0) {
              errorDisplay += '\n\n' + links.join(' · ');
            }
          }
        } else {
          errorDisplay = event.data;
        }
      } catch {
        // Plain text error (backward compatible)
        errorDisplay = event.data;
      }
      const next = accumulated + '\n\n**Error:** ' + errorDisplay;
      callbacks.onError(next);
      return next;
    }

    case 'done': {
      return accumulated;
    }

    default:
      return accumulated;
  }
}

/**
 * Reads an SSE response body and dispatches parsed events through callbacks.
 * Returns the final accumulated text and token usage.
 */
export async function consumeSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: SSECallbacks,
): Promise<{ accumulated: string; tokenUsage: TokenUsage | null }> {
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let tokenUsage: TokenUsage | null = null;

  const wrappedCallbacks: SSECallbacks = {
    ...callbacks,
    onResult: (usage, meta) => {
      tokenUsage = usage;
      callbacks.onResult(usage, meta);
    },
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;

      try {
        const event: SSEEvent = JSON.parse(line.slice(6));
        accumulated = handleSSEEvent(event, accumulated, wrappedCallbacks);
      } catch {
        // skip malformed SSE lines
      }
    }
  }

  return { accumulated, tokenUsage };
}

/**
 * Hook that provides a stable consumeSSEStream function bound to the latest
 * callbacks via a ref, avoiding stale closures.
 */
export function useSSEStream() {
  const callbacksRef = useRef<SSECallbacks | null>(null);

  const processStream = useCallback(
    async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      callbacks: SSECallbacks,
    ) => {
      callbacksRef.current = callbacks;

      // Proxy through ref so callers always hit the latest callbacks
      const proxied: SSECallbacks = {
        onText: (a) => callbacksRef.current?.onText(a),
        onToolUse: (t) => callbacksRef.current?.onToolUse(t),
        onToolResult: (r) => callbacksRef.current?.onToolResult(r),
        onToolOutput: (d) => callbacksRef.current?.onToolOutput(d),
        onToolProgress: (n, s) => callbacksRef.current?.onToolProgress(n, s),
        onStatus: (t) => callbacksRef.current?.onStatus(t),
        onResult: (u, meta) => callbacksRef.current?.onResult(u, meta),
        onPermissionRequest: (d) => callbacksRef.current?.onPermissionRequest(d),
        onPermissionResolved: (id, s) => callbacksRef.current?.onPermissionResolved?.(id, s),
        onToolTimeout: (n, s) => callbacksRef.current?.onToolTimeout(n, s),
        onModeChanged: (m) => callbacksRef.current?.onModeChanged(m),
        onTaskUpdate: (s) => callbacksRef.current?.onTaskUpdate(s),
        onRewindPoint: (id) => callbacksRef.current?.onRewindPoint(id),
        onThinking: (d) => callbacksRef.current?.onThinking?.(d),
        onKeepAlive: () => callbacksRef.current?.onKeepAlive(),
        onError: (a) => callbacksRef.current?.onError(a),
        onInitMeta: (m) => callbacksRef.current?.onInitMeta?.(m),
        onRateLimit: (info) => callbacksRef.current?.onRateLimit?.(info),
        onContextUsage: (snap) => callbacksRef.current?.onContextUsage?.(snap),
      };

      return consumeSSEStream(reader, proxied);
    },
    [],
  );

  return { processStream };
}
