# UnifiedPush Notifications

**Status:** Code complete; targeted tests, production build, bridge smoke, and Android unit/release build passed
**Date:** 2026-11-01
**Handover:** `docs/handover/2026-11-01-unifiedpush-notifications.md`

## Goal

Deliver Android notifications through any UnifiedPush distributor (for example Sunup)
and push server (for example Mozilla Push), while keeping codex-web as the source of
truth for which Codex events are notification-worthy.

## Scope

- codex-web bridge and runtime broker accept authenticated UnifiedPush subscriptions.
- codex-web stores VAPID keys and subscriptions in `CODEX_WEB_STATE`, never in the browser.
- codex-web sends encrypted Web Push messages with VAPID to UnifiedPush endpoints.
- codex-web notifies only for:
  - terminal `turn/completed` events (`completed` or `failed`),
  - goal transitions to `complete`,
  - approval server requests,
  - user-input and MCP elicitation server requests.
- codex-web-android integrates the official UnifiedPush connector, exposes distributor
  selection and notification permission controls, and displays the received notifications.

## Non-goals

- Browser Notification API subscriptions.
- Notifying on every agent message or streamed delta.
- Storing OAuth tokens, API keys, or Codex credentials in push state.

## Architecture

```text
codex-web-android PushService -- authenticated bridge request --> codex-web bridge/broker
codex-web app-server event stream -- filter + dedupe -------------> Web Push (VAPID)
Mozilla Push / Sunup / other distributor -- encrypted message ----> Android PushService
Android PushService -- NotificationManager ----------------------> system notification
```

The Android endpoint registration uses the existing authenticated WebSocket session.
This avoids a second authentication path and binds each endpoint to the Codex account
whose app-server emitted the event. Each app installation uses a persisted UnifiedPush
instance UUID, allowing multiple devices on the same account.

## Decisions

- Notifications are emitted only for terminal, attention-requiring events. Interrupted
  Turns, deltas, ordinary messages, and idle status changes are excluded.
- Subscription state and VAPID keys live server-side in `push.json`, mode `0600`, inside
  a `0700` state directory.
- Endpoint URLs require HTTPS and public-address resolution. Private IPv4/IPv6 literals,
  IPv4-mapped addresses, private DNS answers, and URL credentials are rejected.
- Web Push TTL is 24 hours so an offline device can receive a notification after reconnect.
- The Android connector is pinned to `3.0.10`, the newest release compatible with the
  project's Kotlin 2.0.21 metadata version.

## Verification Results

- `pnpm exec vitest run server/tests/push-app-server-events.test.ts server/tests/push-notifications.test.ts server/tests/websocket-bridge.test.ts server/tests/user-runtime-registry.test.ts`: 39 tests passed.
- `pnpm run typecheck`: passed.
- `pnpm run build`: passed; Next production output generated.
- `CODEX_HOME=/tmp/codex-web-smoke-home pnpm run test:smoke`: passed against a real app-server.
  The repository-default isolated path `/volume2/SSD/codex/Temp/codex-dev-home` could not be
  created in this container, so `/tmp/codex-web-smoke-home` was used and explicitly passed to
  the child process.
- `pnpm run test`: 1048 passed, 4 failed. The failures are in untouched proxy/auth tests
  (`src/codex-web/tests/proxy.test.ts` and `src/codex-web/tests/web-auth-route-wiring.test.ts`)
  and reproduce in isolation; they are not caused by the push changes. Therefore this plan
  does not claim the full suite passes.
- `./gradlew testDebugUnitTest assembleRelease`: passed; release APK built.
- Merged Android manifest contains `POST_NOTIFICATIONS` and the
  `org.unifiedpush.android.connector.PUSH_EVENT` service action.
- A headless API 35 emulator completed a software-only boot, but the package/activity services
  became unstable and the app launch ANRed. Visual Notifications-dialog verification could not
  be completed in this environment.
- No live UnifiedPush/Mozilla Push delivery was performed; that requires a distributor, push
  service, and working Android runtime.

## Checklist

- [x] codex-web push event filter and notification service
- [x] bridge and runtime broker subscription routing
- [x] codex-web targeted unit and integration tests
- [x] Android UnifiedPush connector, receiver service, and notification rendering
- [x] Android notification settings/distributor selection
- [x] Android tests and release build
- [x] Documentation and handover notes
- [ ] Live end-to-end push delivery on a working Android device (environment unavailable)
