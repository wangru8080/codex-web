# Bridge WebSocket disconnect diagnostics handover

## Behavior

Both `createWebSocketBridge()` and `createBrokerWebSocketBridge()` now emit one line per accepted client connection and one line when that client closes:

```text
[bridge] socket connected remote=<ip> userAgent="<ua>"
[bridge] socket closed remote=<ip> code=<code> reason="<reason>" durationMs=<ms>
```

Socket errors are logged with the peer and elapsed lifetime. App-server runtime closure logs its runtime kind, error, and the last five captured stderr diagnostics.

No bridge URL, token, cookie, authorization header, or request body is logged.

## Source

- `server/bridge-connection-diagnostics.ts`
- `server/websocket-bridge.ts`
- `server/broker-websocket-bridge.ts`
- `server/persistent-app-server.ts`
- `server/tests/bridge-connection-diagnostics.test.ts`

## Prior production inspection

The pre-change production bridge had run since 2026-10-31 12:32 UTC with a continuously live app-server child process. The app-server log database showed no restart or transport failure; the bridge emitted no per-client close event. This means the historical disconnect reason cannot be recovered from existing logs. The Android client now provides heartbeat and reconnect, and future drops will include code/reason/lifetime here.

## Deployment

Rebuild the production server and restart the production bridge to activate these logs. Restarting was not performed as part of this handover because the live process had active user threads.
