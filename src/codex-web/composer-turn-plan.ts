import type { MessageContentBlock } from '@/types';

import type { AppServerTurnState } from './turn-reducer';

export type ComposerTurnPlan = Extract<MessageContentBlock, { type: 'codex_updated_plan' }>;

export function deriveComposerTurnPlan(turn: AppServerTurnState | null): ComposerTurnPlan | null {
  if (!turn || turn.status !== 'running') return null;

  const plan = turn.planBlocks.findLast(
    (block): block is ComposerTurnPlan => block.type === 'codex_updated_plan',
  );
  if (!plan || plan.steps.length === 0 || plan.steps.every((step) => step.status === 'completed')) {
    return null;
  }

  return plan;
}
