'use client';

import { useMemo } from 'react';

import { ChatView } from '@/components/chat/ChatView';
import { Button } from '@/components/ui/button';
import { ChatCircle, Plus, SpinnerGap } from '@/components/ui/icon';
import { firstApproval, approvalRequestMatchesThread } from '@/codex-web/approval-queue-adapter';
import { useAppServerActions, useAppServerSelector } from '@/codex-web/AppServerProvider';
import { permissionProfileFromRuntimeSettings } from '@/codex-web/thread-permission-settings';
import { usePanel } from '@/hooks/usePanel';
import { useTranslation } from '@/hooks/useTranslation';
import { useWorkspaceSidebar } from '@/hooks/useWorkspaceSidebar';
import type { TranslationKey } from '@/i18n';

export function SideChatPanel({ sideChatId }: { sideChatId: string }) {
  const { sessionId: parentThreadId, workingDirectory } = usePanel();
  const { sideChats, retrySideChat } = useWorkspaceSidebar();
  const { t } = useTranslation();
  const sideChat = sideChats[sideChatId];
  const childThreadId = sideChat?.threadId ?? null;
  const connection = useAppServerSelector((state) => state.connection.data);
  const activeTurn = useAppServerSelector((state) => childThreadId
    ? state.activeTurnsByThreadId[childThreadId]?.data ?? null
    : null);
  const pendingApprovals = useAppServerSelector((state) => state.pendingApprovals);
  const settings = useAppServerSelector((state) => childThreadId
    ? state.threadSettingsByThreadId[childThreadId]?.data
      ?? state.threadSettingsByThreadId[parentThreadId]?.data
      ?? null
    : state.threadSettingsByThreadId[parentThreadId]?.data ?? null);
  const tokenUsage = useAppServerSelector((state) => childThreadId
    ? state.threadTokenUsageByThreadId[childThreadId]?.data ?? null
    : null);
  const models = useAppServerSelector((state) => state.models);
  const {
    sendTurnInThread,
    interruptTurn,
    respondToServerRequest,
    updateThreadPermissions,
    updateThreadModelSettings,
  } = useAppServerActions();

  const defaultModel = useMemo(() =>
    models?.data.data.find((model) => !model.hidden && model.isDefault)?.id
      ?? models?.data.data.find((model) => !model.hidden)?.id
      ?? '',
  [models]);
  const model = settings?.model || defaultModel;
  const permissionProfile = settings
    ? permissionProfileFromRuntimeSettings(settings)
    : 'request_approval';
  const pendingRequest = childThreadId
    ? firstApproval(pendingApprovals, (approval) => approvalRequestMatchesThread(approval, [childThreadId]))
    : null;

  if (sideChat?.status === 'creating' || (!sideChat && connection !== 'failed')) {
    return (
      <div className="flex h-full w-full items-center justify-center" role="status">
        <SpinnerGap className="animate-spin text-muted-foreground" size={22} />
        <span className="sr-only">{t('workspaceSidebar.sideChat.creating' as TranslationKey)}</span>
      </div>
    );
  }

  if (sideChat?.status === 'error' || !childThreadId) {
    return (
      <div className="flex h-full w-full items-center justify-center px-8 text-center">
        <div className="max-w-xs">
          <SideChatMark />
          <h2 className="mt-4 text-base font-semibold text-foreground">
            {t('workspaceSidebar.tool.sideChat' as TranslationKey)}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {sideChat?.error || t('workspaceSidebar.sideChat.unavailable' as TranslationKey)}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => retrySideChat(sideChatId)}
          >
            {t('workspaceSidebar.sideChat.retry' as TranslationKey)}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 w-full" data-side-chat data-source-breadcrumb="app-server.thread/fork:ephemeral">
      <ChatView
        key={childThreadId}
        sessionId={childThreadId}
        initialMessages={[]}
        modelName={model}
        providerId="codex_account"
        initialEffort={settings?.effort ?? null}
        initialPermissionProfile={permissionProfile}
        initialMode="code"
        workingDirectory={workingDirectory}
        appServerThreadId={childThreadId}
        appServerTurn={activeTurn}
        appServerRequest={pendingRequest}
        appServerTokenUsage={tokenUsage}
        emptyState={<SideChatEmptyState />}
        onAppServerRequestResponse={(input) => respondToServerRequest(input, pendingRequest?.requestId)}
        onAppServerPermissionChange={async (next) => {
          await updateThreadPermissions({
            threadId: childThreadId,
            cwd: workingDirectory,
            permissionProfile: next,
          });
        }}
        onAppServerModelChange={(next) => updateThreadModelSettings({ threadId: childThreadId, model: next }).then(() => undefined)}
        onAppServerEffortChange={(next) => updateThreadModelSettings({ threadId: childThreadId, effort: next }).then(() => undefined)}
        appServerInterrupt={activeTurn
          ? () => interruptTurn({ threadId: childThreadId, turnId: activeTurn.turnId })
          : undefined}
        appServerSend={({ content, files, cwd, model: nextModel, effort, mode, permissionProfile: nextPermission, skills, onAccepted }) =>
          sendTurnInThread({
            threadId: childThreadId,
            content,
            files,
            cwd: cwd || workingDirectory,
            model: nextModel || model,
            effort,
            mode,
            permissionProfile: nextPermission,
            skills,
            onAccepted,
          })
        }
      />
    </div>
  );
}

function SideChatEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="text-center">
      <SideChatMark />
      <h2 className="mt-4 text-lg font-semibold text-foreground">
        {t('workspaceSidebar.tool.sideChat' as TranslationKey)}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t('workspaceSidebar.sideChat.description' as TranslationKey)}
      </p>
    </div>
  );
}

function SideChatMark() {
  return (
    <span className="relative mx-auto block h-9 w-9 text-muted-foreground" aria-hidden>
      <ChatCircle size={36} weight="regular" />
      <Plus size={16} weight="bold" className="absolute left-2.5 top-2" />
    </span>
  );
}
