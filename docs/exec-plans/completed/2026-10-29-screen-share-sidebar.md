# Screen Share Sidebar (Host Desktop via x11vnc) Implementation Plan

Status: Code complete; Tests pass; Smoke passed; Review passed

Related: [2026-08-16-terminal-sidebar.md](../completed/2026-08-16-terminal-sidebar.md), [2026-08-17-terminal-process-lifecycle-hardening.md](../completed/2026-08-17-terminal-process-lifecycle-hardening.md), [2026-10-29-screen-share-channel-exception.md](../../insights/2026-10-29-screen-share-channel-exception.md), [2026-10-29-screen-share-sidebar.md](../../handover/2026-10-29-screen-share-sidebar.md)

**Goal:** Add a closable `screen-pinned` tab in the right workspace sidebar that shows and fully controls the desktop of the host running codex-web, via a bridge-managed `x11vnc` and an in-browser noVNC client, mirroring the terminal's lifecycle and isolation.

**Architecture:**

```text
Browser (iframe /workspace/screen, noVNC, RFB security "None")
  | binary WebSocket /screen-share/ws (same token + Origin + web-auth checks as JSON-RPC bridge)
  v
Web bridge ScreenShareManager
  | terminates RFB VNC-auth with one-time password, then byte-pipes
  v
x11vnc -localhost (spawned per session, loopback-only, random port)
  |
  v
X11 display ($CODEX_WEB_SCREEN_SHARE_DISPLAY or $DISPLAY)
```

> [!WARNING]
> This is a deliberate exception to "app-server is the only runtime channel": screen share is a bridge-owned channel that does **not** go through `codex app-server`. Recorded product rationale in `docs/insights/2026-10-29-screen-share-channel-exception.md`. It must never be used for Codex thread/turn state.

## Decision Log (from /grill-me)

| # | Decision | Notes |
|---|----------|-------|
| 1 | Share the **app-server host desktop → browser** | Direct counterpart of the terminal |
| 2 | Transport: **bridge-side VNC proxy + noVNC** | Not via `process/*` |
| 3 | **Legacy single-user mode only**; never in multi-user broker mode | Host has one physical desktop; broker per-OS-user isolation must not be bypassed |
| 4 | **Full control always on** (keyboard + mouse), like the terminal | No view-only mode |
| 5 | **Bridge spawns x11vnc** per session, kills it on close | |
| 6 | **Linux X11 only** for v1; macOS/Windows/Wayland → `unsupported: <reason>` | |
| 7 | **Bridge terminates RFB auth** with a per-launch one-time password; browser gets security type None on a dedicated binary WS | Password never leaves the server |
| 8 | **Exactly one session** per bridge; no reconnect grace | |
| 9 | Second client → visible "already active" error + **Take over** button | Old tab shows "taken over" |
| 10 | **No clipboard sync** | Bridge drops ClientCutText/ServerCutText; x11vnc `-noclipboard -nosetclipboard` |
| 11 | Enable with `CODEX_WEB_SCREEN_SHARE=1` / `codex-web serve --screen-share`; display from `CODEX_WEB_SCREEN_SHARE_DISPLAY` → `DISPLAY`; binary from `CODEX_WEB_X11VNC_PATH` → PATH | Tab hidden when flag off |
| 12 | Remote access **follows existing `allowRemoteConnections`** policy | No separate remote flag (user choice; see risks) |
| 13 | UI mirrors terminal: iframe, scale-to-fit, `resizeSession` off, status line, pop-out, "Screen shared" indicator | |
| 14 | Content-free audit log lines on bridge stderr | |
| 15 | Unit tests + Linux smoke; macOS smoke checks unsupported path only | |

## Global Constraints

