import { isImageFile } from '@/types';
import type { FileAttachment } from '@/types';
import type { CodexTurnInputBlock } from './types';

/**
 * Build the Codex app-server `turn/start` input[] from the prompt + attachments.
 *
 * #632 / Phase 2 #3 — before this, runtime.ts sent `[{ type:'text', text }]`
 * only, so image attachments (passed all the way to the runtime via
 * `runtimeOptions.files`) were silently dropped: Codex received text only.
 *
 * Image wire format confirmed by POC (docs/research/codex-image-input-poc/
 * FINDINGS.md) against a real codex app-server:
 *   - a persisted local file (`filePath`) → `{ type:'localImage', path }`
 *     — preferred: the send path writes uploads to disk and clears the base64
 *       `data` (route.ts), and a local path avoids a multi-MB data URL.
 *   - an in-memory image (base64 `data`, no `filePath`) → `{ type:'image',
 *     url:'data:<mime>;base64,...' }` — fallback for paths that bypass disk.
 *
 * Only image/* attachments are wired (the composer image path is what this
 * issue covers; the Codex turn input has no generic file/document block, so
 * non-image files are skipped here — unchanged behavior). Text always leads.
 *
 * Pure + dependency-light so it unit-tests without the codex spawn graph.
 */
export function buildCodexTurnInput(
  prompt: string,
  files?: readonly FileAttachment[],
): CodexTurnInputBlock[] {
  const blocks: CodexTurnInputBlock[] = [{ type: 'text', text: prompt }];
  for (const f of files ?? []) {
    if (!isImageFile(f.type)) continue;
    if (f.filePath) {
      blocks.push({ type: 'localImage', path: f.filePath });
    } else if (f.data) {
      blocks.push({ type: 'image', url: `data:${f.type};base64,${f.data}` });
    }
    // image with neither a path nor data → nothing to send; skip (don't emit
    // an empty block the server would reject).
  }
  return blocks;
}
