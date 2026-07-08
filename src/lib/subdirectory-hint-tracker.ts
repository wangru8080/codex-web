/**
 * subdirectory-hint-tracker.ts — Progressive subdirectory hint discovery.
 *
 * As the agent navigates into subdirectories via tool calls (Read, Bash,
 * Glob, Grep, etc.), this module discovers and loads project context files
 * (AGENTS.md, CLAUDE.md, .cursorrules) from those directories. Discovered
 * hints are appended to the tool result so the model gets relevant context
 * at the moment it starts working in a new area of the codebase.
 *
 * This complements the startup context loading in `agent-system-prompt.ts`
 * which only discovers CLAUDE.md/AGENTS.md at the cwd and its immediate
 * parent. Subdirectory hints are loaded lazily and injected into the
 * conversation **without modifying the system prompt** — this preserves
 * prompt caching, matching the upstream design in Hermes / Block goose.
 *
 * Ported from /Users/op7418/Documents/code/资料/hermes-agent-main/
 * agent/subdirectory_hints.py (lines 1-224, v0.8.0 snapshot).
 *
 * Integration status: module-only. Wire-up point is in agent-tools.ts —
 * after a tool.execute resolves, call tracker.checkToolCall(name, args)
 * and append the returned string to the tool result. This is deferred to
 * a follow-up because the integration requires touching each tool's
 * execute wrapper, which is structurally invasive; the tracker itself is
 * fully tested and ready for use.
 *
 * Reference: docs/research/hermes-agent-analysis.md §1.5, §3.3
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/** Filenames to look for in discovered subdirectories, in priority order. */
const HINT_FILENAMES = [
  'AGENTS.md',
  'agents.md',
  'CLAUDE.md',
  'claude.md',
  '.cursorrules',
] as const;

/** Maximum characters per hint file before truncation. */
const MAX_HINT_CHARS = 8_000;

/** Tool argument keys that typically contain filesystem paths. */
const PATH_ARG_KEYS = new Set<string>(['path', 'file_path', 'workdir', 'cwd']);

/** Tool names whose argument is a shell command string to be tokenized. */
const COMMAND_TOOLS = new Set<string>(['Bash']);

/**
 * How many parent directories to walk up when looking for hints.
 * Prevents scanning all the way to `/` for deeply nested paths, and caps
 * the cost of hint discovery to a small constant.
 */
const MAX_ANCESTOR_WALK = 5;

/**
 * Tracks which directories the agent has visited and loads hint files
 * on first access only.
 *
 * Usage:
 * ```ts
 * const tracker = new SubdirectoryHintTracker('/path/to/project');
 * const hints = tracker.checkToolCall('Read', { path: 'backend/src/main.ts' });
 * if (hints) {
 *   toolResult += hints; // append to the tool result string
 * }
 * ```
 */
export class SubdirectoryHintTracker {
  private readonly workingDir: string;
  private readonly loadedDirs: Set<string>;

  constructor(workingDir?: string) {
    const base = workingDir ?? process.cwd();
    // Resolve to an absolute, normalized form. We avoid fs.realpath here
    // because the working dir should exist at construction time, but if
    // resolution fails we fall back to the input string to stay defensive.
    try {
      this.workingDir = path.resolve(base);
    } catch {
      this.workingDir = base;
    }
    this.loadedDirs = new Set<string>();
    // Pre-mark the working dir as loaded — startup context already covers it.
    this.loadedDirs.add(this.workingDir);
  }

  /**
   * Check tool call arguments for new directories and load any hint files.
   *
   * @param toolName The name of the tool (e.g. 'Read', 'Bash', 'Glob')
   * @param toolArgs The arguments passed to the tool
   * @returns Formatted hint text to append to the tool result, or null if
   *   no new directories were discovered or no hint files were found.
   */
  checkToolCall(toolName: string, toolArgs: Record<string, unknown>): string | null {
    const dirs = this.extractDirectories(toolName, toolArgs);
    if (dirs.length === 0) return null;

    const allHints: string[] = [];
    for (const dir of dirs) {
      const hints = this.loadHintsForDirectory(dir);
      if (hints) allHints.push(hints);
    }

    if (allHints.length === 0) return null;
    return '\n\n' + allHints.join('\n\n');
  }

  /** Extract directory paths from tool call arguments. */
  private extractDirectories(toolName: string, args: Record<string, unknown>): string[] {
    const candidates = new Set<string>();

    // 1. Direct path arguments.
    for (const key of PATH_ARG_KEYS) {
      const val = args[key];
      if (typeof val === 'string' && val.trim() !== '') {
        this.addPathCandidate(val, candidates);
      }
    }

    // 2. Shell commands — extract path-like tokens.
    if (COMMAND_TOOLS.has(toolName)) {
      const cmd = args.command;
      if (typeof cmd === 'string') {
        this.extractPathsFromCommand(cmd, candidates);
      }
    }

    return [...candidates];
  }

