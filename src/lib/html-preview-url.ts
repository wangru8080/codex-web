/**
 * HTML preview URL builder + parser — Phase 4 Phase 1.5.
 *
 * Background: serving an HTML file with `iframe srcDoc=<bytes>` makes
 * the document's effective URL the parent app's URL. Any relative
 * resource the page references (`./style.css`, `<img src="logo.png">`,
 * `<script src="bundle.js">`) resolves against the wrong base and
 * 404s. This module produces the same-origin URL that
 * `/api/files/html-preview/[...segments]/route.ts` serves, encoding
 * the trust scope into the URL path itself so subsequent relative
 * fetches the browser issues still carry the scope marker.
 *
 * Why path segments instead of query strings: when the browser
 * resolves `./style.css` from a document at
 * `/api/files/html-preview/SCOPE/abs/dir/index.html?baseDir=...`,
 * it produces `/api/files/html-preview/SCOPE/abs/dir/style.css` —
 * the query string is NOT preserved across relative resolution.
 * Scope must live in the path so it survives.
 *
 * Scope tokens:
 *  - `ws.<base64url(baseDir)>` — workspace scope; resources must
 *    stay under baseDir.
 *  - `home`                    — home-directory scope; resources
 *    must stay under the server's homedir. Used for user-selected
 *    external HTML files.
 *
 * Stateless: the URL itself carries everything the route needs;
 * nothing is stored in cookies or session.
 */

export type HtmlPreviewScope =
  | { kind: 'workspace'; baseDir: string }
  | { kind: 'home' };

export interface ParsedHtmlPreviewRequest {
  scope: HtmlPreviewScope;
  absolutePath: string;
}

const SCOPE_TOKEN_WORKSPACE_PREFIX = 'ws.';
const SCOPE_TOKEN_HOME = 'home';

function toBase64Url(input: string): string {
  // Buffer is Node-only; this helper runs in both Node (route handler)
  // and the browser (PreviewPanel). Use the browser's btoa for client
  // builds and Buffer for the server side; both produce the same bytes
  // for ASCII / Unicode-safe input.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  let b64: string;
  if (typeof g.Buffer === 'function') {
    b64 = g.Buffer.from(input, 'utf-8').toString('base64');
  } else {
    // utf-8 encode then btoa
    const encoded = unescape(encodeURIComponent(input));
    b64 = g.btoa(encoded);
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (input.length % 4)) % 4);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.Buffer === 'function') {
    return g.Buffer.from(padded, 'base64').toString('utf-8');
  }
  const decoded = g.atob(padded);
  return decodeURIComponent(escape(decoded));
}

/**
 * Encode an absolute POSIX path into URL-safe segments. We keep the
 * separators as path segments (not URL-encoded `%2F`) so the browser's
 * relative-URL resolution still treats them as a directory hierarchy.
 * Each segment is percent-encoded individually to handle Unicode /
 * spaces / `?` / `#`.
 */
