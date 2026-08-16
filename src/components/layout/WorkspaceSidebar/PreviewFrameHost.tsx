'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppServerProvider } from '@/codex-web/AppServerProvider';
import { PanelContext, type PanelContextValue, type PreviewSource, type PreviewViewMode } from '@/hooks/usePanel';
import { PreviewPanel } from '@/components/layout/panels/PreviewPanel';
import { isPreviewFrameMessage, type PreviewFrameMessage } from './preview-frame-protocol';

function PreviewFrameContent() {
  const [source, setSource] = useState<PreviewSource | null>(null);
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [viewMode, setViewMode] = useState<PreviewViewMode>('rendered');

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source !== window.parent || !isPreviewFrameMessage(event.data)) return;
      const message = event.data as PreviewFrameMessage;
      if (message.type === 'preview-frame/init') {
        setSource(message.source);
        setWorkingDirectory(message.workingDirectory);
        setViewMode(message.viewMode);
      }
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'preview-frame/ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const value = useMemo<PanelContextValue>(() => ({
    chatListOpen: false, setChatListOpen: () => undefined,
    fileTreeOpen: false, setFileTreeOpen: () => undefined,
    assistantPanelOpen: false, setAssistantPanelOpen: () => undefined,
    isAssistantWorkspace: false, setIsAssistantWorkspace: () => undefined,
    currentBranch: '', gitDirtyCount: 0, currentWorktreeLabel: '', setCurrentWorktreeLabel: () => undefined,
    workingDirectory, setWorkingDirectory, sessionId: '', setSessionId: () => undefined,
    sessionTitle: '', setSessionTitle: () => undefined, streamingSessionId: '', setStreamingSessionId: () => undefined,
    pendingApprovalSessionId: '', setPendingApprovalSessionId: () => undefined,
    activeStreamingSessions: new Set(), pendingApprovalSessionIds: new Set(),
    previewSource: source, setPreviewSource: setSource,
    previewFile: source?.kind === 'file' ? source.filePath : null,
    setPreviewFile: (path) => setSource(path ? { kind: 'file', filePath: path } : null),
    previewViewMode: viewMode, setPreviewViewMode: setViewMode,
  }), [source, viewMode, workingDirectory]);

  return <PanelContext.Provider value={value}><PreviewPanel variant="sidebar" /></PanelContext.Provider>;
}

export function PreviewFrameHost() {
  return <AppServerProvider><PreviewFrameContent /></AppServerProvider>;
}
