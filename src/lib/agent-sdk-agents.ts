/**
 * Agent SDK Agents Registry — manages built-in agent definitions
 * that can be injected into SDK query options.
 *
 * Existing "Image Agent" and other special agents in CodexWeb are
 * handled via system prompt injection, not SDK agents. This registry
 * is for future SDK-native agent integration.
 */

import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

const GLOBAL_KEY = '__agentSdkAgents__' as const;

function getRegistry(): Map<string, AgentDefinition> {
  if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new Map<string, AgentDefinition>();
  }
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Map<string, AgentDefinition>;
}

/**
 * Register a built-in agent definition.
 */
export function registerAgent(name: string, definition: AgentDefinition): void {
  getRegistry().set(name, definition);
}

/**
 * Unregister a built-in agent.
 */
export function unregisterAgent(name: string): void {
  getRegistry().delete(name);
}

/**
 * Get all registered agent definitions as a record suitable for SDK Options.agents.
 */
export function getRegisteredAgents(): Record<string, AgentDefinition> {
  const result: Record<string, AgentDefinition> = {};
  for (const [name, def] of getRegistry()) {
    result[name] = def;
  }
  return result;
}

/**
 * Get a specific registered agent.
 */
export function getAgent(name: string): AgentDefinition | undefined {
  return getRegistry().get(name);
}

/**
 * Check if any agents are registered.
 */
export function hasRegisteredAgents(): boolean {
  return getRegistry().size > 0;
}
