# Bridge WebSocket disconnect diagnostics

## Objective

Make future Android/browser WebSocket drops diagnosable from production logs without exposing credentials.

## Findings

- Production bridge PID `105840` and app-server PID `105852` started together on 2026-10-31 12:32 UTC.
- The app-server remained alive during inspection; its SQLite diagnostics contained no process restart or socket transport failure.
- Journal output for the bridge contained startup lines only.
- The legacy bridge had no connect/disconnect logging, so historical client drops cannot be attributed to a close code, reason, or lifetime after the fact.
- Conclusion: the observed drop was in the WebSocket/network/client path, not an app-server crash. The missing client-side heartbeat and reconnect loop explain why the Android app stayed disconnected.

## Implementation

- [x] Added `observeBridgeSocket` for both legacy and runtime-broker bridges.
- [x] Log peer address, user agent, close code, close reason, socket error, and connection duration.
- [x] Do not log request URLs, tokens, cookies, or authorization headers.
- [x] Log unexpected app-server runtime closure and captured stderr diagnostics.

## Verification

- `pnpm run typecheck` passed.
- Bridge-focused Vitest: 4 files, 13 tests passed.
- Unit test verifies close code/reason/duration formatting and absence of `token=` in logs.
- Full `pnpm run test` still has four unrelated auth/proxy failures: three `NextResponse.json is not a function` mock failures and one unexpected 307. No bridge test fails.

## Operational note

The running production process must be restarted or deployed from the rebuilt output before these close diagnostics appear in live logs. It was intentionally not restarted during this change.
