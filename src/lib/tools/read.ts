/**
 * tools/read.ts — Read file contents with line numbers.
 */

import { tool } from 'ai';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import type { ToolContext } from './index';

export function createReadTool(ctx: ToolContext) {
  return tool({
    description:
      'Read the contents of a file. Output includes line numbers (line_number\\tcontent). ' +
      'Use offset and limit to read specific ranges of large files.',
    inputSchema: z.object({
      file_path: z.string().describe('Absolute path to the file to read'),
      offset: z.number().int().min(0).optional().describe('Line number to start reading from (0-based)'),
      limit: z.number().int().min(1).optional().describe('Maximum number of lines to read'),
    }),
    execute: async ({ file_path, offset, limit }) => {
      const resolved = path.isAbsolute(file_path) ? file_path : path.resolve(ctx.workingDirectory, file_path);

      if (!fs.existsSync(resolved)) {
        return `Error: File not found: ${resolved}`;
      }

      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        return `Error: ${resolved} is a directory, not a file. Use Glob or Bash to list directory contents.`;
      }

      // Size guard (10MB)
      if (stat.size > 10 * 1024 * 1024) {
        return `Error: File is too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Use offset and limit to read portions.`;
      }

      const content = fs.readFileSync(resolved, 'utf-8');
      const lines = content.split('\n');

      const startLine = offset ?? 0;
      const maxLines = limit ?? 2000;
      const endLine = Math.min(startLine + maxLines, lines.length);
      const slice = lines.slice(startLine, endLine);

      const numbered = slice.map((line, i) => `${startLine + i + 1}\t${line}`).join('\n');

      const header = endLine < lines.length
        ? `[Showing lines ${startLine + 1}-${endLine} of ${lines.length}]\n`
        : '';

      return header + numbered;
    },
  });
}
