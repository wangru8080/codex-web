/*
 * Phase 3 helper for triggering the artifact:export-long-shot Electron IPC
 * and turning its base64 result into a downloadable file.
 *
 * Surface: one function `exportHtmlAsLongShot({ html, filename, width })`.
 * Callers (PreviewPanel header button, DiffSummary row action) hand it the
 * HTML source they want turned into a PNG, plus a suggested filename — we
 * do the plumbing. Errors surface as thrown Error with machine-readable
 * `code` so UI can branch on "busy / timeout / canvas_limit / unavailable".
 *
 * Web-only (dev server) environments return a clear "unavailable" error
 * since the IPC doesn't exist there.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ExportLongShotErrorCode =
  | 'unavailable'     // Not running inside Electron (dev server preview)
  | 'busy'            // Another export is already in flight
  | 'timeout'         // Hit the 30s watchdog
  | 'canvas_limit'    // Content exceeded Chromium's per-canvas height
  | 'debugger_busy'   // CDP debugger attach failed (DevTools already on?)
  | 'oom'             // Unexpected render failure (catch-all)
  | 'export_failed';  // Generic fallback

export class ArtifactExportError extends Error {
  constructor(
    public code: ExportLongShotErrorCode,
    message: string,
    public meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ArtifactExportError';
  }
}

function getElectronApi() {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.electronAPI ?? null;
}

export interface ExportHtmlOptions {
  /** Full HTML document source (include <html>/<body> for correct layout). */
  html: string;
  /** Filename the download is named with, sans extension. */
  filename: string;
  /** CSS pixel width of the exported image. Defaults to 1024 (laptop). */
  width?: number;
  /** Device pixel ratio for retina-quality output. Defaults to 2. */
  pixelRatio?: number;
  /** Hard cap on content height so we surface canvas_limit early. */
  maxHeightPx?: number;
}

/**
 * Capture the given HTML as a long PNG and trigger a browser download.
 *
 * Throws ArtifactExportError with a discriminated code on failure. The
 * caller is responsible for translating the code to an i18n string and
 * surfacing it via toast / inline alert — we don't assume any particular
 * UI shell.
 */
export async function exportHtmlAsLongShot(opts: ExportHtmlOptions): Promise<void> {
  const api = getElectronApi();
  if (!api?.artifact?.exportLongShot) {
    throw new ArtifactExportError(
      'unavailable',
      'Artifact export is only available in the desktop app.',
    );
  }

  const result = await api.artifact.exportLongShot({
    html: opts.html,
    width: opts.width ?? 1024,
    pixelRatio: opts.pixelRatio ?? 2,
    maxHeightPx: opts.maxHeightPx ?? 50000,
  });

  if (result?.error) {
    throw new ArtifactExportError(
      (result.error as ExportLongShotErrorCode) ?? 'export_failed',
      typeof result.error === 'string' ? result.error : 'Export failed',
      result.meta,
    );
  }

  if (!result?.base64) {
    throw new ArtifactExportError('export_failed', 'Export returned no data');
  }

  // Turn base64 PNG into a Blob + trigger download. Using a temporary
  // anchor with URL.createObjectURL is the standard "save file" pattern
  // in a web context and keeps the data inside the renderer — we don't
  // need to round-trip through another IPC just to save.
  const binary = atob(result.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/png' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.download = `${opts.filename}-${timestamp}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a tick so some browsers finish the download first.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
