# Product Insight: Screen Share Bridge Channel Exception

Date: 2026-10-29
Author: Antigravity Assistant & Stefan
Related Plan: `docs/exec-plans/completed/2026-10-29-screen-share-sidebar.md`

## Context & The Architectural Rule

`AGENTS.md` states:
> "Codex Web has only one runtime: Codex app-server. Web UI state must originate from app-server requests, notifications, and server requests."

This rule exists to prevent ad-hoc custom execution backends that fragment state, duplicate session lifecycles, or create untracked side-channels.

## The Exception: Host Screen Share via RFB / x11vnc

During the `/grill-me` design session on 2026-10-29, the user required:
- Sharing and controlling the host desktop where Codex runs (the direct GUI equivalent of the PTY terminal).
- The official `codex app-server` currently provides `process/*` (spawning child shell processes with stdin/stdout/resize), but does not provide an RFB/VNC remote desktop server or graphical display streaming primitive.

We evaluated two technical routes:
1. **Piping video frames through app-server `process/*`**:
   Spawning a screen recording CLI (e.g. ffmpeg or screencapture) under `process/spawn`, encoding frames, base64-encoding them into JSON-RPC `process/outputDelta` notifications, and decoding them on a `<canvas>`.
   - *Pros:* Stays 100% inside `process/*`.
   - *Cons:* Base64 in JSON-RPC introduces huge overhead; frame rates are capped at ~1-5 fps; no bidirectional low-latency pointer/keyboard event channel without hacking stdin.
2. **Bridge-side VNC proxy to x11vnc with noVNC**:
   The Web bridge manages a local `x11vnc` instance and exposes a binary WebSocket `/screen-share/ws` using standard RFB framing with noVNC in the browser.
   - *Decision:* User explicitly chose Route 2.

## Guardrails & Boundaries

To ensure this bridge-side channel does not violate core security or architecture:
1. **Single-User / Legacy Mode Only**:
   The host has only one physical/display server session. In multi-user broker mode, exposing the desktop would allow one web user to view and control the session of another OS user. Therefore, `ScreenShareConfig` unconditionally forces `enabled: false` whenever `CODEX_WEB_RUNTIME_BROKER_SOCKET` is present.
2. **No Thread/Turn State Interference**:
   The screen-share channel carries only RFB graphical desktop data and keyboard/pointer input. It never carries Thread, Turn, Item, Goal, or Plan state.
3. **Bridge Security Parity**:
   The WebSocket `/screen-share/ws` applies the exact same security verification (`validateBridgeRequest`) as the primary JSON-RPC bridge: localhost/remote policy, Origin validation, and bearer token verification.
4. **Isolated Process Lifecycle**:
   `x11vnc` is spawned with `-localhost`, `-once`, a random loopback port, and a per-launch random 8-byte password written to a `0600` temp file. The bridge terminates the VNC authentication upstream so the secret never leaves the host. When the viewer disconnects or the tab closes, `x11vnc` is immediately killed.
5. **No Clipboard Sync**:
   `ClientCutText` messages from the client are dropped by the bridge filter, and `x11vnc` is launched with `-noclipboard -nosetclipboard`.
