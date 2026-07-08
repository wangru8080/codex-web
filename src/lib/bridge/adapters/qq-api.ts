/**
 * QQ Bot HTTP/WS protocol helpers.
 *
 * Handles:
 * - AppAccessToken acquisition and refresh
 * - WebSocket Gateway URL discovery
 * - Heartbeat management
 * - Private message sending (passive reply)
 * - msg_seq auto-increment per reply chain
 *
 * No business logic here — pure QQ protocol layer.
 */

import WebSocket from 'ws';

// ── Token Management ────────────────────────────────────────

interface AccessTokenResponse {
  access_token: string;
  expires_in: number; // seconds
}

interface TokenState {
  token: string;
  expiresAt: number; // epoch ms
}

let tokenState: TokenState | null = null;

/**
 * Get a valid access token, refreshing if necessary.
 * Uses POST https://bots.qq.com/app/getAppAccessToken
 */
export async function getAccessToken(appId: string, clientSecret: string): Promise<string> {
  if (tokenState && Date.now() < tokenState.expiresAt - 60_000) {
    return tokenState.token;
  }

  const res = await fetch('https://bots.qq.com/app/getAppAccessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId, clientSecret }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`QQ token request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as AccessTokenResponse;
  if (!data.access_token) {
    throw new Error('QQ token response missing access_token');
  }

  tokenState = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return tokenState.token;
}

/** Clear cached token (e.g. on credential change). */
export function clearTokenCache(): void {
  tokenState = null;
}

// ── Gateway ─────────────────────────────────────────────────

/**
 * Get the WebSocket Gateway URL.
 * GET https://api.sgroup.qq.com/gateway
 */
export async function getGatewayUrl(accessToken: string): Promise<string> {
  const res = await fetch('https://api.sgroup.qq.com/gateway', {
    method: 'GET',
    headers: { Authorization: `QQBot ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`QQ gateway request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { url: string };
  if (!data.url) {
    throw new Error('QQ gateway response missing url');
  }

  return data.url;
}

// ── WebSocket Protocol ──────────────────────────────────────

/** QQ Gateway opcodes */
export const OP = {
  DISPATCH: 0,        // Receive — server dispatches an event
  HEARTBEAT: 1,       // Send/Receive
  IDENTIFY: 2,        // Send — identify after Hello
  RESUME: 6,          // Send — resume a disconnected session
  RECONNECT: 7,       // Receive — server asks client to reconnect
  INVALID_SESSION: 9, // Receive — session is invalid
  HELLO: 10,          // Receive — first message after connect, contains heartbeat_interval
  HEARTBEAT_ACK: 11,  // Receive — heartbeat acknowledged
} as const;

export interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number;  // sequence number (only for op=0)
  t?: string;  // event name (only for op=0)
}

/** Build an Identify payload. */
export function buildIdentify(token: string, intents: number): GatewayPayload {
  return {
    op: OP.IDENTIFY,
    d: {
      token: `QQBot ${token}`,
      intents,
      shard: [0, 1],
    },
  };
}

/** Build a Heartbeat payload. */
export function buildHeartbeat(lastSequence: number | null): GatewayPayload {
  return {
    op: OP.HEARTBEAT,
    d: lastSequence,
  };
}

/** Build a Resume payload. */
export function buildResume(token: string, sessionId: string, seq: number): GatewayPayload {
  return {
    op: OP.RESUME,
    d: {
      token: `QQBot ${token}`,
      session_id: sessionId,
      seq,
    },
  };
}

/**
 * QQ Bot intents for C2C (private) messages.
 * PUBLIC_MESSAGES = 1 << 25 covers C2C_MESSAGE_CREATE.
 */
export const INTENTS = {
  PUBLIC_MESSAGES: 1 << 25,
} as const;

// ── Message Sending ─────────────────────────────────────────

/** Auto-incrementing msg_seq counter per reply chain. */
const msgSeqCounters = new Map<string, number>();

/** Get the next msg_seq for a given inbound message ID. */
export function nextMsgSeq(inboundMsgId: string): number {
  const current = msgSeqCounters.get(inboundMsgId) || 0;
  const next = current + 1;
  msgSeqCounters.set(inboundMsgId, next);
  // Clean up old entries (keep last 500)
  if (msgSeqCounters.size > 500) {
    const keys = Array.from(msgSeqCounters.keys());
    for (let i = 0; i < keys.length - 500; i++) {
      msgSeqCounters.delete(keys[i]);
    }
  }
  return next;
}

export interface QQSendMessageParams {
  openid: string;
  content: string;
  msgId: string;      // inbound message ID for passive reply
  msgSeq: number;
}

/**
 * Send a private text message (passive reply).
 * POST /v2/users/{openid}/messages
 */
export async function sendPrivateMessage(
  accessToken: string,
  params: QQSendMessageParams,
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const url = `https://api.sgroup.qq.com/v2/users/${params.openid}/messages`;

  const body = {
    content: params.content,
    msg_type: 0, // plain text
    msg_id: params.msgId,
    msg_seq: params.msgSeq,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `QQBot ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `QQ send failed: ${res.status} ${text}` };
    }

    const data = (await res.json()) as { id?: string };
    return { ok: true, messageId: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
