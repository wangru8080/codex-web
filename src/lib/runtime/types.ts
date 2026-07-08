/**
 * runtime/types.ts — Agent Runtime interface.
 *
 * Every runtime (Native, Claude Code SDK, future Codex/Gemini CLI/ACP)
 * implements this interface. The frontend consumes SSE events and is
 * completely unaware of which runtime is producing them.
 */

import type { MCPServerConfig } from '@/types';

/**
 * The single contract all Agent Runtimes must fulfil.
 *
 * Design principles:
 * - stream() is the only core method: options in → SSE ReadableStream out
 * - The 17 SSE event types (SSEEventType) are the output contract
 * - Keep the interface thin: don't abstract tools, messages, or permissions
 */
export interface AgentRuntime {
  /** Machine identifier (e.g. 'native', 'claude-code-sdk', 'codex') */
  readonly id: string;
  /** Human-readable name for settings UI */
  readonly displayName: string;
  /** Short description */
  readonly description: string;

  /**
   * Start an agent interaction. Returns a ReadableStream of SSE lines
   * (`data: {"type":"...","data":"..."}\n\n`).
   */
  stream(options: RuntimeStreamOptions): ReadableStream<string>;

  /** Interrupt the current interaction for a session. */
  interrupt(sessionId: string): void;

  /** Whether this runtime is currently usable (CLI installed, credentials available, etc.). */
  isAvailable(): boolean;

  /** Release resources (MCP connections, child processes, etc.). Called on app exit. */
  dispose(): void;
}

/**
 * Universal stream input. Extracted from ClaudeStreamOptions —
 * fields every runtime needs. Runtime-specific fields go in runtimeOptions.
 */
export interface RuntimeStreamOptions {
  // ── Core (all runtimes) ──
  prompt: string;
  sessionId: string;
  model?: string;
  systemPrompt?: string;
  workingDirectory?: string;
  abortController?: AbortController;
  autoTrigger?: boolean;

  // ── Provider (all runtimes need to know which provider to use) ──
  providerId?: string;
  sessionProviderId?: string;

  // ── Model capabilities (universal concepts, each runtime maps internally) ──
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens?: number } | { type: 'disabled' };
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  context1m?: boolean;

  // ── MCP (universal protocol, all runtimes should support) ──
  mcpServers?: Record<string, MCPServerConfig>;

  // ── Permissions (universal concept) ──
  permissionMode?: string;
  bypassPermissions?: boolean;

  // ── Callbacks ──
  onRuntimeStatusChange?: (status: string) => void;

  /**
   * Passthrough for runtime-specific options.
   *
   * SDK Runtime reads: sdkSessionId, files, conversationHistory, agents, agent,
   *   enableFileCheckpointing, outputFormat, generativeUI, etc.
   * Native Runtime reads: maxSteps, etc.
   * Future runtimes define their own keys.
   *
   * Type safety is handled inside each runtime implementation.
   */
  runtimeOptions?: Record<string, unknown>;
}
