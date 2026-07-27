import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('输入框任务进度 UI 接线', () => {
  const chatView = read('src/components/chat/ChatView.tsx');
  const messageInput = read('src/components/chat/MessageInput.tsx');
  const composerPlan = read('src/components/chat/ComposerTurnPlan.tsx');
  const messageItem = read('src/components/chat/MessageItem.tsx');
  const streamingMessage = read('src/components/chat/StreamingMessage.tsx');

  it('从活动 app-server Turn 派生真实任务计划并传入输入框', () => {
    expect(chatView).toContain('deriveComposerTurnPlan(presentedAppServerTurn ?? null)');
    expect(chatView).toContain('turnPlan={appServerSend ? composerTurnPlan : null}');
    expect(messageInput).toContain('plan={turnPlan ?? null}');
    expect(composerPlan).toContain('data-source-breadcrumb={plan.sourceBreadcrumb}');
  });

  it('文件变更在左、任务进度在右，共用输入框上方活动条', () => {
    expect(messageInput).toContain('data-testid="composer-activity-bar"');
    expect(messageInput.indexOf('<ComposerFileChanges')).toBeLessThan(
      messageInput.indexOf('<ComposerTurnPlan'),
    );
    expect(composerPlan).toContain('data-testid="composer-turn-plan"');
    expect(composerPlan).toContain('data-testid="composer-turn-plan-panel"');
    expect(messageInput).toContain("setComposerActivityPanel(expanded ? 'files' : null)");
    expect(messageInput).toContain("setComposerActivityPanel(expanded ? 'tasks' : null)");
    expect(messageInput).toContain("variant={standaloneTurnPlan ? 'standalone' : 'compact'}");
    expect(composerPlan).toContain("variant: 'standalone' | 'compact'");
  });

  it('仅任务时使用可折叠独立面板，文件出现时自动收成胶囊', () => {
    expect(composerPlan).toContain('data-testid="composer-turn-plan-standalone"');
    expect(composerPlan).toContain("t('composer.turnPlan.summary'");
    expect(messageInput).toContain("setComposerActivityPanel(standaloneTurnPlan ? 'tasks' : null)");
    expect(messageInput).toContain('data-variant={standaloneTurnPlan');
  });

  it('执行任务只在输入框浮层展示，不在实时或历史消息中重复展示', () => {
    expect(composerPlan).toContain('<TurnTaskChecklist steps={plan.steps} compact />');
    expect(messageItem).not.toContain('UpdatedPlanMessageBlock');
    expect(streamingMessage).not.toContain('UpdatedPlanMessageBlock');
  });
});
