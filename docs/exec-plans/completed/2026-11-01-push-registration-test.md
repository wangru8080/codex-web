# Push registration delivery test

**Status:** Code complete; targeted tests and production builds passed
**Date:** 2026-11-01

## Goal

Fix the server-side Web Push transport and make a successful Android UnifiedPush
registration prove delivery with an immediate test notification.

## Root cause

The custom HTTPS agent's DNS lookup ignored Node's `options.all` mode. Node called the
lookup with `all: true` and expected an address array, while the agent returned a single
address and family. Every live send failed locally with `ERR_INVALID_IP_ADDRESS`
(`status unknown`) before reaching Mozilla Push.

The same stored subscription succeeded through the default `web-push` HTTPS transport,
confirming that the endpoint, encryption keys, and VAPID configuration were valid.

## Scope

- Fixed the public-only DNS lookup callback for both array and single-address modes.
- Send a typed `test` Web Push payload as part of `codexWeb/push/register`.
- Return the test delivery outcome to Android while keeping the subscription registered.
- Accept and render the `test` payload kind in Android.
- Treat a missing or failed registration test as a registration error in Android so the
  notifications screen does not claim the path is ready.
- Added regression tests for registration test delivery, delivery failure reporting, the
  DNS callback contract, and Android payload parsing.

## Verification Results

- Targeted server suites: 43 tests passed across push units, transport contract, bridge
  integration, and runtime-registry integration.
- `pnpm run typecheck`: passed.
- `pnpm run build`: passed after rerunning outside the sandbox because Turbopack needs to
  create a worker process and bind a local port.
- `pnpm run build:production-server`: passed; rebuilt bundle contains the test-notification
  response path.
- Live Mozilla Push verification with the fixed public-only agent returned HTTP `201`
  using the existing subscription and VAPID state in `/home/stefan/.codex-web/push.json`
  (real, non-isolated state).
- Android `./gradlew testDebugUnitTest`: passed.
- Android `./gradlew assembleRelease`: passed; local release APK generated.
- GitHub Actions run `41324961493` for Android commit `37bdc59`: passed; artifact
  `codex-web-android-0.1.0-ci.24` (12,470,813 bytes) uploaded.
- Android visual notification verification is still pending installation of the updated
  APK and a registration retry on the device.

## Smoke Ledger

| Date | Environment | Path | Result |
| --- | --- | --- | --- |
| 2026-11-01 | Real push state, Mozilla endpoint | Fixed transport sends `test` payload | HTTP `201`; live delivery accepted |
| 2026-11-01 | Unit fixture | Registration test gets HTTP `503` | Registration remains stored; response reports `delivered: false`, status `503` |
| 2026-11-01 | Unit fixture, mocked DNS | Node requests `all: true` | Lookup returns an address array; private DNS results are rejected |
| 2026-11-01 | Android parser | `kind: test` payload | Accepted; unknown/malformed payloads remain rejected |
| 2026-11-01 | GitHub Actions | Android `main` push `37bdc59` | Workflow succeeded; APK artifact uploaded |

## Follow-up: idempotent reconnect registration

Android re-registers its UnifiedPush endpoint after each bridge reconnect. The initial
implementation sent a registration test for every request, so the test notification
appeared repeatedly even when the subscription target had not changed.

The server now persists `testDeliveredAt` with each subscription and compares the
endpoint plus both Web Push keys with the existing record. An unchanged registration
whose test was previously accepted returns `testNotification.sent: false` and sends no
push. Registrations with a changed target, and unchanged retries after a failed test,
still send a test. The marker is loaded from `push.json`, so suppression survives service
restarts; legacy records without the field receive one final test after deployment.

Targeted verification passed: `pnpm run typecheck`, the 47 notification, transport,
bridge, and runtime-registry tests, and `pnpm run build:production-server`. A live check
against a copy of the production state and the existing Mozilla endpoint returned HTTP
`201` for the first registration, returned `testNotification.sent: false` for the
immediate identical registration, and persisted the marker in the copied state. The full
`pnpm run test` suite had 1056 passing tests and four unrelated pre-existing failures in
`src/codex-web/tests/proxy.test.ts` and
`src/codex-web/tests/web-auth-route-wiring.test.ts`.

| Date | Environment | Path | Result |
| --- | --- | --- | --- |
| 2026-11-01 | Live production-state copy, Mozilla endpoint | New target followed by identical registration | HTTP `201`, then `sent: false`; `testDeliveredAt` persisted |
| 2026-11-01 | Unit fixture | Same endpoint and keys register twice | One push sent; second response reports `sent: false` |
| 2026-11-01 | Unit fixture | Service restart between identical registrations | No second push; persisted marker is honored |
| 2026-11-01 | Unit fixture | Failed test followed by retry | Failed attempt is unmarked; retry sends exactly one new test |
| 2026-11-01 | Unit fixture | Endpoint or encryption keys change | New target gets a test; repeating the new target is then suppressed |
