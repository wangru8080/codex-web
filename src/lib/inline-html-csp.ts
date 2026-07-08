/**
 * Inline-html srcDoc Content-Security-Policy injection — Phase 4 P1.2.
 *
 * Background: the `/api/files/html-preview` route applies a strict
 * Round 4 CSP at the HTTP-response level. That CSP protects file
 * previews loaded via the route, but NOT inline-html artifacts
 * produced from chat code fences, the Markdown→HTML presentation
 * pipeline, or the localhost-artifact redirector — those all flow
 * through `<iframe srcDoc=...>` which is sandboxed but otherwise
 * unconstrained, so a script in the rendered content could leak via
 * URL-shaped channels (img / style / script src + query string).
 *
 * This module injects an equivalent CSP as a `<meta>` element near
 * the top of the HTML document. Browsers respect meta CSP for
 * fetch-directives once they encounter the tag in <head>, so
 * inserting BEFORE any other <head> content gives us protection over
 * subsequent subresource loads.
 *
 * Two modes mirror the route:
 *   - 'strict'   : the default. Round 4 Static policy — no scripts,
 *                  no egress (connect/frame/object/worker), https
 *                  allowed only for static-display resources
 *                  (img / style / font / media).
 *   - 'navigate' : permits same-document navigation via meta refresh
 *                  but keeps everything else closed. Used by the
 *                  localhost-artifact path which navigates the
 *                  iframe to the user's dev server.
 *
 * The HTML the caller passes in may have any shape — full document,
 * fragment, no <head>. We handle the common cases:
 *   1. Has `<head>` → inject right after the opening tag
 *   2. Has `<html>` but no `<head>` → insert `<head>…</head>` right
 *      after `<html>`
 *   3. Bare fragment → wrap the input in a minimal `<!doctype html>
 *      <html><head>…</head><body>{input}</body></html>` shell
 */

const STRICT_CSP_PARTS = [
  "default-src 'none'",
  // Static-display resources: align with the Round 4 Static policy.
  // https://...img.png from an AI-generated artifact is allowed; the
  // sandbox + lack of scripts means there is no URL the page can
  // dynamically construct to exfiltrate user data through these
  // channels at runtime.
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline' https:",
  "font-src 'self' data: https:",
  "media-src 'self' data: blob: https:",
  // Network egress: locked down regardless of mode. Mirrors the
  // route's Round 3 stance.
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "child-src 'none'",
  "manifest-src 'none'",
  // No scripts in inline-html artifacts. This matches Round 4 Static;
  // an Interactive equivalent isn't exposed for inline-html because
  // there's no UI affordance for the user to toggle it on a code-fence
  // Preview — code fences are the AI's output, not a trusted page.
  "script-src 'none'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'none'",
];

const NAVIGATE_CSP_PARTS = [
  // For the localhost-artifact redirector: the document is a tiny
  // <meta refresh> shell that navigates to the user's dev server.
  // Meta refresh isn't governed by these directives (it's a UA
  // feature), but we still want every fetch / connect / nested frame
  // closed so the redirector itself can't be repurposed as an
  // exfiltration channel before the navigation completes.
  "default-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "child-src 'none'",
  "manifest-src 'none'",
  "script-src 'none'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'none'",
];

export type InlineHtmlCspMode = 'strict' | 'navigate';

export function buildInlineHtmlCspMeta(mode: InlineHtmlCspMode = 'strict'): string {
  const directives = mode === 'navigate' ? NAVIGATE_CSP_PARTS : STRICT_CSP_PARTS;
  const value = directives.join('; ');
  return `<meta http-equiv="Content-Security-Policy" content="${value.replace(/"/g, '&quot;')}">`;
}

/**
 * Inject a CSP `<meta>` element near the top of the document so
 * subresource loads from the rendered HTML are subject to the same
 * Round 4 baseline that the route enforces for file previews.
 *
 * IMPORTANT (Phase 4 P1.3): CodexWeb's CSP is ALWAYS injected, even
 * when the input HTML already contains a Content-Security-Policy
 * meta. Inline HTML from chat code fences and AI-generated artifacts
 * is untrusted content — an attacker who controls the HTML body
 * could otherwise include their own permissive CSP (e.g.
 * `default-src *`) to defeat the lockdown.
 *
 * CSP intersection semantics make multi-policy injection safe: when
 * multiple Content-Security-Policy directives are present, resources
 * must satisfy ALL of them, so adding our restrictive baseline can
 * only tighten, not loosen, the effective policy. The CodexWeb
 * meta is injected at the FRONT of <head> so the browser sees it
 * before any other policy the document might carry.
 */
export function injectInlineHtmlCsp(
  html: string,
  mode: InlineHtmlCspMode = 'strict',
): string {
  const meta = buildInlineHtmlCspMeta(mode);
  // Case 1: explicit <head> — insert right after it so our policy is
  // the FIRST policy the browser sees.
  const headOpen = html.match(/<head\b[^>]*>/i);
  if (headOpen && headOpen.index !== undefined) {
    const insertAt = headOpen.index + headOpen[0].length;
    return html.slice(0, insertAt) + meta + html.slice(insertAt);
  }
  // Case 2: has <html> but no <head> — synthesize a <head> with our
  // policy. If the body later contains its own CSP meta, the browser
  // will treat both as active (intersection applies).
  const htmlOpen = html.match(/<html\b[^>]*>/i);
  if (htmlOpen && htmlOpen.index !== undefined) {
    const insertAt = htmlOpen.index + htmlOpen[0].length;
    return html.slice(0, insertAt) + `<head>${meta}</head>` + html.slice(insertAt);
  }
  // Case 3: bare fragment — wrap in a minimal shell. The original
  // content becomes the body; any CSP meta the input carried (now
  // inside <body>) is ignored by browsers (CSP meta must be in
  // <head> to take effect), but our injected one DOES.
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}
