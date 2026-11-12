# Jules-compatible API for Codex Web

Status: Complete

## Goal

Expose the documented Jules v1alpha resource surface for Codex Web sessions while
keeping browser authentication and API-key authentication as separate security
boundaries.

## Scope

- `/v1alpha/sources` and `/v1alpha/sources/{source}`
- `/v1alpha/sessions` list/create/get/delete
- Session `:archive`, `:unarchive`, `:sendMessage`, and `:approvePlan`
- `/v1alpha/sessions/{session}/activities` list/get
- Settings-generated API keys with one-time secret display and revocation
- Broker-managed API access in multi-user mode and local API access in
  single-user mode

## Security decisions

- API requests authenticate only with `X-Goog-Api-Key`. Cookie-only sessions,
  query-string keys, and `Authorization` API keys are rejected.
- API keys are stored as SHA-256 hashes, scoped to a single broker user or local
  account, and bound to the current web-auth configuration and user credential
  version.
- API keys are invalidated by account disablement, broker credential changes,
  local-auth changes, SSO mode/issuer/client/secret/scopes changes, and SSO
  allowlist changes.
- API keys never enter app-server, browser storage, or public Settings list
  responses. The raw key is returned only once at creation time. The application
  does not intentionally log the key header; query-string transport is rejected
  because upstream access logs may retain complete URLs.
- API-created threads are tagged `codex_web_jules_api`; other browser-created
  threads are invisible to the API.
- Source selection is restricted to the authenticated account's configured cwd
  and historical thread cwds. Arbitrary filesystem paths and source creation are
  rejected.
- API runtime connections never answer app-server approval or server requests.
  Pending requests remain visible to the Web UI for human approval.

## Implementation phases

1. Complete broker protocol support for key lifecycle, API runtime attachment,
   and API session metadata.
2. Finish key/session stores with atomic owner-only persistence.
3. Add the reusable Jules app-server connector and `/v1alpha` handler.
4. Add same-origin Settings APIs and the API Keys Settings page.
5. Add unit/route tests, docs, and run typecheck/build/smoke verification.

## Verification

- `pnpm run test`: 216 files and 1092 tests passed.
- `pnpm run build`: production build completed and included `/v1alpha/[...path]`
  plus both Settings API key routes.
- `pnpm run test:smoke`: passed with a temporary isolated `CODEX_HOME` because
  the documented `/volume2` test home is absent in this environment.
- Live Chromium/CDP verification against the dev server: local login, API key
  create, one-time display, reload clearing the raw key, `/v1alpha/sources`
  (`200`, one source), `/v1alpha/sessions` (`200`, zero sessions), cookie-only
  (`401`), invalid key (`401`), query key (`400`), UI revocation, and revoked
  key rejection (`401`). The browser console was clean on an allowlisted dev
  origin after fixing an SSR hydration mismatch in the endpoint preview.
- Persisted key state was verified as directory `0700`, file `0600`, and contained
  no raw key after revocation.

## Negative Verification

- A cookie-only request cannot substitute for an API key.
- Query-string and `Authorization` key transport are rejected.
- Browser-created threads and arbitrary source paths are not API-visible.
- Revocation takes effect on the next API request.
- API keys are bound to local credentials and to SSO provider/allowlist settings;
  broker user disablement also invalidates them.
- `AUTO_CREATE_PR`, branch selection, source environment variables, and activity
  time filters return `UNIMPLEMENTED` rather than simulating unsupported behavior.