- Default test env `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home` (screen share doesn't read it, but the dev server/smoke do).
- Don't modify `~/code/codex`. No browser-supplied host, port, display, or argv. Ever.
- No shell: `spawn(x11vncPath, argv, { shell: false })` with fixed argv.
- No fake statuses: resolution, connected state, and unsupported reasons come from RFB ServerInit / probe / process events.
- Capped, low-noise logging; never log keystrokes, pointer events, or frame data.

---

### Task 0: POC (outside the main codebase)

- [x] Verify `@novnc/novnc` (latest 1.7.x) works with this Next.js build (dynamic import inside client component).
- [x] Verify x11vnc flags: `-localhost -rfbport <p> -once -passwdfile rm:<file> -noclipboard -nosetclipboard -nossl -noxdamage -display <d>`.
- [x] Verified pure-JS DES ECB (`des.js`) for VNC auth challenge response to bypass Node 17+ OpenSSL 3 digital envelope routine limitations.

### Task 1: Server config + capability probe

**Files:** `server/screen-share/config.ts`, `server/screen-share/probe.ts`, `server/screen-share/types.ts`, `src/app/api/codex/screen-share/route.ts`, tests.

- [x] Resolve `enabled` (env/CLI), `display`, `x11vncPath`, and force `enabled=false` in broker/multi-user mode.
- [x] Probe → `{ status: 'disabled' } | { status: 'unsupported', reason } | { status: 'available', display }`. Reasons: non-Linux platform, no display, Wayland without DISPLAY, x11vnc not found/not executable.
- [x] Expose probe via authenticated endpoint `GET /api/codex/screen-share`.

### Task 2: x11vnc launcher

**Files:** `server/screen-share/x11vnc.ts`, `server/tests/screen-share-x11vnc.test.ts`.

- [x] Generate an 8-byte random VNC password and write to `0600` temp file in `0700` temp dir, passed as `-passwdfile rm:<path>`.
- [x] Find free loopback port, pass `-rfbport`.
- [x] Fixed argv builder (unit-tested). Minimal env: `DISPLAY`, `XAUTHORITY`, `PATH`, `HOME`.
- [x] Spawn detached in its own process group; kill = SIGTERM, fallback SIGKILL after 3s. Capped output buffer for diagnostics.

### Task 3: RFB auth-terminating proxy

**Files:** `server/screen-share/rfb-proxy.ts`, `server/tests/screen-share-rfb-proxy.test.ts`.

- [x] Upstream: RFB 3.8 version exchange, select type 2 (VNC auth), DES-encrypt challenge with bit-reversed key, verify SecurityResult OK.
- [x] Downstream: send `RFB 003.008`, offer type 1 (None), send SecurityResult OK, parse ServerInit resolution, pipe bytes.
- [x] Client message filter: drop `ClientCutText` (type 6).
- [x] Backpressure handling between TCP socket and WebSocket.

### Task 4: ScreenShareManager (single session + takeover) and WS endpoint

**Files:** `server/screen-share/manager.ts`, `server/websocket-bridge.ts`, `server/tests/screen-share-manager.test.ts`, `server/tests/websocket-bridge-screen-share.test.ts`.

- [x] Upgrade path reuses `validateBridgeRequest` (token, Origin, remote connection checks -> 401/403).
- [x] State machine: `idle → starting → active → stopping → idle`. Second connect -> `4002 already-active` or `takeover=1` -> disconnects old with `4001 taken-over` and takes over.
- [x] Stop on WS close, x11vnc exit, proxy error, bridge shutdown.
- [x] Low-noise single-line audit logs on bridge stderr.

### Task 5: Frontend tab + iframe

**Files:** `src/lib/workspace-sidebar.ts`, `TabBar.tsx`, `TabPanel.tsx`, `WorkspaceSidebar/ScreenSharePanel.tsx`, `WorkspaceSidebar/ScreenShareFrame.tsx`, `screen-share-frame-protocol.ts`, `src/app/workspace/screen/page.tsx`, i18n `en.ts`/`zh.ts`.

- [x] `screen-pinned` closable tab + overview/plus-menu entry.
- [x] Panel shows probe `unsupported: <reason>` verbatim; otherwise mounts iframe.
- [x] Frame: noVNC `RFB` with `scaleViewport=true`, `resizeSession=false`, `viewOnly=false`, clipboard handlers disabled.
- [x] Status line with `data-source-breadcrumb="bridge.screen-share/rfb-serverinit"`, Pop-out button, overlay for takeover/already-active.
- [x] Closing tab closes WS (which kills x11vnc server-side).

### Task 6: Verification and docs

- [x] Unit tests for config, probe, x11vnc argv/lifecycle, RFB proxy/filter, manager/takeover, WS security parity, sidebar store/wiring.
- [x] `pnpm run test:smoke:screen-share`: verifies flag off, broker disable, darwin detection, Linux without DISPLAY, 401/403 security, single-session rejection, takeover, process termination.
- [x] `pnpm run typecheck` and `pnpm run build` pass.
- [x] Handover doc `docs/handover/2026-10-29-screen-share-sidebar.md`, insight doc `docs/insights/2026-10-29-screen-share-channel-exception.md`, and updated `package.json`.
