/**
 * skill-discovery.ts — Discover SKILL.md files from multiple directories.
 *
 * Scans:
 * - .claude/skills/ (project-level)
 * - ~/.claude/skills/ (user-level)
 * - ~/.agents/skills/ (cross-agent skills)
 * - .claude/commands/ (project slash commands)
 * - ~/.claude/commands/ (global slash commands)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseSkillFile, type SkillDefinition } from './skill-parser';

const SKILL_FILE_PATTERNS = ['SKILL.md', '*.md'];
const SKILL_DIRS = [
  // Project-level
  '.claude/skills',
  '.claude/commands',
  // User-level
  path.join(os.homedir(), '.claude', 'skills'),
  path.join(os.homedir(), '.claude', 'commands'),
  path.join(os.homedir(), '.agents', 'skills'),
];

// Cache for discovered skills (invalidated on re-scan)
let cachedSkills: SkillDefinition[] | null = null;
let cacheWorkingDir: string | null = null;

/**
 * Discover all available skills for the given working directory.
 * Results are cached per working directory.
 */
export function discoverSkills(workingDirectory?: string): SkillDefinition[] {
  const cwd = workingDirectory || process.cwd();

  if (cachedSkills && cacheWorkingDir === cwd) {
    return cachedSkills;
  }

  const skills: SkillDefinition[] = [];
  const seen = new Set<string>(); // dedup by name

  // Scan all skill directories
  for (const dir of getSkillDirs(cwd)) {
    if (!fs.existsSync(dir)) continue;

    try {
      scanDirectory(dir, skills, seen);
    } catch {
      // Skip inaccessible directories
    }
  }

  cachedSkills = skills;
  cacheWorkingDir = cwd;
  return skills;
}

/**
 * Invalidate the skill cache (call after skill files change).
 */
export function invalidateSkillCache(): void {
  cachedSkills = null;
  cacheWorkingDir = null;
}

/**
 * Get a skill by name.
 */
export function getSkill(name: string, workingDirectory?: string): SkillDefinition | undefined {
  const skills = discoverSkills(workingDirectory);
  return skills.find(s => s.name === name || s.name.toLowerCase() === name.toLowerCase());
}

// ── Internal ────────────────────────────────────────────────────

function getSkillDirs(cwd: string): string[] {
  return [
    // Project-level first (higher priority)
    path.join(cwd, '.claude', 'skills'),
    path.join(cwd, '.claude', 'commands'),
    // Then user-level
    path.join(os.homedir(), '.claude', 'skills'),
    path.join(os.homedir(), '.claude', 'commands'),
    path.join(os.homedir(), '.agents', 'skills'),
  ];
}

function scanDirectory(dir: string, skills: SkillDefinition[], seen: Set<string>): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Look for SKILL.md inside subdirectories (e.g. .claude/skills/my-skill/SKILL.md)
      const skillFile = path.join(fullPath, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        tryParseSkill(skillFile, skills, seen);
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      tryParseSkill(fullPath, skills, seen);
    }
  }
}

function tryParseSkill(filePath: string, skills: SkillDefinition[], seen: Set<string>): void {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const skill = parseSkillFile(content, filePath);

    // Dedup by name (first one wins — project-level overrides user-level)
    const key = skill.name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      skills.push(skill);
    }
  } catch {
    // Skip unparseable files
  }
}
