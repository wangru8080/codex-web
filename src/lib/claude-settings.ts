/**
 * claude-settings.ts — Read Anthropic credentials from ~/.claude/settings.json.
 *
 * External tools (notably cc-switch, but also any user who manually edits the
 * file) manage Claude Code CLI credentials by writing an `env` block in
 * ~/.claude/settings.json. The Agent SDK loads this file when
 * `settingSources` includes `'user'` and merges the env into the subprocess,
 * skipping keys in its internal blocklist (which does NOT cover
 * ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL).
 *
 * CodexWeb's runtime resolver needs the same visibility so auto mode can
 * pick the SDK runtime (instead of falling back to native, which cannot read
 * this file at all).
 *
 * This reader is intentionally tiny and dependency-free, and silently returns
 * null on any error — callers must be resilient to a missing file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ClaudeSettingsCredentials {
  apiKey?: string;
  authToken?: string;
  baseUrl?: string;
}

/**
 * Read ~/.claude/settings.json (or legacy ~/.claude/claude.json) and extract
 * the Anthropic credential fields from its `env` block.
 *
 * Returns null when no file exists, the file is unparseable, or no auth-
 * related fields are present. Non-empty strings are preserved as-is.
 */
export function readClaudeSettingsCredentials(): ClaudeSettingsCredentials | null {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.claude', 'settings.json'),
    path.join(home, '.claude', 'claude.json'), // legacy name still used by some cc-switch installs
  ];

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw);
      const env = parsed?.env;
      if (!env || typeof env !== 'object') continue;

      const pick = (key: string): string | undefined => {
        const v = env[key];
        return typeof v === 'string' && v.length > 0 ? v : undefined;
      };

      const apiKey = pick('ANTHROPIC_API_KEY');
      const authToken = pick('ANTHROPIC_AUTH_TOKEN');
      const baseUrl = pick('ANTHROPIC_BASE_URL');

      if (!apiKey && !authToken && !baseUrl) continue;

      return { apiKey, authToken, baseUrl };
    } catch {
      // Unreadable / malformed / permission-denied — treat as absent and try next file.
    }
  }

  return null;
}

/**
 * Quick boolean check: does the user have cc-switch / external-managed
 * Anthropic credentials in their ~/.claude/settings.json?
 *
 * Equivalent to `!!readClaudeSettingsCredentials()?.authToken ||
 * !!readClaudeSettingsCredentials()?.apiKey` but expresses intent more clearly.
 */
export function hasClaudeSettingsCredentials(): boolean {
  const creds = readClaudeSettingsCredentials();
  return !!(creds?.apiKey || creds?.authToken);
}