  /**
   * Resolve a raw path and add its directory + ancestors to candidates.
   *
   * Walks up from the resolved directory toward the filesystem root,
   * stopping at the first directory already in loadedDirs (or after
   * MAX_ANCESTOR_WALK levels). This ensures that reading
   * `project/src/main.py` discovers `project/AGENTS.md` even when
   * `project/src/` has no hint files of its own — matching Hermes'
   * `_add_path_candidate` behavior.
   */
  private addPathCandidate(rawPath: string, candidates: Set<string>): void {
    try {
      // Expand leading ~ to home directory.
      let p = rawPath;
      if (p.startsWith('~')) {
        p = path.join(os.homedir(), p.slice(1));
      }

      // Resolve relative paths against the working directory.
      if (!path.isAbsolute(p)) {
        p = path.resolve(this.workingDir, p);
      } else {
        p = path.normalize(p);
      }

      // If the resolved path points at a file (has an extension or exists
      // as a file on disk), use its parent directory.
      if (path.extname(p) || this.isFile(p)) {
        p = path.dirname(p);
      }

      // Walk up ancestors — stop at already-loaded dir or filesystem root.
      for (let i = 0; i < MAX_ANCESTOR_WALK; i++) {
        if (this.loadedDirs.has(p)) break;
        if (this.isValidSubdir(p)) {
          candidates.add(p);
        }
        const parent = path.dirname(p);
        if (parent === p) break; // hit the filesystem root
        p = parent;
      }
    } catch {
      // Defensive: any path resolution error just skips this candidate.
    }
  }

  /** True when path exists and is a file. */
  private isFile(p: string): boolean {
    try {
      const stat = fs.statSync(p);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  /** True when path is a directory and is not already loaded. */
  private isValidSubdir(p: string): boolean {
    if (this.loadedDirs.has(p)) return false;
    try {
      const stat = fs.statSync(p);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Load hint files from a directory. Returns formatted text with section
   * headers for each file found, or null if no hint files were readable.
   *
   * Matches Hermes' `_load_hints_for_directory`: first file match per
   * directory wins, content truncated to MAX_HINT_CHARS, loaded_dirs
   * marked before reading (so failed reads don't cause retries).
   */
  private loadHintsForDirectory(directory: string): string | null {
    // Mark loaded BEFORE reading so failures don't cause repeated attempts.
    this.loadedDirs.add(directory);

    let foundHint: { relPath: string; content: string } | null = null;

    for (const filename of HINT_FILENAMES) {
      const hintPath = path.join(directory, filename);

      if (!this.isFile(hintPath)) continue;

      try {
        let content = fs.readFileSync(hintPath, 'utf-8').trim();
        if (!content) continue;

        if (content.length > MAX_HINT_CHARS) {
          const truncated = content.slice(0, MAX_HINT_CHARS);
          content = `${truncated}\n\n[...truncated ${filename}: ${content.length.toLocaleString()} chars total]`;
        }

        // Best-effort relative path for display.
        let relPath = hintPath;
        if (hintPath.startsWith(this.workingDir + path.sep)) {
          relPath = path.relative(this.workingDir, hintPath);
        } else if (hintPath.startsWith(os.homedir() + path.sep)) {
          relPath = '~/' + path.relative(os.homedir(), hintPath);
        }

        foundHint = { relPath, content };
        // First match per directory wins — break immediately.
        break;
      } catch {
        // Read error — try next filename.
        continue;
      }
    }

    if (!foundHint) return null;

    return `[Subdirectory context discovered: ${foundHint.relPath}]\n${foundHint.content}`;
  }

  /**
   * Extract path-like tokens from a shell command string.
   *
   * Tokenizer is intentionally simple: splits on unquoted whitespace and
   * strips outermost quotes. This is NOT a full shell parser — quoted
   * strings containing spaces work, but complex constructs (backticks,
   * here-docs, variable substitution) are treated conservatively.
   * Matches Hermes' `_extract_paths_from_command` intent.
   */
  private extractPathsFromCommand(cmd: string, candidates: Set<string>): void {
    const tokens = tokenizeShellCommand(cmd);
    for (const token of tokens) {
      // Skip flags.
      if (token.startsWith('-')) continue;
      // Must look like a path (contains / or .).
      if (!token.includes('/') && !token.includes('.')) continue;
      // Skip URLs / git SSH refs.
      if (
        token.startsWith('http://') ||
        token.startsWith('https://') ||
        token.startsWith('git@')
      ) {
        continue;
      }
      this.addPathCandidate(token, candidates);
    }
  }
}

/**
 * Simple shell-style tokenizer. Exported for testing.
 *
 * Splits on unquoted whitespace, honors single and double quotes.
 * Does NOT handle:
 *   - escape sequences (\\, \n)
 *   - variable substitution ($VAR, ${VAR})
 *   - command substitution ($(cmd), `cmd`)
 *   - here-docs
 *
 * These limitations are acceptable for path extraction because the
 * result is only used as candidate paths, and any bad token is filtered
 * out by the `has / or .` + URL checks in extractPathsFromCommand.
 */
export function tokenizeShellCommand(cmd: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch as '"' | "'";
    } else if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current !== '') tokens.push(current);
  return tokens;
}
