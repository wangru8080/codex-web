/**
 * provider-endpoint-sanitize.ts — masking helper for provider base_url
 * display.
 *
 * Some user records (especially from imported configs or paste-into-
 * wrong-field accidents) end up with API keys / tokens stored in the
 * `base_url` column. The Provider Card was rendering those values as
 * "接入地址 sk-or-v1-…" — leaking secrets in screenshots, screen
 * recordings, and logs.
 *
 * This helper is the single source of truth for "is this string safe to
 * surface as an endpoint?" — used by the Provider Card today, and any
 * future surface that wants to render `base_url` should route through
 * here too. Pure function (no React / DOM deps) so it's unit-testable.
 *
 * Returns:
 *   - { display, suspicious: false }
 *       Normal HTTP(S) endpoint — `display` is `host[:port]/path` (the
 *       protocol prefix is stripped, matching the historic UI).
 *   - { display, suspicious: true, tooltip }
 *       Looks like a secret — `display` is the i18n-rendered "Suspicious
 *       endpoint (…last4)" copy, with the last 4 chars exposed so users
 *       can identify which row needs fixing without seeing the secret.
 *       Caller MUST also drop any title/aria-label that would echo the
 *       raw value, otherwise hover tooltips would leak it back.
 */

export interface SanitizedEndpoint {
  display: string;
  suspicious: boolean;
  tooltip?: string;
}

/**
 * Translation callback shape — kept minimal so the helper stays
 * decoupled from `useTranslation` and the test can pass a stub.
 */
export type SanitizeTranslator = (
  key: 'provider.endpoint.suspicious' | 'provider.endpoint.suspiciousTooltip',
  vars?: { tail?: string },
) => string;

/**
 * High-confidence "this is a secret" prefixes:
 *   `sk-`   / `sk_`     OpenAI, Anthropic-compat (sk-ant-, sk-or-, sk-sp-)
 *   `pk_`               Stripe-shape publishable keys
 *   `ghp_`/`gh_pat_`    GitHub PATs
 *   `ant-` / `ant_`     Some Anthropic-relay token forms
 *   `api_key_`          Generic placeholder pattern
 * Pattern is case-insensitive to catch stray uppercase pastes.
 */
const SECRET_PREFIX = /^(sk[-_]|pk_|ghp_|gh_pat_|ant[-_]|api_key_)/i;

export function sanitizeEndpointForDisplay(
  rawUrl: string,
  t: SanitizeTranslator,
): SanitizedEndpoint {
  const trimmed = rawUrl.trim();
  // Empty input — caller already guards against this, but mirror the
  // contract for defensive callers / tests.
  if (!trimmed) {
    return { display: '', suspicious: false };
  }

  const looksLikeSecret = SECRET_PREFIX.test(trimmed);

  // Try URL parsing as the next gate. Anything that isn't HTTP(S) shouldn't
  // sit in `base_url` either — Bedrock/Vertex live in env_overrides, not
  // base_url, so a non-http(s) value here is wrong shape regardless of
  // whether it's a secret.
  let parsed: URL | null = null;
  try {
    parsed = new URL(trimmed);
  } catch {
    /* not a URL */
  }
  const protoOk = parsed?.protocol === 'http:' || parsed?.protocol === 'https:';

  if (looksLikeSecret || !parsed || !protoOk) {
    const tail = trimmed.slice(-4);
    return {
      display: t('provider.endpoint.suspicious', { tail }),
      tooltip: t('provider.endpoint.suspiciousTooltip'),
      suspicious: true,
    };
  }

  // Normal endpoint — drop the protocol prefix (matches previous UI).
  // `host` includes a non-default port; `pathname` + `search` keep custom
  // routes (e.g. `…/anthropic`, `…/api/coding`). Trim trailing slashes so
  // `https://api.example.com/` and `https://api.example.com` render
  // identically.
  const hostPath = `${parsed.host}${parsed.pathname}${parsed.search}`.replace(/\/+$/, '');
  return { display: hostPath, suspicious: false };
}