function encodeAbsolutePath(absolutePath: string): string {
  // Strip leading slashes — they become the route's leading slash.
  const stripped = absolutePath.replace(/^\/+/, '');
  return stripped.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

/**
 * Build the same-origin preview URL the iframe `src` should load.
 *
 * The returned URL is rooted at the API namespace so it sits inside
 * the app's session; CSRF is not a concern because the route only
 * reads files and is sandboxed by the iframe's lack of
 * `allow-same-origin`. The iframe gets a null/opaque origin which
 * cannot access the parent app's cookies or storage even though
 * they're technically on the same hostname.
 *
 * Query parameters are added ONLY to the document URL the iframe
 * loads — relative resolution strips queries, so subresource fetches
 * never carry them. That's intentional:
 *  - `interactive=1` controls the document's CSP (script-src) once,
 *    at the document level. Subresources don't need it.
 *  - `_t=<n>` is a cache-bust nonce; bumping it changes the iframe
 *    `src`, which forces the browser to re-fetch the document and
 *    therefore re-fetch every subresource the document references.
 *    This is how Phase 4 "HTML 依赖资源变更触发自动刷新" actually
 *    propagates a `./style.css` edit into the live preview.
 */
export function buildHtmlPreviewUrl(
  absolutePath: string,
  scope: HtmlPreviewScope,
  options: { interactive?: boolean; reloadNonce?: number } = {},
): string {
  if (!absolutePath.startsWith('/')) {
    throw new Error(
      `buildHtmlPreviewUrl requires an absolute POSIX path; got "${absolutePath}"`,
    );
  }
  const scopeToken =
    scope.kind === 'workspace'
      ? SCOPE_TOKEN_WORKSPACE_PREFIX + toBase64Url(scope.baseDir)
      : SCOPE_TOKEN_HOME;
  const base = `/api/files/html-preview/${scopeToken}/${encodeAbsolutePath(absolutePath)}`;
  const params: string[] = [];
  if (options.interactive) params.push('interactive=1');
  if (options.reloadNonce && options.reloadNonce > 0) {
    params.push(`_t=${options.reloadNonce}`);
  }
  return params.length ? `${base}?${params.join('&')}` : base;
}

/**
 * POSIX-style dirname. Returns "/" for top-level files, "" for paths
 * without separators. Frontend-only — Node's `path.dirname` isn't
 * available in the browser bundle.
 */
export function htmlPreviewDirname(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  if (idx < 0) return '';
  if (idx === 0) return '/';
  return norm.slice(0, idx);
}

/**
 * Static resource extensions that count as HTML "dependencies" for
 * the file-changed reload logic. When the active preview is an HTML
 * file and another file under the same scope baseDir with one of these
 * extensions changes, PreviewPanel reloads the iframe so the user
 * sees the new CSS / image / font without a manual refresh.
 *
 * Includes:
 *  - css, common image formats (so `<img>` and CSS `background-image` resolve),
 *  - js / mjs (in case the HTML is in interactive mode and references a script),
 *  - font formats (web fonts loaded via @font-face from same-origin),
 *  - html itself (a sibling HTML included via <iframe> or anchor).
 *
 * Lowercased; callers should normalize before testing.
 */
export const HTML_DEP_EXTENSIONS: ReadonlySet<string> = new Set([
  '.css',
  '.js',
  '.mjs',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.svg',
  '.ico',
  '.bmp',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.html',
  '.htm',
]);

/**
 * Decide whether a changed path should trigger a reload of an HTML
 * iframe currently previewing `activeHtmlPath` under `scopeBaseDir`.
 *
 * Rules:
 *  1. The changed path itself matching the active file always counts —
 *     that's the existing same-file reload contract. The HTML-aware
 *     reload kicks in only for siblings.
 *  2. Otherwise the path must be under `scopeBaseDir` (or under it
 *     when scope is workspace; for home scope we still require the
 *     path to be under the homedir, which the route already enforces
 *     for the subresource fetch itself — but the client-side decision
 *     here uses the active HTML doc's containing directory as the
 *     conservative floor).
 *  3. The path must have a static-resource extension.
 *
 * Returns true → caller bumps reload nonce.
 */
export function shouldReloadHtmlForPath(
  changedPath: string,
  activeHtmlPath: string,
  scopeBaseDir: string | null | undefined,
): boolean {
  const norm = changedPath.replace(/\\/g, '/');
  const active = activeHtmlPath.replace(/\\/g, '/');
  if (norm === active) return true;
  if (!scopeBaseDir) return false;
  const scope = scopeBaseDir.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!(norm === scope || norm.startsWith(scope + '/'))) return false;
  const dot = norm.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = norm.slice(dot).toLowerCase();
  return HTML_DEP_EXTENSIONS.has(ext);
}

/**
 * Decode the path segments the Next.js dynamic route hands us back
 * into `{ scope, absolutePath }`. Throws on malformed input —
 * route callers should map the throw to a 400 response.
 *
 * Segment 0 is the scope token. Remaining segments form the absolute
 * filesystem path (we restore the leading slash). Path traversal
 * (`..`) is NOT collapsed here — the route handler runs
 * `assertRealPathInBase` which catches any traversal that would
 * escape the scope.
 */
export function parseHtmlPreviewSegments(
  segments: string[] | undefined | null,
): ParsedHtmlPreviewRequest {
  if (!segments || segments.length < 2) {
    throw new Error('html-preview path needs at least scope-token and one path segment');
  }
  const [scopeToken, ...pathSegments] = segments;

  let scope: HtmlPreviewScope;
  if (scopeToken === SCOPE_TOKEN_HOME) {
    scope = { kind: 'home' };
  } else if (scopeToken.startsWith(SCOPE_TOKEN_WORKSPACE_PREFIX)) {
    const baseDirEncoded = scopeToken.slice(SCOPE_TOKEN_WORKSPACE_PREFIX.length);
    if (!baseDirEncoded) {
      throw new Error('workspace scope token is missing the encoded baseDir');
    }
    let baseDir: string;
    try {
      baseDir = fromBase64Url(baseDirEncoded);
    } catch {
      throw new Error('workspace scope token has invalid base64url payload');
    }
    if (!baseDir.startsWith('/')) {
      throw new Error('decoded baseDir must be an absolute POSIX path');
    }
    scope = { kind: 'workspace', baseDir };
  } else {
    throw new Error(`unrecognized scope token "${scopeToken}"`);
  }

  // Rebuild the absolute path. Next.js already URL-decodes segments
  // when handing them to the route, so we just join with /.
  const absolutePath = '/' + pathSegments.join('/');
  return { scope, absolutePath };
}
