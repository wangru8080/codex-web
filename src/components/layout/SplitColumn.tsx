'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from '@/components/ui/icon';
import type { Message, PermissionProfile } from '@/types';
import type { ReasoningEffort } from '@/codex/protocol/generated/ReasoningEffort';
import type { Thread } from '@/codex/protocol/generated/v2/Thread';
import { ChatView } from '@/components/chat/ChatView';
import { Button } from '@/components/ui/button';
import { usePanel } from '@/hooks/usePanel';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppServerActions, useAppServerSelector } from '@/codex-web/AppServerProvider';
import { firstApproval, approvalRequestMatchesThread } from '@/codex-web/approval-queue-adapter';
import { threadToChatSession, threadToMessages } from '@/codex-web/thread-history-adapter';

interface SplitColumnProps {
  sessionId: string;
  isActive: boolean;
  onClose: () => void;
  onFocus: () => void;
}

export function SplitColumn({ sessionId, isActive, onClose, onFocus }: SplitColumnProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState('');
  const [projectName, setProjectName] = useState('');
  const [workingDirectory, setColumnWorkingDirectory] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState<ReasoningEffort | null>(null);
  const [permissionProfile, setPermissionProfile] = useState<PermissionProfile>('request_approval');
  const [mode, setMode] = useState<'code' | 'plan'>('code');
  const { setWorkingDirectory, setSessionId, setSessionTitle: setPanelSessionTitle } = usePanel();
  const { t } = useTranslation();
  const connectionData = useAppServerSelector((state) => state.connection.data);
  const activeTurn = useAppServerSelector((state) => state.activeTurnsByThreadId[sessionId]?.data ?? null);
  const pendingApprovals = useAppServerSelector((state) => state.pendingApprovals);
  const goal = useAppServerSelector((state) => state.goalsByThreadId[sessionId] ?? null);
  const tokenUsage = useAppServerSelector((state) => state.threadTokenUsageByThreadId[sessionId]?.data ?? null);
  const models = useAppServerSelector((state) => state.models);
  const {
    readThread,
    resumeThread,
    getThreadGoal,
    sendTurnInThread,
    interruptTurn,
    respondToServerRequest,
    updateThreadPermissions,
    updateThreadModelSettings,
  } = useAppServerActions();

  useEffect(() => {
    if (connectionData !== 'connected') {
      if (connectionData === 'failed') {
        setError('Codex app-server connection failed');
        setLoading(false);
      }
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void readThread(sessionId, { includeTurns: true })
      .then(async (response) => {
        if (cancelled) return;
        setThread(response.thread);
        const session = threadToChatSession(response.thread);
        const history = threadToMessages(response.thread);
        setMessages(history.messages);
        setSessionTitle(session.title || t('chat.newConversation'));
        setProjectName(session.project_name || '');
        setColumnWorkingDirectory(session.working_directory || '');
        setPermissionProfile(session.permission_profile || 'request_approval');
        setMode((session.mode as 'code' | 'plan') || 'code');

        const resumed = await resumeThread({ threadId: sessionId });
        if (cancelled) return;
        await Promise.allSettled(
          Array.from(new Set([sessionId, resumed.thread.id])).map((threadId) => getThreadGoal(threadId)),
        );
        if (cancelled) return;
        setModel(resumed.model || '');
        setColumnWorkingDirectory(resumed.cwd || session.working_directory || '');
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [connectionData, readThread, resumeThread, getThreadGoal, sessionId, t]);

  useEffect(() => {
    if (!isActive) return;
    setWorkingDirectory(workingDirectory);
    setSessionId(sessionId);
    if (sessionTitle) setPanelSessionTitle(sessionTitle);
  }, [isActive, sessionId, sessionTitle, setPanelSessionTitle, setSessionId, setWorkingDirectory, workingDirectory]);

  const handleClose = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    onClose();
  }, [onClose]);

  const pendingRequest = firstApproval(pendingApprovals, (approval) =>
    approvalRequestMatchesThread(approval, [sessionId]),
  );
  const defaultModel = useMemo(() =>
    models?.data.data.find((item) => !item.hidden && item.isDefault)?.id
      || models?.data.data.find((item) => !item.hidden)?.id
      || '',
  [models]);

  if (loading) {
    return <SplitColumnFrame isActive={isActive} onFocus={onFocus}><div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" /></SplitColumnFrame>;
  }
  if (error || !thread) {
    return <SplitColumnFrame isActive={isActive} onFocus={onFocus}><p className="text-sm text-destructive">{error || 'Session not found'}</p></SplitColumnFrame>;
  }

  return (
    <div
      className={cn('flex flex-1 min-w-0 flex-col overflow-hidden rounded-md border-2 transition-colors', isActive ? 'border-primary' : 'border-transparent')}
      onClick={onFocus}
    >
      <div className="flex h-9 shrink-0 items-center justify-between px-3 border-b bg-muted/30">
        <div className="flex items-center gap-1.5 min-w-0">
          {projectName && <><span className="text-[11px] text-muted-foreground shrink-0">{projectName}</span><span className="text-[11px] text-muted-foreground shrink-0">/</span></>}
          <span className="text-[11px] font-medium truncate">{sessionTitle}</span>
        </div>
        <Button variant="ghost" size="icon-xs" className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground" onClick={handleClose}>
          <X className="h-3 w-3" />
          <span className="sr-only">{t('split.closeSplit')}</span>
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChatView
          key={sessionId}
          sessionId={sessionId}
          initialMessages={messages}
          modelName={model || defaultModel}
          providerId="codex_account"
          initialEffort={effort}
          initialPermissionProfile={permissionProfile}
          initialMode={mode}
          workingDirectory={workingDirectory}
          projectName={projectName}
          appServerThreadId={sessionId}
          appServerTurn={activeTurn}
          appServerRequest={pendingRequest}
          appServerGoal={goal}
          appServerTokenUsage={tokenUsage}
          onAppServerRequestResponse={(input) => respondToServerRequest(input, pendingRequest?.requestId)}
          onAppServerPermissionChange={async (next) => {
            await updateThreadPermissions({ threadId: sessionId, cwd: workingDirectory, permissionProfile: next });
            setPermissionProfile(next);
          }}
          onAppServerModelChange={async (next) => {
            await updateThreadModelSettings({ threadId: sessionId, model: next });
            setModel(next);
          }}
          onAppServerEffortChange={async (next) => {
            await updateThreadModelSettings({ threadId: sessionId, effort: next });
            setEffort(next);
          }}
          appServerInterrupt={activeTurn ? () => interruptTurn({ threadId: sessionId, turnId: activeTurn.turnId }) : undefined}
          appServerSend={({ content, files, cwd, model: nextModel, effort: nextEffort, mode: nextMode, permissionProfile: nextPermission, onAccepted }) =>
            sendTurnInThread({
              threadId: sessionId,
              content,
              files,
              cwd: cwd || workingDirectory,
              model: nextModel || model || defaultModel,
              effort: nextEffort,
              mode: nextMode,
              permissionProfile: nextPermission,
              onAccepted,
            })
          }
        />
      </div>
    </div>
  );
}

function SplitColumnFrame({ isActive, onFocus, children }: { isActive: boolean; onFocus: () => void; children: React.ReactNode }) {
  return (
    <div className={cn('flex flex-1 min-w-0 items-center justify-center overflow-hidden rounded-md border-2', isActive ? 'border-primary' : 'border-transparent')} onClick={onFocus}>
      {children}
    </div>
  );
}
