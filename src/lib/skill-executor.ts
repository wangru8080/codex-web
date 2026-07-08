/**
 * skill-executor.ts — Execute skills in the Native Runtime.
 *
 * Inline mode: Inject the skill's prompt body into the conversation.
 * Fork mode: Start a sub-agent with restricted tools (requires Phase 7 AgentTool).
 */

import type { SkillDefinition } from './skill-parser';

export interface SkillExecutionResult {
  /** The prompt text to inject (for inline mode) */
  prompt: string;
  /** Whether this should be executed as a sub-agent */
  fork: boolean;
  /** Tool restrictions for fork mode */
  allowedTools?: string[];
}

/**
 * Prepare a skill for execution.
 *
 * For inline skills: returns the prompt body with argument substitution.
 * For fork skills: returns the prompt + fork flag + tool restrictions.
 */
export function prepareSkillExecution(
  skill: SkillDefinition,
  args: Record<string, string> = {},
): SkillExecutionResult {
  let prompt = skill.body;

  // Substitute template variables ($arg or ${arg})
  for (const [key, value] of Object.entries(args)) {
    prompt = prompt.replace(new RegExp(`\\$\\{?${key}\\}?`, 'g'), value);
  }

  // Substitute built-in variables
  prompt = prompt.replace(/\$\{CLAUDE_SKILL_DIR\}/g, getSkillDir(skill.filePath));

  return {
    prompt,
    fork: skill.context === 'fork',
    allowedTools: skill.allowedTools.length > 0 ? skill.allowedTools : undefined,
  };
}

function getSkillDir(filePath: string): string {
  // If SKILL.md is in a subdirectory, return that directory
  // e.g. .claude/skills/my-skill/SKILL.md → .claude/skills/my-skill/
  const dir = filePath.replace(/[/\\][^/\\]+$/, '');
  return dir;
}
