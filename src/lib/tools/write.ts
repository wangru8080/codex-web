/**
 * tools/write.ts — Write/create files.
 */

import { tool } from 'ai';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { recordFileModification } from '../file-checkpoint';
import type { ToolContext } from './index';

export function createWriteTool(ctx: ToolContext) {
  return tool({
    description:
      'Write content to a file. Creates the file and any parent directories if they don\'t exist. ' +
      'Overwrites the file if it already exists. Use Edit for modifying existing files.',
    inputSchema: z.object({
      file_path: z.string().describe('Absolute path to the file to write'),
      content: z.string().describe('The full content to write to the file'),
    }),
    execute: async ({ file_path, content }) => {
      const resolved = path.isAbsolute(file_path) ? file_path : path.resolve(ctx.workingDirectory, file_path);

      // Create parent directories
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(resolved, content, 'utf-8');
      recordFileModification(ctx.sessionId || '', path.relative(ctx.workingDirectory, resolved));

      const lines = content.split('\n').length;
      return `Successfully wrote ${lines} lines to ${resolved}`;
    },
  });
}
