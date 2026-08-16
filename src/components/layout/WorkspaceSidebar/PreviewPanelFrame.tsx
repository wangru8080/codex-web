'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePanel } from '@/hooks/usePanel';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

export function PreviewPanelFrame() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const { previewSource, workingDirectory, previewViewMode } = usePanel();
  const { t } = useTranslation();
  const send = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({
      type: 'preview-frame/init',
      source: previewSource,
      workingDirectory,
      viewMode: previewViewMode,
    }, window.location.origin);
  }, [previewSource, previewViewMode, workingDirectory]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
      if ((event.data as { type?: unknown })?.type === 'preview-frame/ready') send();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [send]);

  useEffect(() => {
    send();
  }, [send]);

  return <iframe
    ref={frameRef}
    title={t('workspaceSidebar.tab.preview' as TranslationKey)}
    src="/workspace/preview"
    className="h-full w-full border-0"
    onLoad={send}
  />;
}
