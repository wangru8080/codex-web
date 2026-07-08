/**
 * WeChat QR code login flow.
 *
 * Manages QR code generation, status polling, and credential persistence.
 * Active login sessions are stored in globalThis to survive Next.js HMR.
 */

import QRCode from 'qrcode';
import { startLoginQr, pollLoginQrStatus } from './weixin-api';
import { upsertWeixinAccount } from '../../../db';
import type { QrCodeStatusResponse } from './weixin-types';
import { DEFAULT_BASE_URL, DEFAULT_CDN_BASE_URL } from './weixin-types';

export interface QrLoginSession {
  qrcode: string;
  qrImage: string; // base64
  startedAt: number;
  refreshCount: number;
  status: 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'failed';
  accountId?: string;
  error?: string;
}

const MAX_REFRESHES = 3;
const QR_TTL_MS = 5 * 60_000;

// Use globalThis to store active login sessions, surviving HMR
const GLOBAL_KEY = '__weixin_login_sessions__';

function getLoginSessions(): Map<string, QrLoginSession> {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map<string, QrLoginSession>();
  }
  return g[GLOBAL_KEY] as Map<string, QrLoginSession>;
}

/**
 * Start a new QR login session.
 * Returns a session ID that can be used to poll status.
 */
export async function startQrLoginSession(): Promise<{ sessionId: string; qrImage: string }> {
  const resp = await startLoginQr();

  if (!resp.qrcode || !resp.qrcode_img_content) {
    throw new Error('Failed to get QR code from WeChat server');
  }

  // qrcode_img_content is a URL, generate a data URL for the frontend
  const qrDataUrl = await QRCode.toDataURL(resp.qrcode_img_content, { width: 256, margin: 2 });

  const sessionId = `qr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const session: QrLoginSession = {
    qrcode: resp.qrcode,
    qrImage: qrDataUrl,
    startedAt: Date.now(),
    refreshCount: 0,
    status: 'waiting',
  };

  getLoginSessions().set(sessionId, session);

  // Auto-cleanup after 10 minutes
  setTimeout(() => {
    getLoginSessions().delete(sessionId);
  }, 10 * 60_000);

  return { sessionId, qrImage: qrDataUrl };
}

/**
 * Poll the status of a QR login session.
 */
export async function pollQrLoginStatus(sessionId: string): Promise<QrLoginSession> {
  const sessions = getLoginSessions();
  const session = sessions.get(sessionId);
  if (!session) {
    return { qrcode: '', qrImage: '', startedAt: 0, refreshCount: 0, status: 'failed', error: 'Session not found' };
  }

  if (session.status === 'confirmed' || session.status === 'failed') {
    return session;
  }

  // Check if QR has expired (5 minutes)
  if (Date.now() - session.startedAt > QR_TTL_MS) {
    if (session.refreshCount >= MAX_REFRESHES) {
      session.status = 'failed';
      session.error = 'QR code expired after maximum refreshes';
      return session;
    }

    // Refresh QR code
    try {
      const resp = await startLoginQr();
      if (resp.qrcode && resp.qrcode_img_content) {
        session.qrcode = resp.qrcode;
        session.qrImage = await QRCode.toDataURL(resp.qrcode_img_content, { width: 256, margin: 2 });
        session.startedAt = Date.now();
        session.refreshCount++;
        session.status = 'waiting';
      }
    } catch (err) {
      session.status = 'failed';
      session.error = `QR refresh failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    return session;
  }

  // Poll WeChat server for QR status
  try {
    const resp: QrCodeStatusResponse = await pollLoginQrStatus(session.qrcode);

    switch (resp.status) {
      case 'wait':
        session.status = 'waiting';
        break;

      case 'scaned':
        session.status = 'scanned';
        break;

      case 'confirmed': {
        session.status = 'confirmed';

        if (resp.bot_token && resp.ilink_bot_id) {
          // Normalize account ID (replace unsafe chars)
          const accountId = (resp.ilink_bot_id || '').replace(/[@.]/g, '-');
          session.accountId = accountId;

          // Persist to database
          upsertWeixinAccount({
            accountId,
            userId: resp.ilink_user_id || '',
            baseUrl: resp.baseurl || DEFAULT_BASE_URL,
            cdnBaseUrl: DEFAULT_CDN_BASE_URL,
            token: resp.bot_token,
            name: accountId,
            enabled: true,
          });

          console.log(`[weixin-auth] Login successful, account ${accountId} saved`);
        }
        break;
      }

      case 'expired':
        session.status = 'expired';
        // Will be refreshed on next poll
        session.startedAt = 0; // Force refresh on next poll
        break;

      default:
        // Unknown status — keep waiting
        break;
    }
  } catch (err) {
    // Timeout on poll is normal — just return current status
    if (err instanceof Error && err.name === 'TimeoutError') {
      return session;
    }
    console.error(`[weixin-auth] Poll error:`, err);
  }

  return session;
}

/**
 * Cancel and cleanup a login session.
 */
export function cancelQrLoginSession(sessionId: string): void {
  getLoginSessions().delete(sessionId);
}
