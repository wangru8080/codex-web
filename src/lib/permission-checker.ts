/**
 * permission-checker.ts — Permission system for the Native Runtime.
 *
 * Three-level mode system:
 * - explore: Read-only. Blocks all writes and dangerous commands.
 * - normal: Standard mode. Auto-allows reads and edits. Asks for bash commands.
 * - trust: Full access. Auto-allows everything.
 *
 * Rule engine (OpenCode-style): Array of rules evaluated with findLast semantics.
 * The last matching rule wins, allowing specific rules to override general ones.
 *
 * Bash safety: Dangerous commands (rm -rf, kill, format, etc.) always require
 * confirmation even in trust mode unless explicitly allowed by a rule.
 */

import { z } from 'zod';

// ── Types ───────────────────────────────────────────────────────

export type PermissionMode = 'explore' | 'normal' | 'trust';
export type PermissionAction = 'allow' | 'deny' | 'ask';

export const PermissionRuleSchema = z.object({
  permission: z.string(),  // tool name or '*'
  pattern: z.string(),     // glob pattern for tool input (e.g. 'rm *', '*.env')
  action: z.enum(['allow', 'deny', 'ask']),
});

export type PermissionRule = z.infer<typeof PermissionRuleSchema>;

export interface PermissionCheckResult {
  action: PermissionAction;
  reason?: string;
}

// ── Default rules per mode ──────────────────────────────────────

const EXPLORE_RULES: PermissionRule[] = [
  { permission: 'Read', pattern: '*', action: 'allow' },
  { permission: 'Glob', pattern: '*', action: 'allow' },
  { permission: 'Grep', pattern: '*', action: 'allow' },
  { permission: 'Write', pattern: '*', action: 'deny' },
  { permission: 'Edit', pattern: '*', action: 'deny' },
  { permission: 'Bash', pattern: '*', action: 'deny' },
  // Allow read-only bash commands
  { permission: 'Bash', pattern: 'cat *', action: 'allow' },
  { permission: 'Bash', pattern: 'ls *', action: 'allow' },
  { permission: 'Bash', pattern: 'head *', action: 'allow' },
  { permission: 'Bash', pattern: 'tail *', action: 'allow' },
  { permission: 'Bash', pattern: 'wc *', action: 'allow' },
  { permission: 'Bash', pattern: 'git log*', action: 'allow' },
  { permission: 'Bash', pattern: 'git status*', action: 'allow' },
  { permission: 'Bash', pattern: 'git diff*', action: 'allow' },
  { permission: 'Bash', pattern: 'git show*', action: 'allow' },
];

const NORMAL_RULES: PermissionRule[] = [
  { permission: 'Read', pattern: '*', action: 'allow' },
  { permission: 'Glob', pattern: '*', action: 'allow' },
  { permission: 'Grep', pattern: '*', action: 'allow' },
  { permission: 'Write', pattern: '*', action: 'allow' },
  { permission: 'Edit', pattern: '*', action: 'allow' },
  { permission: 'Bash', pattern: '*', action: 'ask' },
  // Common safe bash commands auto-allowed
  { permission: 'Bash', pattern: 'npm *', action: 'allow' },
  { permission: 'Bash', pattern: 'npx *', action: 'allow' },
  { permission: 'Bash', pattern: 'git *', action: 'allow' },
  { permission: 'Bash', pattern: 'node *', action: 'allow' },
  { permission: 'Bash', pattern: 'cat *', action: 'allow' },
  { permission: 'Bash', pattern: 'ls *', action: 'allow' },
  { permission: 'Bash', pattern: 'echo *', action: 'allow' },
  { permission: 'Bash', pattern: 'which *', action: 'allow' },
  { permission: 'Bash', pattern: 'pwd', action: 'allow' },
  // Sensitive files still ask
  { permission: 'Write', pattern: '*.env', action: 'ask' },
  { permission: 'Write', pattern: '*.env.*', action: 'ask' },
  { permission: 'Edit', pattern: '*.env', action: 'ask' },
  { permission: 'Edit', pattern: '*.env.*', action: 'ask' },
];

const TRUST_RULES: PermissionRule[] = [
  { permission: '*', pattern: '*', action: 'allow' },
];

