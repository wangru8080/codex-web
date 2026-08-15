/**
 * 为 iframe srcDoc 注入 Content-Security-Policy。
 *
 * strict 禁止脚本；interactive 只允许内联脚本；navigate 供本地开发页
 * 跳转使用。三种模式都禁止 connect、子框架、worker 和对象资源。
 * 输入可以是完整文档或 HTML 片段，CSP 始终插入 head 的最前方。
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
  // 静态模式不执行任何脚本。
  "script-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
];

const INTERACTIVE_CSP_PARTS = [
  "default-src 'none'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "child-src 'none'",
  "manifest-src 'none'",
  "script-src 'unsafe-inline'",
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
  "base-uri 'self'",
  "form-action 'none'",
];

export type InlineHtmlCspMode = 'strict' | 'interactive' | 'navigate';

export function buildInlineHtmlCspMeta(mode: InlineHtmlCspMode = 'strict'): string {
  const directives = mode === 'navigate'
    ? NAVIGATE_CSP_PARTS
    : mode === 'interactive'
      ? INTERACTIVE_CSP_PARTS
      : STRICT_CSP_PARTS;
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
