/**
 * Feishu App Registration via Device Flow.
 *
 * Uses the same API as Feishu's official CLI (`lark-cli config init`):
 * POST accounts.feishu.cn/oauth/v1/app/registration with archetype=PersonalAgent.
 *
 * The PersonalAgent archetype auto-configures Bot capability, IM scopes,
 * event subscriptions (im.message.receive_v1, card.action.trigger), and
 * long-connection mode — no manual setup needed (verified by POC 2026-04-13).
 *
 * Session state is stored in globalThis to survive Next.js HMR.
 */

import { setSetting } from '@/lib/db';

// ── Types ────────────────────────────────────────────────────────

export type RegistrationErrorCode =
  | 'timeout'
  | 'user_denied'
  | 'empty_credentials'
  | 'lark_empty_credentials'
  | 'unknown';

export interface FeishuRegistrationSession {
  deviceCode: string;
  verificationUrl: string;
  startedAt: number;
  interval: number;
  expiresAt: number;
  status: 'waiting' | 'completed' | 'expired' | 'failed';
  appId?: string;
  appSecret?: string;
  domain?: 'feishu' | 'lark';
  errorCode?: RegistrationErrorCode;
  errorDetail?: string;
}

interface RegistrationBeginResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface RegistrationPollResponse {
  client_id?: string;
  client_secret?: string;
  user_info?: { open_id: string; tenant_brand: string };
  error?: string;
}

// ── Constants ────────────────────────────────────────────────────

const FEISHU_ACCOUNTS = 'https://accounts.feishu.cn';
const LARK_ACCOUNTS = 'https://accounts.larksuite.com';
const REGISTRATION_PATH = '/oauth/v1/app/registration';
const MAX_INTERVAL_MS = 60_000;
const SESSION_CLEANUP_MS = 10 * 60_000; // 10 minutes

// ── Session storage (globalThis, survives HMR) ───────────────────

const GLOBAL_KEY = '__feishu_registration_sessions__';

function getSessions(): Map<string, FeishuRegistrationSession> {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map<string, FeishuRegistrationSession>();
  return g[GLOBAL_KEY] as Map<string, FeishuRegistrationSession>;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Start a new app registration session.
 * Returns sessionId + verificationUrl for the frontend to open in a browser.
 */
export async function startRegistration(): Promise<{ sessionId: string; verificationUrl: string }> {
  const res = await fetch(`${FEISHU_ACCOUNTS}${REGISTRATION_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'action=begin&archetype=PersonalAgent&auth_method=client_secret&request_user_info=open_id+tenant_brand',
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`Registration API returned ${res.status}`);

  const data: RegistrationBeginResponse = await res.json();
  if (!data.device_code || !data.verification_uri_complete) {
    throw new Error('Invalid registration response: missing device_code or verification_uri');
  }

  const sessionId = `feishu_reg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const session: FeishuRegistrationSession = {
    deviceCode: data.device_code,
    verificationUrl: data.verification_uri_complete,
    startedAt: Date.now(),
    interval: (data.interval || 5) * 1000,
    expiresAt: Date.now() + (data.expires_in || 300) * 1000,
    status: 'waiting',
  };

  const sessions = getSessions();
  sessions.set(sessionId, session);

  // Auto-cleanup after TTL. unref() so the timer doesn't block Node from
  // exiting — in production the process is long-lived so this is a no-op,
  // but in tests each session would otherwise keep the event loop alive
  // for the full 10 minutes.
  setTimeout(() => { sessions.delete(sessionId); }, SESSION_CLEANUP_MS).unref();

  return { sessionId, verificationUrl: data.verification_uri_complete };
}

/**
 * Poll a registration session for completion.
 * On success, writes credentials to the DB automatically.
 */
export async function pollRegistration(sessionId: string): Promise<FeishuRegistrationSession> {
  const sessions = getSessions();
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Session not found');
  if (session.status !== 'waiting') return session;

  // Check expiration
  if (Date.now() > session.expiresAt) {
    session.status = 'expired';
    session.errorCode = 'timeout';
    return session;
  }

  // Use lark endpoint if previously detected as lark tenant
  const accountsBase = session.domain === 'lark' ? LARK_ACCOUNTS : FEISHU_ACCOUNTS;
  const result = await doPoll(accountsBase, session.deviceCode);

  if (result.error === 'authorization_pending') {
    return session; // still waiting
  }

  if (result.error === 'slow_down') {
    session.interval = Math.min(session.interval + 5000, MAX_INTERVAL_MS);
    return session;
  }

  if (result.error === 'access_denied') {
    session.status = 'failed';
    session.errorCode = 'user_denied';
    return session;
  }

  if (result.error === 'expired_token') {
    session.status = 'expired';
    session.errorCode = 'timeout';
    return session;
  }

  if (result.error) {
    session.status = 'failed';
    session.errorCode = 'unknown';
    session.errorDetail = result.error;
    return session;
  }

  // Success — check if we need Lark retry
  let clientId = result.client_id || '';
  let clientSecret = result.client_secret || '';
  let domain: 'feishu' | 'lark' = 'feishu';

  if (!clientSecret && result.user_info?.tenant_brand === 'lark') {
    // Lark tenant — switch to lark endpoint and keep polling until success/failure,
    // matching the official CLI behavior (full retry loop, not single shot).
    session.domain = 'lark';
    const larkResult = await doPoll(LARK_ACCOUNTS, session.deviceCode);
    if (larkResult.error === 'authorization_pending' || larkResult.error === 'slow_down') {
      // Still pending on Lark side — let the next pollRegistration call retry
      if (larkResult.error === 'slow_down') {
        session.interval = Math.min(session.interval + 5000, MAX_INTERVAL_MS);
      }
      return session;
    }
    if (larkResult.client_id && larkResult.client_secret) {
      clientId = larkResult.client_id;
      clientSecret = larkResult.client_secret;
      domain = 'lark';
    } else {
      session.status = 'failed';
      session.errorCode = 'lark_empty_credentials';
      session.errorDetail = larkResult.error || undefined;
      return session;
    }
  }

  if (!clientId || !clientSecret) {
    session.status = 'failed';
    session.errorCode = 'empty_credentials';
    return session;
  }

  // Write credentials to DB
  setSetting('bridge_feishu_app_id', clientId);
  setSetting('bridge_feishu_app_secret', clientSecret);
  setSetting('bridge_feishu_domain', domain);

  session.status = 'completed';
  session.appId = clientId;
  session.appSecret = clientSecret;
  session.domain = domain;

  return session;
}

/**
 * Cancel and remove a registration session.
 */
export function cancelRegistration(sessionId: string): void {
  getSessions().delete(sessionId);
}

/**
 * Get current session state without polling.
 */
export function getRegistrationSession(sessionId: string): FeishuRegistrationSession | null {
  return getSessions().get(sessionId) || null;
}

// ── Internal ─────────────────────────────────────────────────────

async function doPoll(accountsBase: string, deviceCode: string): Promise<RegistrationPollResponse> {
  const res = await fetch(`${accountsBase}${REGISTRATION_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `action=poll&device_code=${encodeURIComponent(deviceCode)}`,
    signal: AbortSignal.timeout(15_000),
  });

  // Always parse body — Device Flow returns HTTP 400 for authorization_pending/slow_down,
  // which is standard behavior, not a real error. The error field in the body tells us what to do.
  try {
    return await res.json();
  } catch {
    return { error: `HTTP ${res.status}` };
  }
}
