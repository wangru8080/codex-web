/**
 * tools/grep.ts — Search file contents using ripgrep.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { execSync } from 'child_process';
import path from 'path';
import type { ToolContext } from './index';

export function createGrepTool(ctx: ToolContext) {
  return tool({
    description:
      'Search file contents for a regex pattern using ripgrep. ' +
      'Returns matching lines with file paths and line numbers. ' +
      'Supports full regex syntax. Use glob parameter to filter by file type.',
    inputSchema: z.object({
      pattern: z.string().describe('Regex pattern to search for'),
      path: z.string().optional().describe('File or directory to search in (defaults to working directory)'),
      glob: z.string().optional().describe('Glob pattern to filter files (e.g. "*.ts", "*.{js,jsx}")'),
      case_insensitive: z.boolean().optional().describe('Case insensitive search'),
      context: z.number().int().min(0).optional().describe('Lines of context around each match'),
      max_results: z.number().int().min(1).optional().describe('Maximum number of results (default 50)'),
    }),
    execute: async ({ pattern, path: searchPath, glob: globPattern, case_insensitive, context: ctxLines, max_results }) => {
      const cwd = searchPath
        ? (path.isAbsolute(searchPath) ? searchPath : path.resolve(ctx.workingDirectory, searchPath))
        : ctx.workingDirectory;

      const limit = max_results ?? 50;

      const args: string[] = [
        '--no-heading',
        '--line-number',
        '--color=never',
      ];

      if (case_insensitive) args.push('-i');
      if (ctxLines) args.push(`-C${ctxLines}`);
      if (globPattern) args.push(`--glob=${globPattern}`);

      args.push(`-m${limit * 2}`); // allow some overhead for context lines
      args.push('--', pattern, '.');

      try {
        const result = execSync(`rg ${args.join(' ')}`, {
          cwd,
          encoding: 'utf-8',
          timeout: 15_000,
          maxBuffer: 1024 * 1024,
        });

        // Trim to max_results entries
        const lines = result.trim().split('\n');
        const trimmed = lines.slice(0, limit * 3); // rough trim (context lines inflate count)

        if (trimmed.length === 0) {
          return `No matches found for pattern "${pattern}" in ${cwd}`;
        }

        return trimmed.join('\n');
      } catch (err: unknown) {
        // rg exits with code 1 when no matches found
        if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 1) {
          return `No matches found for pattern "${pattern}" in ${cwd}`;
        }
        // rg not installed — fall back to grep
        try {
          const grepArgs = ['-rn', '--include=' + (globPattern || '*')];
          if (case_insensitive) grepArgs.push('-i');
          grepArgs.push(pattern, '.');

          const result = execSync(`grep ${grepArgs.join(' ')}`, {
            cwd,
            encoding: 'utf-8',
            timeout: 15_000,
            maxBuffer: 1024 * 1024,
          });

          const lines = result.trim().split('\n').slice(0, limit);
          return lines.join('\n') || `No matches found for pattern "${pattern}"`;
        } catch {
          return `No matches found for pattern "${pattern}" in ${cwd}`;
        }
      }
    },
  });
}
