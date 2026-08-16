import type { PreviewSource, PreviewViewMode } from '@/hooks/usePanel';

export type PreviewFrameMessage =
  | { type: 'preview-frame/ready' }
  | { type: 'preview-frame/init'; source: PreviewSource | null; workingDirectory: string; viewMode: PreviewViewMode };

export function isPreviewFrameMessage(value: unknown): value is PreviewFrameMessage {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return type === 'preview-frame/ready' || type === 'preview-frame/init';
}
