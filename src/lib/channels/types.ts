/**
 * Channel plugin system types.
 *
 * These interfaces define the contract between channel plugins (Feishu, etc.)
 * and the bridge system via ChannelPluginAdapter.
 */

import type { ChannelType, InboundMessage, OutboundMessage, SendResult } from '../bridge/types';

// ── Card Stream Controller ──────────────────────────────────────

/** Controls a streaming card lifecycle (create → update → finalize). */
/** Tool call info for card display */
export interface ToolCallInfo {
  id: string;
  name: string;
  status: 'running' | 'complete' | 'error';
}

export interface CardStreamController {
  /**
   * Create a streaming card in the given chat.
   * @param chatId Target chat ID
   * @param initialText Initial markdown content
   * @param replyToMessageId Optional message to reply to
   * @returns The platform message ID, or empty string if creation failed (triggers fallback)
   */
  create(chatId: string, initialText: string, replyToMessageId?: string): Promise<string>;

  /**
   * Stream-update the card content (throttled internally).
   * @returns 'ok' on success, 'fail' on error
   */
  update(messageId: string, text: string): Promise<'ok' | 'fail'>;

  /**
   * Finalize the card with the complete content and close streaming mode.
   * @param status 'completed' | 'interrupted' | 'error'
   */
  finalize(messageId: string, finalText: string, status?: 'completed' | 'interrupted' | 'error'): Promise<void>;

  /** Optional: update tool call progress display */
  updateToolCalls?(messageId: string, tools: ToolCallInfo[]): void;

  /** Optional: set thinking state before text starts flowing */
  setThinking?(messageId: string): void;
}

// ── Channel Capabilities ────────────────────────────────────────

export interface ChannelCapabilities {
  /** Whether the channel supports streaming card updates */
  streaming: boolean;
  /** Whether the channel supports thread replies */
  threadReply: boolean;
  /** Whether the channel supports message search */
  search: boolean;
  /** Whether the channel supports reading message history */
  history: boolean;
  /** Whether the channel supports reactions */
  reactions: boolean;
}

// ── Channel Meta ────────────────────────────────────────────────

export interface ChannelMeta {
  channelType: ChannelType;
  displayName: string;
}

// ── Probe Result ────────────────────────────────────────────────

export interface ProbeResult {
  ok: boolean;
  error?: string;
  botName?: string;
  botId?: string;
}

// ── Channel Plugin ──────────────────────────────────────────────

/**
 * Plugin interface for a channel implementation.
 * Generic parameter T is the plugin's config type.
 */
export interface ChannelPlugin<T = unknown> {
  readonly meta: ChannelMeta;

  /** Load and validate configuration. */
  loadConfig(): T | null;

  /** Get current capabilities (may depend on config). */
  getCapabilities(): ChannelCapabilities;

  /** Start the plugin (connect WS, start polling, etc.). */
  start(): Promise<void>;

  /** Stop the plugin gracefully. */
  stop(): Promise<void>;

  /** Whether the plugin is currently running. */
  isRunning(): boolean;

  /** Consume the next inbound message. Blocks until available or stopped. */
  consumeOne(): Promise<InboundMessage | null>;

  /** Send an outbound message. */
  send(message: OutboundMessage): Promise<SendResult>;

  /** Validate config completeness. Returns null if valid, error message otherwise. */
  validateConfig(): string | null;

  /** Check user authorization. */
  isAuthorized(userId: string, chatId: string): boolean;

  /** Optional: get a card stream controller. */
  getCardStreamController?(): CardStreamController | null;

  /** Optional: probe connectivity. */
  probe?(): Promise<ProbeResult>;

  /** Optional: lifecycle hooks. */
  onMessageStart?(chatId: string): void;
  onMessageEnd?(chatId: string): void;
}
