/**
 * agent-registry.ts — Sub-agent definition registry.
 *
 * Stores built-in and custom agent definitions that can be spawned
 * via the AgentTool. Each definition specifies tools, model, system prompt,
 * and execution constraints.
 */

export interface AgentDefinition {
  /** Agent identifier */
  id: string;
  /** Human-readable name */
  displayName: string;
  /** Description (shown to the model) */
  description: string;
  /** Agent mode */
  mode: 'subagent' | 'primary';
  /** Allowed tools (empty = all except Agent itself) */
  allowedTools?: string[];
  /** Disallowed tools */
  disallowedTools?: string[];
  /** Model override (uses parent model if not set) */
  model?: string;
  /** Max steps for the sub-agent loop */
  maxSteps?: number;
  /** Custom system prompt (appended to base prompt) */
  prompt?: string;
}

// ── Built-in agents ─────────────────────────────────────────────

const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    id: 'explore',
    displayName: 'Explore',
    description: 'Fast agent for codebase exploration. Read-only tools, quick searches.',
    mode: 'subagent',
    allowedTools: ['Read', 'Glob', 'Grep'],
    maxSteps: 20,
    prompt: 'You are a fast codebase exploration agent. Search efficiently, report findings concisely. Do not modify any files.',
  },
  {
    id: 'general',
    displayName: 'General',
    description: 'General-purpose sub-agent for complex multi-step tasks.',
    mode: 'subagent',
    disallowedTools: ['Agent'], // prevent recursive sub-agents
    maxSteps: 30,
  },
];

// ── Registry ────────────────────────────────────────────────────

const agents = new Map<string, AgentDefinition>();

// Register built-ins
for (const agent of BUILTIN_AGENTS) {
  agents.set(agent.id, agent);
}

export function registerAgent(definition: AgentDefinition): void {
  agents.set(definition.id, definition);
}

export function getAgent(id: string): AgentDefinition | undefined {
  return agents.get(id);
}

export function getAllAgents(): AgentDefinition[] {
  return Array.from(agents.values());
}

export function getSubAgents(): AgentDefinition[] {
  return getAllAgents().filter(a => a.mode === 'subagent');
}
