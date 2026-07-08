/**
 * builtin-tools/widget-guidelines.ts — Widget design guidelines tool (Native Runtime).
 *
 * Phase 5c slice 7 (2026-05-16) — system prompt is now re-exported
 * from the canonical source in `src/lib/widget-guidelines.ts`
 * instead of carrying a separate (drifted) copy. Pre-fix this file
 * had a 14-line abridged prompt that didn't mention the
 * WIDGET_WIRE_FORMAT_SPEC + image-gen rule slice 6 added, so the
 * Native Runtime path silently disagreed with the ClaudeCode SDK
 * path on what a valid widget looks like. The Harness Capability
 * Contract (`src/lib/harness/capability-contract.ts`) declares
 * `src/lib/widget-guidelines.ts` as the authoritative prompt
 * source — this file consumes it.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { WIDGET_SYSTEM_PROMPT as CANONICAL_WIDGET_SYSTEM_PROMPT } from '@/lib/widget-guidelines';

export const WIDGET_SYSTEM_PROMPT = CANONICAL_WIDGET_SYSTEM_PROMPT;

export function createWidgetGuidelinesTools() {
  return {
    codepilot_load_widget_guidelines: tool({
      description: 'Load detailed design guidelines for generating visual widgets. Call this before creating complex visualizations.',
      inputSchema: z.object({
        modules: z.array(z.enum(['interactive', 'chart', 'mockup', 'art', 'diagram']))
          .describe('Which guideline modules to load'),
      }),
      execute: async ({ modules }) => {
        try {
          // Dynamic import to avoid circular deps
          const { getGuidelines } = await import('@/lib/widget-guidelines');
          return getGuidelines(modules);
        } catch (err) {
          return `Failed to load widget guidelines: ${err instanceof Error ? err.message : 'unknown'}`;
        }
      },
    }),
  };
}
