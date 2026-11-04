# Handover: Jules-Compatible API

Date: 2026-11-04
Related Insight: `docs/insights/2026-11-04-jules-api-auth-boundary.md`
Execution Plan: `docs/exec-plans/completed/2026-11-04-jules-compatible-api.md`

## Summary

Codex Web now exposes the documented Jules v1alpha surface under `/v1alpha`. API requests authenticate with a server-generated, revocable `X-Goog-Api-Key` and run through the same Codex app-server runtime as the signed-in account. Browser SSO/local authentication remains the authority for creating and invalidating keys.

## Request Flow

```text
Jules client
  | X-Goog-Api-Key
  v
Next route /v1alpha/[...path]
  | header validation, origin checks, key verification
  v
Runtime broker (multi-user) or Web bridge (single-user)
  |
  v
codex app-server
```

The Next proxy bypasses cookie authentication and demo mocks for `/v1alpha`; key verification is owned by the route handler.

## Key Lifecycle

- `server/api-key-store.ts` generates `cwk1_<hex-id>_<base64url-secret>` keys and stores only a SHA-256 hash.
- The raw key is returned once from Settings creation and is never included in list responses or persisted by the browser.
- Each user may have three active keys. `lastUsedAt` is updated at most once per minute.
- Key records include an auth-configuration fingerprint and a broker/local credential version.
- Broker-managed keys are invalidated by user disablement or any change to the user's broker credential fields.
- Single-user keys are bound to local email/password/session secret, or to SSO provider configuration and allowlists.
- A key cannot be used as a browser session, and a browser cookie alone cannot access `/v1alpha`.

## API-to-App-Server Mapping

- Sources are derived from `thread/list`; no filesystem source can be created through the API.
- Session creation calls `thread/start` with `threadSource=codex_web_jules_api`, writes ownership metadata, then calls `turn/start`.
- Session list/get/delete map to real app-server `thread/list`, `thread/read`, and `thread/delete`.
- Archive and unarchive map to `thread/archive` and `thread/unarchive`.
- `sendMessage` uses `turn/steer` when the latest turn is active, otherwise `turn/start`.
- `approvePlan` requires a real completed plan item, records approval, then starts a default-mode turn.
- Session state and activities are derived from real thread/turn/item data. Terminal activity IDs are deterministic hashes.

## Ownership and Data Isolation

`server/jules-session-store.ts` records the owning user, source ID, original prompt, title, plan-approval flag, and plan approval receipt. Upserts are globally unique by thread ID and reject cross-user ownership changes. API listing requires both an ownership record and the `codex_web_jules_api` thread source, so normal browser threads never appear.

In multi-user mode, these metadata operations and the runtime attachment use the API key against the broker; the broker resolves the key to its configured user and re-checks the credential version. The API never accepts a client-supplied user ID as identity.

## Unsupported Jules Semantics

The following return `UNIMPLEMENTED` rather than being simulated:

- `AUTO_CREATE_PR`
- `sourceContext.workingBranch`
- `sourceContext.githubRepoContext.startingBranch`
- source environment variables
- activity time-range filters

Session outputs are omitted. `PLANNING` is deprecated by the Jules discovery document and is not emitted. `AWAITING_USER_FEEDBACK` is not emitted because Codex does not expose a corresponding terminal session state. `AWAITING_PLAN_APPROVAL` is emitted only when a real plan item is pending.

## Operational Notes

- Settings API routes are same-origin and no-store.
- `/v1alpha` responses are no-store and reject query, Bearer, and cookie-only key transport.
- Default API runtime permission profile is `workspace`; `full_access` is visible as a high-risk warning in Settings.
- API runtime code deliberately ignores app-server server requests. Pending approvals must be handled in the Web UI.
- Key state paths are root-managed in multi-user mode and use the Web `CODEX_WEB_STATE` in single-user mode.

## Files

- `server/api-key-store.ts`, `server/api-key-settings.ts`, `server/jules-session-store.ts`
- `server/jules-api.ts`, `server/jules-model.ts`, `server/jules-runtime.ts`
- `server/web-auth.ts`, `server/runtime-broker-*.ts`
- `src/app/v1alpha/[...path]/route.ts`, `src/app/api/settings/api-keys/**`
- `src/app/settings/api-keys/page.tsx`, `src/components/settings/ApiKeysSection.tsx`

## Follow-Ups

- Add a live E2E test that creates a key through the Settings UI, creates a session, exercises archive/sendMessage/approvePlan, and revokes the key.
- Consider a persisted auth-generation counter if deployments need keys to remain permanently invalid after an auth configuration is changed and later reverted.

