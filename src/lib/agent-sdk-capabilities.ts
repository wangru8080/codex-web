/**
 * Agent SDK Capabilities Cache — per-provider capability cache that captures
 * SDK data (models, commands, account info, MCP status) from active Query instances.
 *
 * Uses cache-on-first-query pattern: after each query() initialization,
 * capabilities are captured and cached, keyed by providerId, so different
 * providers never pollute each other's data.
 *
 * Uses globalThis pattern (same as conversation-registry.ts) to survive
 * Next.js HMR without losing state.
 */

import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type {
  ModelInfo,
  SlashCommand,
  AccountInfo,
  McpServerStatus,
} from '@anthropic-ai/claude-agent-sdk';
import { getConversation } from './conversation-registry';

// ==========================================
// Cache structure
// ==========================================

interface ProviderCapabilityCache {
  models: ModelInfo[];
  commands: SlashCommand[];
  account: AccountInfo | null;
  mcpStatus: McpServerStatus[];
  loadedPlugins: Array<{ name: string; path: string }>;
  capturedAt: number;
  sessionId: string;
}

const GLOBAL_KEY = '__agentSdkCapabilities__' as const;

/** Returns the per-provider cache Map. */
function getCacheMap(): Map<string, ProviderCapabilityCache> {
  if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new Map<string, ProviderCapabilityCache>();
  }
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Map<string, ProviderCapabilityCache>;
}

function getOrCreateCache(providerId: string): ProviderCapabilityCache {
  const map = getCacheMap();
  let cache = map.get(providerId);
  if (!cache) {
    cache = {
      models: [],
      commands: [],
      account: null,
      mcpStatus: [],
      loadedPlugins: [],
      capturedAt: 0,
      sessionId: '',
    };
    map.set(providerId, cache);
  }
  return cache;
}

// ==========================================
// Cache freshness
// ==========================================

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Check if the capability cache for a provider is still fresh (within TTL). */
export function isCacheFresh(providerId: string = 'env'): boolean {
  const cache = getCacheMap().get(providerId);
  return !!cache && cache.capturedAt > 0 && (Date.now() - cache.capturedAt) < CACHE_TTL_MS;
}

/**
 * Drop the cached capabilities for a provider. Must be called when the
 * provider row is edited or deleted — otherwise model lists and account
 * info captured under the old config keep serving for up to CACHE_TTL_MS.
 */
export function invalidateCapabilityCache(providerId: string): void {
  getCacheMap().delete(providerId);
}

// ==========================================
// Capture
// ==========================================

/**
 * Check if a conversation object is a real Query instance (not a resume-fallback
 * async generator wrapper). The resume fallback in claude-client.ts wraps the
 * iterator in a plain async generator that lacks Query control methods.
 */
function isRealQuery(conversation: unknown): conversation is Query {
  return (
    conversation != null &&
    typeof (conversation as Query).supportedModels === 'function' &&
    typeof (conversation as Query).supportedCommands === 'function' &&
    typeof (conversation as Query).accountInfo === 'function' &&
    typeof (conversation as Query).mcpServerStatus === 'function'
  );
}

/**
 * Capture all capabilities from an active Query instance.
 * Should be called fire-and-forget after registerConversation().
 * Safe to call with non-Query objects (resume fallback) — will silently skip.
 *
 * @param providerId - The provider ID that owns this session (e.g. 'env', a DB provider ID)
 */
export async function captureCapabilities(
  sessionId: string,
  conversation: unknown,
  providerId: string = 'env',
): Promise<void> {
  if (!isRealQuery(conversation)) {
    console.log('[capabilities] Skipping capture — not a real Query instance');
    return;
  }

  const cache = getOrCreateCache(providerId);

  try {
    const [models, commands, account, mcpStatus] = await Promise.allSettled([
      conversation.supportedModels(),
      conversation.supportedCommands(),
      conversation.accountInfo(),
      conversation.mcpServerStatus(),
    ]);

    // Guard: only overwrite cached models if the new result is non-empty.
    // An empty array (e.g. transient SDK error) would otherwise wipe valid cached data,
    // causing models like Opus to disappear from the selector after long idle.
    cache.models = models.status === 'fulfilled' && models.value.length > 0 ? models.value : cache.models;
    cache.commands = commands.status === 'fulfilled' && commands.value.length > 0 ? commands.value : cache.commands;
    cache.account = account.status === 'fulfilled' ? account.value : cache.account;
    cache.mcpStatus = mcpStatus.status === 'fulfilled' ? mcpStatus.value : cache.mcpStatus;
    cache.capturedAt = Date.now();
    cache.sessionId = sessionId;

    console.log(
      `[capabilities] Captured for provider="${providerId}":`,
      `models=${cache.models.length}`,
      `commands=${cache.commands.length}`,
      `account=${cache.account ? 'yes' : 'no'}`,
      `mcpServers=${cache.mcpStatus.length}`,
    );
  } catch (error) {
    console.warn('[capabilities] Capture failed:', error);
  }
}

// ==========================================
// Read cached data (scoped by provider)
// ==========================================

export function getCachedModels(providerId: string = 'env'): ModelInfo[] {
  return getOrCreateCache(providerId).models;
}

export function getCachedCommands(providerId: string = 'env'): SlashCommand[] {
  return getOrCreateCache(providerId).commands;
}

export function getCachedAccountInfo(providerId: string = 'env'): AccountInfo | null {
  return getOrCreateCache(providerId).account;
}

export function getCachedMcpStatus(providerId: string = 'env'): McpServerStatus[] {
  return getOrCreateCache(providerId).mcpStatus;
}

export function getCachedPlugins(providerId: string = 'env'): Array<{ name: string; path: string }> {
  return getOrCreateCache(providerId).loadedPlugins;
}

export function setCachedPlugins(providerId: string, plugins: Array<{ name: string; path: string }>): void {
  const cache = getOrCreateCache(providerId);
  cache.loadedPlugins = plugins;
}

export function getCapabilityCacheAge(providerId: string = 'env'): number {
  const { capturedAt } = getOrCreateCache(providerId);
  return capturedAt === 0 ? Infinity : Date.now() - capturedAt;
}

// ==========================================
// Refresh (from active Query)
// ==========================================

/**
 * Refresh MCP server status from an active Query instance.
 * Falls back to cached data if the session has no active conversation.
 */
export async function refreshMcpStatus(sessionId: string, providerId: string = 'env'): Promise<McpServerStatus[]> {
  const conversation = getConversation(sessionId);
  if (!isRealQuery(conversation)) {
    return getOrCreateCache(providerId).mcpStatus;
  }

  try {
    const status = await conversation.mcpServerStatus();
    const cache = getOrCreateCache(providerId);
    cache.mcpStatus = status;
    cache.capturedAt = Date.now();
    return status;
  } catch (error) {
    console.warn('[capabilities] MCP status refresh failed:', error);
    return getOrCreateCache(providerId).mcpStatus;
  }
}
