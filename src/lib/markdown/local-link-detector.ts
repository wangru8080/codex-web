/**
 * Local-file link detection — Phase 4 P2.1.
 *
 * The chat renders markdown via streamdown, which turns `[label](path)`
 * into an `<a href="path">label</a>`. When the path points at a local
 * file (absolute, or relative-with-previewable-extension), the
 * default behaviour — let the browser navigate — is wrong: the
 * browser tries to follow a relative URL against the current
 * `localhost:3000` page and 404s. The DOM-walk enrichment in
 * `DevOutputChips` instead routes the click through
 * `setPreviewSource`, but only after these helpers say "yes, this
 * looks like a local file."
 *
 * Pure functions so the contract can be unit-tested without jsdom.
 */

import { PREVIEWABLE_FILE_EXTENSIONS } from './dev-output-parser';

/**
 * Return true for hrefs that obviously aren't local file paths and
 * should NOT be intercepted (http/https/mailto/tel/data/javascript/
 * blob/fragment-only-anchors/protocol-relative).
 */
export function looksLikeRemoteHref(href: string): boolean {
  if (!href) return true;
  if (href.startsWith('//')) return true;
  if (href.startsWith('#')) return true;
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

/**
 * Return true when the path could be a local file the user might want
 * to preview. Two acceptance rules:
 *   1. Absolute path (POSIX `/foo` or Windows `C:\foo`).
 *   2. Has a previewable extension (`.md`, `.html`, `.json`, etc.).
 *
 * Relative paths without a previewable extension fall through — we
 * don't want every `[link](foo.bar)` to become a file ref.
 */
export function isPotentialLocalFile(path: string): boolean {
  if (!path) return false;
  if (path.startsWith('/')) return true;
  if (/^[A-Za-z]:[\\/]/.test(path)) return true;
  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = path.slice(dot).toLowerCase().replace(/[#:].*$/, '');
  return PREVIEWABLE_FILE_EXTENSIONS.has(ext);
}
