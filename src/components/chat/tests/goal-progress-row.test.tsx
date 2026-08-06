import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ThreadGoal } from '@/codex/protocol/generated/v2/ThreadGoal';
import type { ThreadGoalStatus } from '@/codex/protocol/generated/v2/ThreadGoalStatus';

import { GoalProgressRow } from '../GoalProgressRow';

describe('GoalProgressRow', () => {
  it.each([
    ['active', '进行中的目标', '暂停目标'],
    ['paused', '已暂停的目标', '恢复目标'],
    ['blocked', '已暂停的目标', '恢复目标'],
    ['usageLimited', '已暂停的目标', '恢复目标'],
    ['budgetLimited', '未完成的目标', null],
    ['complete', '已完成的目标', null],
  ] satisfies Array<[ThreadGoalStatus, string, string | null]>)('渲染 %s 状态及可用操作', (status, label, action) => {
    const html = renderToStaticMarkup(
      <GoalProgressRow
        goal={goal(status)}
        sourceBreadcrumb="app-server.thread/goal/updated"
        onStatusChange={() => undefined}
        onEdit={() => undefined}
        onClear={() => undefined}
      />,
    );

    expect(html).toContain(`data-goal-status="${status}"`);
    expect(html).toContain(label);
    expect(html).toContain('验证异常目标状态');
    expect(html).toContain('aria-label="编辑目标"');
    expect(html).toContain('aria-label="清除目标"');
    if (action) expect(html).toContain(`aria-label="${action}"`);
    else {
      expect(html).not.toContain('aria-label="暂停目标"');
      expect(html).not.toContain('aria-label="恢复目标"');
    }
  });
});

function goal(status: ThreadGoalStatus): ThreadGoal {
  return {
    threadId: 'thread-1',
    objective: '验证异常目标状态',
    status,
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 42,
    createdAt: 1,
    updatedAt: 1,
  };
}
