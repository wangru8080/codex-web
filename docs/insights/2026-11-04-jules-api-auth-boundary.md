# Product Insight: Jules API Key and Browser-Auth Boundary

Date: 2026-11-04
Related Handover: `docs/handover/2026-11-04-jules-compatible-api.md`

## Decision

The Jules-compatible API is a second authentication surface for the same Codex account, not a replacement for browser SSO or local login. API keys are created only from an authenticated Settings session and are verified independently on every `/v1alpha` request.

## Why Not Reuse the Browser Cookie?

Jules clients are non-browser automation. Accepting a browser cookie as an API credential would couple automation lifetime to a 3-day signed cookie and make CSRF/cookie-leak failures indistinguishable from API access. It would also make revocation coarse-grained: logging out every browser would be the only way to cut off an integration.

The API instead requires `X-Goog-Api-Key`. Query-string, `Authorization`, and cookie-only transport are rejected so a key is less likely to be captured in proxy logs, shell history, or generic auth middleware.

## Why Bind Keys to Browser Auth?

An API key can outlive the browser session that created it. Without additional binding, a stolen key could continue to act after a password reset, SSO provider rotation, or account disablement. Each key therefore stores two non-secret binding facts:

1. A fingerprint of the active Web authentication configuration.
2. The account credential version owned by the broker or local auth implementation.

The API recomputes both on every request. Local password/session-secret changes, SSO provider or allowlist changes, broker user changes, and disablement make the key unusable. The setting can later be reverted; operators that require irreversible invalidation should also revoke keys or add a persisted auth-generation counter.

## SSO and Local Coexistence

- In local mode, the key is scoped to the configured local account and signed session secret.
- In SSO mode, the key is scoped to the provider/client/secret/scopes and current email/domain allowlist. A broker key additionally requires a matching enabled broker user.
- Switching modes changes the fingerprint, so keys created under the inactive mode cannot cross the boundary.
- Browser SSO remains the only path that establishes a new broker session; an API key cannot mint another browser session or a new API key.

## Runtime Isolation

The API does not start a parallel execution engine. A broker API request attaches to the same per-user runtime and app-server as the browser. That preserves Thread/Turn/Item state, sandbox policy, cwd ownership, and account credentials. It also means approvals raised by app-server stay human-owned: API code never auto-approves a request, and the browser UI remains the approval surface.

API-created threads carry a distinct thread source and require an ownership record. Normal browser threads are deliberately invisible even if a client guesses their IDs.

## Permission Model

Workspace keys use `workspace-write` with on-request approvals. Full-access keys use `dangerFullAccess` with `approvalPolicy=never`; this is exposed with an explicit high-risk warning. A key's permission profile is stored at creation and cannot be elevated by request parameters.

## Non-Goals

The compatibility layer does not fabricate Jules-only capabilities. Pull-request automation, branch selection, source environment injection, and activity time filters are unavailable because Codex Web does not expose equivalent app-server semantics. Returning `UNIMPLEMENTED` is safer than silently degrading behavior or reporting invented state.

