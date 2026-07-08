/**
 * WeChat HTTP protocol client.
 *
 * Pure protocol layer — no business logic or state management.
 * Derived from OpenClaw weixin plugin reference (protocol only, not runtime dependency).
 */

import crypto from 'crypto';
import type {
  WeixinCredentials,
  GetUpdatesResponse,
  GetUploadUrlResponse,
  GetConfigResponse,
  MessageItem,
  QrCodeStartResponse,
  QrCodeStatusResponse,
} from './weixin-types';
import {
  DEFAULT_BASE_URL,
  MessageType,
  MessageState,
  MessageItemType,
} from './weixin-types';

const CHANNEL_VERSION = 'codepilot-weixin-bridge/1.0';
const LONG_POLL_TIMEOUT_MS = 35_000;
const API_TIMEOUT_MS = 15_000;
const CONFIG_TIMEOUT_MS = 10_000;

/**
 * Generate X-WECHAT-UIN header value: random uint32 encoded as base64.
 */
function generateWechatUin(): string {
  const buf = crypto.randomBytes(4);
  return buf.toString('base64');
}

/**
 * Build auth headers for WeChat ilink bot API.
 */
function buildHeaders(creds: WeixinCredentials, routeTag?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'Authorization': `Bearer ${creds.botToken}`,
    'X-WECHAT-UIN': generateWechatUin(),
  };
  if (routeTag) {
    headers['SKRouteTag'] = routeTag;
  }
  return headers;
}

/**
 * Core HTTP request helper.
 */
async function weixinRequest<T>(
  creds: WeixinCredentials,
  endpoint: string,
  body: unknown,
  timeoutMs: number = API_TIMEOUT_MS,
  routeTag?: string,
): Promise<T> {
  const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;
  const url = `${baseUrl}/ilink/bot/${endpoint}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(creds, routeTag),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`WeChat API error: ${res.status} ${res.statusText}`);
  }

  const rawText = await res.text();
  if (!rawText.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(rawText) as T;
  } catch (err) {
    throw new Error(
      `WeChat API returned non-JSON body for ${endpoint}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Long-poll for updates.
 */
export async function getUpdates(
  creds: WeixinCredentials,
  getUpdatesBuf: string,
  timeoutMs: number = LONG_POLL_TIMEOUT_MS,
): Promise<GetUpdatesResponse> {
  try {
    return await weixinRequest<GetUpdatesResponse>(
      creds,
      'getupdates',
      {
        get_updates_buf: getUpdatesBuf ?? '',
        base_info: { channel_version: CHANNEL_VERSION },
      },
      timeoutMs + 5_000, // client timeout slightly longer than server timeout
    );
  } catch (err) {
    // Timeout is normal for long-polling — return empty response
    if (err instanceof Error && err.name === 'TimeoutError') {
      return { msgs: [], get_updates_buf: getUpdatesBuf };
    }
    throw err;
  }
}

/**
 * Generate a unique client_id for outbound messages.
 */
function generateClientId(): string {
  return `codepilot-wx-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Send a message using the correct protocol structure.
 * Body: { msg: WeixinMessage, base_info }
 * Returns the local client_id as messageId (server response is empty).
 */
export async function sendMessage(
  creds: WeixinCredentials,
  toUserId: string,
  items: MessageItem[],
  contextToken: string,
): Promise<{ clientId: string }> {
  const clientId = generateClientId();
  await weixinRequest<Record<string, unknown>>(creds, 'sendmessage', {
    msg: {
      from_user_id: '',
      to_user_id: toUserId,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: items.length > 0 ? items : undefined,
      context_token: contextToken || undefined,
    },
    base_info: { channel_version: CHANNEL_VERSION },
  });
  return { clientId };
}

/**
 * Send a text message (convenience wrapper).
 */
export async function sendTextMessage(
  creds: WeixinCredentials,
  toUserId: string,
  text: string,
  contextToken: string,
): Promise<{ clientId: string }> {
  return sendMessage(creds, toUserId, [
    { type: MessageItemType.TEXT, text_item: { text } },
  ], contextToken);
}

/**
 * Get CDN upload URL.
 */
export async function getUploadUrl(
  creds: WeixinCredentials,
  fileKey: string,
  fileType: number,
  fileSize: number,
  fileMd5: string,
  cipherFileSize: number,
): Promise<GetUploadUrlResponse> {
  return weixinRequest<GetUploadUrlResponse>(creds, 'getuploadurl', {
    file_key: fileKey,
    file_type: fileType,
    file_size: fileSize,
    file_md5: fileMd5,
    cipher_file_size: cipherFileSize,
  });
}

/**
 * Get account configuration (typing ticket, route tag, etc.).
 * Requires ilink_user_id + context_token per reference implementation.
 */
export async function getConfig(
  creds: WeixinCredentials,
  ilinkUserId?: string,
  contextToken?: string,
): Promise<GetConfigResponse> {
  return weixinRequest<GetConfigResponse>(
    creds,
    'getconfig',
    {
      ilink_user_id: ilinkUserId,
      context_token: contextToken,
      base_info: { channel_version: CHANNEL_VERSION },
    },
    CONFIG_TIMEOUT_MS,
  );
}

/**
 * Send typing indicator.
 * Uses ilink_user_id + typing_ticket + status per reference implementation.
 */
export async function sendTyping(
  creds: WeixinCredentials,
  ilinkUserId: string,
  typingTicket: string,
  typingStatus: number,
): Promise<void> {
  try {
    await weixinRequest<Record<string, unknown>>(
      creds,
      'sendtyping',
      {
        ilink_user_id: ilinkUserId,
        typing_ticket: typingTicket,
        status: typingStatus,
        base_info: { channel_version: CHANNEL_VERSION },
      },
      CONFIG_TIMEOUT_MS,
    );
  } catch {
    // Typing indicator is best-effort — never block the main flow
  }
}

// ── QR Login API ─────────────────────────────────────────────

const QR_LOGIN_BASE_URL = 'https://ilinkai.weixin.qq.com';
const QR_LOGIN_TIMEOUT_MS = 40_000;

/**
 * Start QR code login — returns base64 QR image and qrcode identifier.
 */
export async function startLoginQr(): Promise<QrCodeStartResponse> {
  const url = `${QR_LOGIN_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`;
  const res = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`QR login start failed: ${res.status}`);
  }
  return (await res.json()) as QrCodeStartResponse;
}

/**
 * Poll QR code login status.
 */
export async function pollLoginQrStatus(qrcode: string): Promise<QrCodeStatusResponse> {
  const url = `${QR_LOGIN_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  const res = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(QR_LOGIN_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`QR status poll failed: ${res.status}`);
  }
  return (await res.json()) as QrCodeStatusResponse;
}
