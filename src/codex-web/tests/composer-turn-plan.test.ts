import { describe, expect, it } from 'vitest';

import { deriveComposerTurnPlan } from '../composer-turn-plan';
import { createAcceptedTurnState } from '../turn-reducer';

const updatedPlan = {
  type: 'codex_updated_plan' as const,
  explanation: null,
  sourceBreadcrumb: 'app-server.turn/plan/updated' as const,
  progress: { completed: 1, total: 3 },
  steps: [
    { step: '完成数据接线', status: 'completed' as const },
    { step: '实现任务 UI', status: 'inProgress' as const },
    { step: '运行验证', status: 'pending' as const },
  ],
};

describe('deriveComposerTurnPlan', () => {
  it('返回运行中 Turn 的最新 Updated Plan', () => {
    const turn = createAcceptedTurnState('thread-1', 'turn-1');
    turn.planBlocks = [updatedPlan, { ...updatedPlan, progress: { completed: 2, total: 3 } }];

    expect(deriveComposerTurnPlan(turn)?.progress).toEqual({ completed: 2, total: 3 });
  });

  it('普通消息、Proposed Plan 和空计划不显示任务 UI', () => {
    const turn = createAcceptedTurnState('thread-1', 'turn-1');
    expect(deriveComposerTurnPlan(turn)).toBeNull();

    turn.planBlocks = [{
      type: 'codex_proposed_plan',
      text: '先讨论方案',
      sourceBreadcrumb: 'app-server.item/completed',
    }];
    expect(deriveComposerTurnPlan(turn)).toBeNull();

    turn.planBlocks = [{ ...updatedPlan, steps: [], progress: null }];
    expect(deriveComposerTurnPlan(turn)).toBeNull();
  });

  it('全部步骤完成或 Turn 进入终态后自动隐藏', () => {
    const turn = createAcceptedTurnState('thread-1', 'turn-1');
    turn.planBlocks = [{
      ...updatedPlan,
      progress: { completed: 3, total: 3 },
      steps: updatedPlan.steps.map((step) => ({ ...step, status: 'completed' as const })),
    }];
    expect(deriveComposerTurnPlan(turn)).toBeNull();

    turn.planBlocks = [updatedPlan];
    turn.status = 'interrupted';
    expect(deriveComposerTurnPlan(turn)).toBeNull();
  });
});
