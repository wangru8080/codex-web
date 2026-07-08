/**
 * `codepilot:file-changed` — unified frontend notification channel for
 * "a file on disk was just rewritten." Phase 4 Phase 1 of the Markdown /
 * Artifact closure.
 *
 * Producers:
 *  - stream-session-manager (on tool_result for Write / Edit / NotebookEdit)
 *  - PreviewPanel save-on-edit handler (after a successful PUT)
 *  - Any future surface that writes files via the renderer process
 *
 * Consumers:
 *  - PreviewPanel — refetches the active file when paths include
 *    filePath AND the editor buffer is clean. If the buffer is dirty,
 *    the panel surfaces a conflict banner instead of clobbering edits.
 *
 * One channel for everything keeps surfaces consistent: a save in the
 * preview panel triggers the same listener path as an AI-driven edit,
 * so we don't end up with two parallel refresh stories that drift apart.
 */

export const FILE_CHANGED_EVENT = 'codepilot:file-changed';

/**
 * Where the change came from. Carried in the event detail so consumers
 * can decide whether to ignore self-originated changes (e.g. the panel
 * that just saved doesn't need to refetch from its own write).
 */
export type FileChangedSource = 'ai-tool' | 'preview-save' | 'external';

export interface FileChangedDetail {
  /** Absolute paths whose on-disk content changed. Normalized to
   *  forward slashes by the dispatcher; consumers should still
   *  compare with care on Windows. */
  paths: string[];
  source: FileChangedSource;
  /**
   * Optional opaque identifier the originator can set so consumers can
   * skip self-echo. PreviewPanel's save passes its own filePath here;
   * the listener tests `detail.originId !== thisPanelId`.
   */
  originId?: string;
}

/**
 * Dispatch a file-changed event. No-ops outside a browser (SSR / unit
 * tests that don't run with jsdom). When called with an empty `paths`
 * array we still dispatch — consumers can interpret that as a generic
 * "stale, force refetch" pulse.
 */
export function dispatchFileChanged(detail: FileChangedDetail): void {
  if (typeof window === 'undefined') return;
  const normalized: FileChangedDetail = {
    ...detail,
    paths: detail.paths.map((p) => p.replace(/\\/g, '/')),
  };
  window.dispatchEvent(
    new CustomEvent<FileChangedDetail>(FILE_CHANGED_EVENT, { detail: normalized }),
  );
}

/**
 * Type guard for the listener. `event.detail` is typed `any` because the
 * Window event map doesn't know about our custom event; this narrows it
 * back to the expected shape so listeners can rely on `detail.paths`.
 */
export function isFileChangedDetail(value: unknown): value is FileChangedDetail {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<FileChangedDetail>;
  if (!Array.isArray(v.paths)) return false;
  if (!v.paths.every((p) => typeof p === 'string')) return false;
  return v.source === 'ai-tool' || v.source === 'preview-save' || v.source === 'external';
}
