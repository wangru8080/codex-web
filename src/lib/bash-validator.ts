/**
 * bash-validator.ts — Bash command safety classification.
 *
 * Classifies bash commands into safety levels:
 * - safe: Read-only commands, common dev tools
 * - caution: Commands that modify files or system state
 * - danger: Destructive commands that could cause data loss
 *
 * Phase 4 implementation. Uses regex-based classification.
 * Future enhancement: bash-parser AST analysis (requires adding bash-parser dep).
 */

export type BashSafetyLevel = 'safe' | 'caution' | 'danger';

export interface BashValidationResult {
  level: BashSafetyLevel;
  reasons: string[];
}

// ── Pattern lists ───────────────────────────────────────────────

const SAFE_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'wc', 'file', 'stat',
  'ls', 'dir', 'pwd', 'echo', 'printf', 'which', 'type', 'where',
  'find', 'locate', 'grep', 'rg', 'ag', 'ack',
  'git status', 'git log', 'git diff', 'git show', 'git branch', 'git remote',
  'node --version', 'npm --version', 'python --version',
  'date', 'whoami', 'hostname', 'uname',
]);

const DANGER_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*r|-[a-zA-Z]*f|--recursive|--force)/, reason: 'Recursive/forced file deletion' },
  { pattern: /\bsudo\s/, reason: 'Elevated privileges (sudo)' },
  { pattern: /\bkill\s+-9\b/, reason: 'Force kill process' },
  { pattern: /\bkillall\b/, reason: 'Kill processes by name' },
  { pattern: /\bmkfs\b/, reason: 'Format filesystem' },
  { pattern: /\bdd\s+if=/, reason: 'Direct disk write (dd)' },
  { pattern: /\bfdisk\b/, reason: 'Disk partitioning' },
  { pattern: />\s*\/dev\//, reason: 'Write to device file' },
  { pattern: /\bchmod\s+[0-7]{3,4}\s/, reason: 'Change file permissions' },
  { pattern: /\bchown\s/, reason: 'Change file ownership' },
  { pattern: /\bgit\s+push\s+.*--force/, reason: 'Force push to remote' },
  { pattern: /\bgit\s+reset\s+--hard/, reason: 'Hard reset (discards changes)' },
  { pattern: /\bgit\s+clean\s+-[a-zA-Z]*f/, reason: 'Force clean untracked files' },
  { pattern: /\bcurl\s+.*\|\s*(sudo\s+)?bash/, reason: 'Pipe remote script to bash' },
  { pattern: /\bwget\s+.*\|\s*(sudo\s+)?bash/, reason: 'Pipe remote script to bash' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/, reason: 'System shutdown/reboot' },
  { pattern: /\bsystemctl\s+(stop|disable|mask)\b/, reason: 'Stop/disable system service' },
  { pattern: /\bnpm\s+publish\b/, reason: 'Publish to npm registry' },
  { pattern: /\bdocker\s+rm\s+-f/, reason: 'Force remove Docker container' },
];

const CAUTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s/, reason: 'File deletion' },
  { pattern: /\bmv\s/, reason: 'File move/rename' },
  { pattern: /\bcp\s+-[a-zA-Z]*r/, reason: 'Recursive copy' },
  { pattern: /\bgit\s+push\b/, reason: 'Push to remote' },
  { pattern: /\bgit\s+merge\b/, reason: 'Merge branches' },
  { pattern: /\bgit\s+rebase\b/, reason: 'Rebase' },
  { pattern: /\bgit\s+checkout\s/, reason: 'Switch branch/restore files' },
  { pattern: /\bnpm\s+install\b/, reason: 'Install packages' },
  { pattern: /\bpip\s+install\b/, reason: 'Install Python packages' },
  { pattern: /\bbrew\s+install\b/, reason: 'Install Homebrew package' },
  { pattern: />\s/, reason: 'Output redirection (may overwrite files)' },
  { pattern: /\bsed\s+-i\b/, reason: 'In-place file edit (sed)' },
  { pattern: /\bcurl\b/, reason: 'Network request' },
  { pattern: /\bwget\b/, reason: 'Network download' },
];

// ── Public API ──────────────────────────────────────────────────

/**
 * Classify a bash command's safety level.
 */
export function validateBashCommand(command: string): BashValidationResult {
  const reasons: string[] = [];

  // Check danger patterns first
  for (const { pattern, reason } of DANGER_PATTERNS) {
    if (pattern.test(command)) {
      reasons.push(reason);
    }
  }
  if (reasons.length > 0) {
    return { level: 'danger', reasons };
  }

  // Check caution patterns
  for (const { pattern, reason } of CAUTION_PATTERNS) {
    if (pattern.test(command)) {
      reasons.push(reason);
    }
  }
  if (reasons.length > 0) {
    return { level: 'caution', reasons };
  }

  // Check if it's a known safe command
  const baseCommand = command.trim().split(/\s/)[0];
  if (SAFE_COMMANDS.has(baseCommand) || SAFE_COMMANDS.has(command.trim())) {
    return { level: 'safe', reasons: [] };
  }

  // Unknown — default to caution
  return { level: 'caution', reasons: ['Unknown command'] };
}
