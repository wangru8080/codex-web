/**
 * tools/bash.ts — Execute shell commands.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { spawn } from 'child_process';
import type { ToolContext } from './index';

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB
const DEFAULT_TIMEOUT_MS = 120_000;   // 2 minutes

export function createBashTool(ctx: ToolContext) {
  return tool({
    description:
      'Execute a bash command and return its output (stdout + stderr combined). ' +
      'The command runs in the working directory. Use for system operations, ' +
      'running tests, installing packages, git commands, etc. ' +
      'Long-running commands are automatically killed after the timeout.',
    inputSchema: z.object({
      command: z.string().describe('The bash command to execute'),
      timeout: z.number().int().positive().optional()
        .describe('Timeout in milliseconds (default 120000)'),
    }),
    execute: async ({ command, timeout }, { abortSignal }) => {
      const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;

      return new Promise<string>((resolve) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let truncated = false;

        const proc = spawn('bash', ['-c', command], {
          cwd: ctx.workingDirectory,
          env: { ...process.env, TERM: 'dumb' },
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs,
        });

        const collect = (data: Buffer) => {
          if (truncated) return;
          totalBytes += data.length;
          if (totalBytes > MAX_OUTPUT_BYTES) {
            truncated = true;
            chunks.push(data.subarray(0, MAX_OUTPUT_BYTES - (totalBytes - data.length)));
          } else {
            chunks.push(data);
          }
        };

        proc.stdout?.on('data', collect);
        proc.stderr?.on('data', collect);

        // Handle abort
        const onAbort = () => {
          proc.kill('SIGTERM');
          setTimeout(() => proc.kill('SIGKILL'), 3000);
        };
        abortSignal?.addEventListener('abort', onAbort, { once: true });

        proc.on('close', (code, signal) => {
          abortSignal?.removeEventListener('abort', onAbort);

          let output = Buffer.concat(chunks).toString('utf-8');
          if (truncated) {
            output += '\n\n[Output truncated — exceeded 1MB limit]';
          }

          if (signal === 'SIGTERM' || signal === 'SIGKILL') {
            output += `\n\n[Process killed: ${signal}]`;
          }

          if (code !== null && code !== 0) {
            output += `\n\n[Exit code: ${code}]`;
          }

          resolve(output || '(no output)');
        });

        proc.on('error', (err) => {
          resolve(`Error executing command: ${err.message}`);
        });
      });
    },
  });
}
