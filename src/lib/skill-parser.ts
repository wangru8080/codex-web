/**
 * skill-parser.ts — Parse SKILL.md files (YAML frontmatter + Markdown body).
 *
 * Compatible with Claude Code's skill format. Parses all execution-semantic
 * fields (allowed-tools, context, when_to_use, arguments, etc.) not just
 * name + description.
 */

export interface SkillDefinition {
  /** Skill name (from frontmatter or filename) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Full markdown body (the prompt content) */
  body: string;
  /** Tools the skill is allowed to use (empty = all) */
  allowedTools: string[];
  /** When the model should use this skill */
  whenToUse?: string;
  /** Execution context: inline (inject into conversation) or fork (sub-agent) */
  context: 'inline' | 'fork';
  /** Skill arguments (template variables) */
  arguments: SkillArgument[];
  /** Model override */
  model?: string;
  /** Effort level override */
  effort?: string;
  /** Whether this skill is user-invocable as a slash command */
  userInvocable: boolean;
  /** Source file path */
  filePath: string;
}

export interface SkillArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/**
 * Parse a SKILL.md file content into a SkillDefinition.
 */
export function parseSkillFile(content: string, filePath: string): SkillDefinition {
  const { frontmatter, body } = splitFrontmatter(content);

  return {
    name: String(frontmatter.name || '') || fileNameToSkillName(filePath),
    description: String(frontmatter.description || ''),
    body: body.trim(),
    allowedTools: parseStringArray(frontmatter['allowed-tools']),
    whenToUse: String(frontmatter['when_to_use'] || frontmatter.when_to_use || '') || undefined,
    context: frontmatter.context === 'fork' ? 'fork' : 'inline',
    arguments: parseArguments(frontmatter.arguments),
    model: frontmatter.model ? String(frontmatter.model) : undefined,
    effort: frontmatter.effort ? String(frontmatter.effort) : undefined,
    userInvocable: frontmatter['user-invocable'] !== false,
    filePath,
  };
}

// ── Internal ────────────────────────────────────────────────────

interface ParsedFrontmatter {
  [key: string]: unknown;
}

function splitFrontmatter(content: string): { frontmatter: ParsedFrontmatter; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const yamlStr = match[1];
  const body = match[2];

  // Simple YAML parser (handles key: value, key: [array], nested objects)
  const frontmatter: ParsedFrontmatter = {};
  for (const line of yamlStr.split('\n')) {
    const kvMatch = line.match(/^(\S[\w-]*)\s*:\s*(.*)$/);
    if (!kvMatch) continue;

    const [, key, rawValue] = kvMatch;
    const value = rawValue.trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      // Inline array: [Read, Write, Edit]
      frontmatter[key] = value.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    } else if (value === 'true') {
      frontmatter[key] = true;
    } else if (value === 'false') {
      frontmatter[key] = false;
    } else if (value === '' || value === '~' || value === 'null') {
      frontmatter[key] = undefined;
    } else {
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

function parseArguments(value: unknown): SkillArgument[] {
  if (!Array.isArray(value)) return [];
  return value.map(arg => {
    if (typeof arg === 'string') return { name: arg };
    if (arg && typeof arg === 'object') {
      return {
        name: String((arg as Record<string, unknown>).name || ''),
        description: (arg as Record<string, unknown>).description as string | undefined,
        required: (arg as Record<string, unknown>).required as boolean | undefined,
      };
    }
    return { name: String(arg) };
  }).filter(a => a.name);
}

function fileNameToSkillName(filePath: string): string {
  const base = filePath.split('/').pop() || '';
  return base.replace(/\.(md|skill)$/i, '').replace(/[-_]/g, ' ');
}
