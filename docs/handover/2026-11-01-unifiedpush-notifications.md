# UnifiedPush notifications handover

Cross-link: Android counterpart at `codex-web-android/docs/handover/2026-11-01-unifiedpush-notifications.md`.

## Behavior

Codex Web sends encrypted Web Push messages to UnifiedPush endpoints for a small, explicit set of app-server events:

- `turn/completed` with status `completed` or `failed`;
- `thread/goal/updated` when the previous status was not `complete` and the new status is `complete`;
- approval server requests, including command, file-change, and permission approvals;
- `item/tool/requestUserInput` and `mcpServer/elicitation/request` questions.

Deltas, ordinary agent messages, interrupted Turns, and plain idle `thread/status/changed` notifications are ignored. Deduplication keys are bounded in memory and keyed by Turn/status, goal/thread, or server-request method/ID.

## Server design

- `server/push-app-server-events.ts` maps protocol messages to typed notification payloads.
- `server/push-notifications.ts` owns persistent subscriptions, VAPID keys, endpoint validation, deduplication, delivery, and stale-subscription removal.
- `server/persistent-app-server.ts` reports notifications and server requests to the observer.
- `server/websocket-bridge.ts` serves `codexWeb/push/config`, `codexWeb/push/register`, and `codexWeb/push/unregister` for the single-user bridge.
- `server/user-runtime-registry.ts` serves the same methods with the broker-authenticated user identity and forwards that user's app-server events to the push service.

Push state is stored at `${CODEX_WEB_STATE || ~/.codex-web}/push.json` with directory mode `0700` and file mode `0600`.

## Payload contract

```json
{
  "version": 1,
  "kind": "turn_completed",
  "title": "Thread name finished",
  "body": "Final agent message",
  "threadId": "thread-id",
  "turnId": "turn-id",
  "requestId": null,
  "source": "app-server.turn/completed",
  "createdAt": 1760000000000
}
```

Supported `kind` values are `turn_completed`, `turn_failed`, `goal_completed`, `approval_required`, `question_required`, and `test`. A `test` payload is sent for a new endpoint or encryption-key set so the client can verify the complete delivery path before reporting notifications as ready. Registration is idempotent for an unchanged reconnect: a successful test records `testDeliveredAt` in `push.json`, and subsequent identical `codexWeb/push/register` calls return `testNotification.sent: false` without sending another push. Failed tests are not marked and are retried on the next registration; a changed endpoint or key set also receives a new test.

## Operations

- VAPID keys are generated once and persisted when both `CODEX_WEB_PUSH_VAPID_PUBLIC_KEY` and `CODEX_WEB_PUSH_VAPID_PRIVATE_KEY` are unset.
- If supplied through environment variables, both keys must be present and must remain stable across restarts.
- `CODEX_WEB_PUSH_VAPID_SUBJECT` overrides the default repository HTTPS subject.
- Endpoints require HTTPS, cannot contain credentials, and must resolve to public addresses. The HTTPS agent repeats the DNS check at connection time to reduce rebinding risk. Its lookup must honor Node's `options.all` contract and return an address array; returning a single address for `all: true` fails locally with `ERR_INVALID_IP_ADDRESS` before any push request is sent.
- `CODEX_WEB_PUSH_ALLOW_INSECURE_ENDPOINTS=1` is test-only.
- Web Push TTL is 24 hours, so an offline device can receive a notification after reconnecting.

## Verification

- `pnpm exec vitest run server/tests/push-app-server-events.test.ts server/tests/push-notifications.test.ts server/tests/push-transport.test.ts server/tests/websocket-bridge.test.ts server/tests/user-runtime-registry.test.ts`
- `pnpm run typecheck`
- `pnpm run build`

A live delivery test requires a UnifiedPush distributor, a reachable push service, and a physical or emulated Android device. That environment was not available for the implementation run; do not claim end-to-end delivery without it.