// Dangerous bash patterns — always ask regardless of mode
const DANGEROUS_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r|-[a-zA-Z]*f|--recursive|--force)/,
  /\brm\s+-rf\b/,
  /\bsudo\s/,
  /\bkill\s/,
  /\bkillall\s/,
  /\bchmod\s+[0-7]{3,4}\s/,
  /\bchown\s/,
  /\bmkfs\b/,
  /\bdd\s+/,
  /\bformat\b/,
  /\bfdisk\b/,
  />\s*\/dev\//,
  /\bgit\s+push\s+.*--force/,
  /\bgit\s+reset\s+--hard/,
  /\bgit\s+clean\s+-[a-zA-Z]*f/,
];

// ── Public API ──────────────────────────────────────────────────

/**
 * Check whether a tool invocation should be allowed.
 *
 * @param toolName - The tool being called (e.g. 'Bash', 'Edit', 'Read')
 * @param input - The tool's input (used for pattern matching)
 * @param mode - Permission mode (explore/normal/trust). Defaults to 'normal'.
 * @param userRules - Additional user-defined rules (appended after mode defaults)
 */
/**
 * Tools that ALWAYS require user interaction regardless of permission mode.
 * Even in trust mode (which auto-allows everything), these tools must
 * show their UI because the tool's purpose IS the user interaction.
 *
 * - AskUserQuestion: model asks structured questions → user picks options
 * - ExitPlanMode: plan approval UI → user approves/rejects
 *
 * Without this, trust mode would auto-allow these tools and they'd
 * return empty/default answers, defeating their purpose.
 */
const ALWAYS_ASK_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

export function checkPermission(
  toolName: string,
  input: unknown,
  mode: PermissionMode = 'normal',
  userRules: PermissionRule[] = [],
): PermissionCheckResult {
  // Interactive tools — always ask regardless of mode
  if (ALWAYS_ASK_TOOLS.has(toolName)) {
    return {
      action: 'ask',
      reason: `${toolName} requires user interaction`,
    };
  }

  // Bash danger check — always ask for dangerous commands regardless of mode
  if (toolName === 'Bash' && input && typeof input === 'object' && 'command' in input) {
    const command = (input as { command: string }).command;
    if (isDangerousCommand(command)) {
      return {
        action: 'ask',
        reason: `Potentially dangerous command detected. Please confirm: ${command}`,
      };
    }
  }

  // Get mode default rules + user rules
  const modeRules = getModeRules(mode);
  const allRules = [...modeRules, ...userRules];

  // Extract the pattern to match against (tool-specific)
  const matchPattern = extractMatchPattern(toolName, input);

  // findLast semantics — last matching rule wins
  const match = findLastMatchingRule(allRules, toolName, matchPattern);

  if (match) {
    return { action: match.action };
  }

  // Default: ask (safest fallback)
  return { action: 'ask', reason: 'No matching permission rule' };
}

/**
 * Check if a bash command is dangerous (always requires confirmation).
 */
export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
}

// ── Internal ────────────────────────────────────────────────────

function getModeRules(mode: PermissionMode): PermissionRule[] {
  switch (mode) {
    case 'explore': return EXPLORE_RULES;
    case 'normal': return NORMAL_RULES;
    case 'trust': return TRUST_RULES;
    default: return NORMAL_RULES;
  }
}

/**
 * Extract the string to match against rule patterns.
 * For Bash: the command string.
 * For file tools: the file path.
 * For others: '*' (matches everything).
 */
function extractMatchPattern(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '*';

  if (toolName === 'Bash' && 'command' in input) {
    return (input as { command: string }).command;
  }

  if ('file_path' in input) {
    return (input as { file_path: string }).file_path;
  }

  if ('path' in input) {
    return (input as { path: string }).path;
  }

  return '*';
}

/**
 * Find the last rule that matches the given tool and pattern.
 * Uses simple wildcard matching (glob-style '*' only).
 */
function findLastMatchingRule(
  rules: PermissionRule[],
  toolName: string,
  matchPattern: string,
): PermissionRule | undefined {
  let lastMatch: PermissionRule | undefined;

  for (const rule of rules) {
    if (wildcardMatch(toolName, rule.permission) && wildcardMatch(matchPattern, rule.pattern)) {
      lastMatch = rule;
    }
  }

  return lastMatch;
}

/**
 * Simple wildcard matching. Supports '*' as "match anything".
 * 'npm *' matches 'npm install', 'npm run test', etc.
 * '*.env' matches '.env', 'production.env', etc.
 */
function wildcardMatch(str: string, pattern: string): boolean {
  if (pattern === '*') return true;

  // Convert glob pattern to regex
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars except *
    .replace(/\*/g, '.*');                  // * → .*

  return new RegExp(`^${escaped}$`, 'i').test(str);
}
