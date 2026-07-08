/**
 * QQ Adapter — implements BaseChannelAdapter for QQ Bot API.
 *
 * Uses WebSocket Gateway for real-time event subscription.
 * First version: private chat (C2C) only, text + image inbound,
 * text-only outbound (passive reply).
 *
 * No streaming preview — QQ passive reply window is tight and
 * each reply consumes quota.
 *
 * No inline buttons — permission handled via /perm text command.
 */

import WebSocket from 'ws';
import type {
  ChannelType,
  InboundMessage,
  OutboundMessage,
  SendResult,
} from '../types';
import type { FileAttachment } from '@/types';
import { BaseChannelAdapter, registerAdapterFactory } from '../channel-adapter';
import { getSetting, insertAuditLog } from '../../db';
import {
  getAccessToken,
  getGatewayUrl,
  clearTokenCache,
  sendPrivateMessage,
  nextMsgSeq,
  buildIdentify,
  buildHeartbeat,
  buildResume,
  OP,
  INTENTS,
  type GatewayPayload,
} from './qq-api';
import crypto from 'crypto';

/** Max number of message_ids to keep for dedup. */
const DEDUP_MAX = 1000;

/** Max file download size (20 MB). */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/** Shape of C2C_MESSAGE_CREATE event data. */
interface QQC2CMessageData {
  id: string;
  author: {
    user_openid: string;
  };
  content: string;
  timestamp: string;
  attachments?: Array<{
    content_type: string;
    filename?: string;
    url: string;
    size?: number;
  }>;
}

export class QQAdapter extends BaseChannelAdapter {
  readonly channelType: ChannelType = 'qq';

  private _running = false;
  private queue: InboundMessage[] = [];
  private waiters: Array<(msg: InboundMessage | null) => void> = [];
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastSequence: number | null = null;
  private sessionId: string | null = null;
  private seenMessageIds = new Map<string, boolean>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private shouldReconnect = false;

  // ── Lifecycle ───────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._running) return;

    const appId = getSetting('bridge_qq_app_id') || '';
    const appSecret = getSetting('bridge_qq_app_secret') || '';

    clearTokenCache();
    const token = await getAccessToken(appId, appSecret);
    const gatewayUrl = await getGatewayUrl(token);

    this._running = true;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;

    await this.connectGateway(gatewayUrl, token);
    console.log('[qq-adapter] Started');
  }

  async stop(): Promise<void> {
    if (!this._running) return;
    this._running = false;
    this.shouldReconnect = false;

    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close(1000, 'Bridge stopping');
      this.ws = null;
    }

    // Wake up any pending consumeOne() calls
    for (const waiter of this.waiters) {
      waiter(null);
    }
    this.waiters = [];
    this.queue = [];
    this.seenMessageIds.clear();

    console.log('[qq-adapter] Stopped');
  }

  isRunning(): boolean {
    return this._running;
  }

  // ── Message Queue ────────────────────────────────────────────

  async consumeOne(): Promise<InboundMessage | null> {
    if (this.queue.length > 0) {
      return this.queue.shift()!;
    }
    if (!this._running) return null;

    return new Promise<InboundMessage | null>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private enqueue(msg: InboundMessage): void {
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter(msg);
    } else {
      this.queue.push(msg);
    }
  }

  // ── Send ────────────────────────────────────────────────────

  async send(message: OutboundMessage): Promise<SendResult> {
    const appId = getSetting('bridge_qq_app_id') || '';
    const appSecret = getSetting('bridge_qq_app_secret') || '';

    try {
      const token = await getAccessToken(appId, appSecret);

      // QQ requires msg_id for passive reply. Use replyToMessageId from outbound message.
      const msgId = message.replyToMessageId || '';
      if (!msgId) {
        console.warn('[qq-adapter] No replyToMessageId — QQ requires msg_id for passive reply');
        return { ok: false, error: 'Missing replyToMessageId for QQ passive reply' };
      }

      const msgSeq = nextMsgSeq(msgId);

      // QQ only supports plain text in v1 — strip any HTML tags
      let content = message.text;
      if (message.parseMode === 'HTML') {
        content = content.replace(/<[^>]+>/g, '');
      }

      return await sendPrivateMessage(token, {
        openid: message.address.chatId,
        content,
        msgId,
        msgSeq,
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── Config & Auth ────────────────────────────────────────────

  validateConfig(): string | null {
    const appId = getSetting('bridge_qq_app_id') || '';
    const appSecret = getSetting('bridge_qq_app_secret') || '';

    if (!appId) return 'QQ App ID is required';
    if (!appSecret) return 'QQ App Secret is required';
    return null;
  }

  isAuthorized(userId: string, _chatId: string): boolean {
    const allowedUsers = getSetting('bridge_qq_allowed_users') || '';
    if (!allowedUsers.trim()) return true; // empty = allow all
    const allowed = allowedUsers.split(',').map(s => s.trim()).filter(Boolean);
    return allowed.includes(userId);
  }

  // ── WebSocket Gateway ───────────────────────────────────────

  private async connectGateway(gatewayUrl: string, token: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(gatewayUrl);
      this.ws = ws;

      let identified = false;

      ws.on('open', () => {
        console.log('[qq-adapter] WebSocket connected');
      });

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const payload = JSON.parse(data.toString()) as GatewayPayload;
          this.handleGatewayPayload(payload, token, ws);

          // Resolve the connection promise once we get READY
          if (payload.op === OP.DISPATCH && payload.t === 'READY' && !identified) {
            identified = true;
            const readyData = payload.d as { session_id?: string };
            this.sessionId = readyData?.session_id || null;
            this.reconnectAttempts = 0;
            resolve();
          }
        } catch (err) {
          console.error('[qq-adapter] Error parsing gateway message:', err);
        }
      });

      ws.on('close', (code: number, reason: Buffer) => {
        console.log(`[qq-adapter] WebSocket closed: ${code} ${reason.toString()}`);
        this.stopHeartbeat();

        if (this.shouldReconnect && this._running) {
          this.scheduleReconnect();
        }

        if (!identified) {
          reject(new Error(`WebSocket closed before READY: ${code}`));
        }
      });

      ws.on('error', (err: Error) => {
        console.error('[qq-adapter] WebSocket error:', err.message);
        if (!identified) {
          reject(err);
        }
      });
    });
  }

  private handleGatewayPayload(payload: GatewayPayload, token: string, ws: WebSocket): void {
    switch (payload.op) {
      case OP.HELLO: {
        // Start heartbeat
        const helloData = payload.d as { heartbeat_interval: number };
        const interval = helloData?.heartbeat_interval || 41250;
        this.startHeartbeat(ws, interval);

        // Send Identify (or Resume if we have a session)
        if (this.sessionId && this.lastSequence !== null) {
          ws.send(JSON.stringify(buildResume(token, this.sessionId, this.lastSequence)));
        } else {
          ws.send(JSON.stringify(buildIdentify(token, INTENTS.PUBLIC_MESSAGES)));
        }
        break;
      }

      case OP.DISPATCH: {
        // Update sequence number
        if (payload.s !== undefined) {
          this.lastSequence = payload.s;
        }

        if (payload.t === 'C2C_MESSAGE_CREATE') {
          this.handleC2CMessage(payload.d as QQC2CMessageData);
        } else if (payload.t === 'RESUMED') {
          console.log('[qq-adapter] Session resumed');
          this.reconnectAttempts = 0;
        }
        break;
      }

      case OP.HEARTBEAT_ACK:
        // Heartbeat acknowledged — nothing to do
        break;

      case OP.RECONNECT:
        console.log('[qq-adapter] Server requested reconnect');
        ws.close(4000, 'Server requested reconnect');
        break;

      case OP.INVALID_SESSION: {
        console.warn('[qq-adapter] Invalid session, will re-identify');
        this.sessionId = null;
        this.lastSequence = null;
        ws.close(4000, 'Invalid session');
        break;
      }
    }
  }

  private handleC2CMessage(data: QQC2CMessageData): void {
    if (!data?.id || !data?.author?.user_openid) return;

    // Dedup
    if (this.seenMessageIds.has(data.id)) return;
    this.seenMessageIds.set(data.id, true);
    if (this.seenMessageIds.size > DEDUP_MAX) {
      const keys = Array.from(this.seenMessageIds.keys());
      for (let i = 0; i < keys.length - DEDUP_MAX; i++) {
        this.seenMessageIds.delete(keys[i]);
      }
    }

    const userId = data.author.user_openid;

    // Authorization check
    if (!this.isAuthorized(userId, userId)) {
      console.warn(`[qq-adapter] Unauthorized user: ${userId.slice(0, 8)}...`);
      return;
    }

    // Process attachments (images only)
    const imageEnabled = getSetting('bridge_qq_image_enabled') !== 'false';
    const imageAttachments = imageEnabled
      ? (data.attachments || []).filter(a => a.content_type?.startsWith('image/'))
      : [];

    // Build inbound message
    const msg: InboundMessage = {
      messageId: data.id,
      address: {
        channelType: 'qq',
        chatId: userId, // For C2C, chatId = user's openid
        userId,
        displayName: userId.slice(0, 8),
      },
      text: (data.content || '').trim(),
      timestamp: new Date(data.timestamp).getTime() || Date.now(),
    };

    // Download images asynchronously and enqueue
    if (imageAttachments.length > 0) {
      this.downloadImages(imageAttachments).then(attachments => {
        if (attachments.length > 0) {
          msg.attachments = attachments;
        }
        this.enqueue(msg);
      }).catch(err => {
        console.error('[qq-adapter] Image download failed:', err);
        // Still enqueue the message with text (if any) and an error note
        if (msg.text || imageAttachments.length === 0) {
          this.enqueue(msg);
        } else {
          // Image-only message with download failure — notify user
          this.sendImageError(userId, data.id, err instanceof Error ? err.message : 'Download failed');
        }
      });
    } else {
      this.enqueue(msg);
    }

    insertAuditLog({
      channelType: 'qq',
      chatId: userId,
      direction: 'inbound',
      messageId: data.id,
      summary: (data.content || '').slice(0, 200),
    });
  }

  // ── Image Download ────────────────────────────────────────────

  private async downloadImages(
    attachments: QQC2CMessageData['attachments'] & Array<unknown>,
  ): Promise<FileAttachment[]> {
    const maxSizeMB = parseInt(getSetting('bridge_qq_max_image_size') || '', 10) || 20;
    const maxSize = maxSizeMB * 1024 * 1024;
    const results: FileAttachment[] = [];

    for (const att of attachments as Array<{ content_type: string; filename?: string; url: string; size?: number }>) {
      try {
        // Fix protocol-relative URLs
        let url = att.url;
        if (url.startsWith('//')) {
          url = 'https:' + url;
        }

        // Check size if provided
        if (att.size && att.size > maxSize) {
          throw new Error(`Image too large: ${att.size} bytes (max ${maxSize})`);
        }

        const res = await fetch(url, {
          signal: AbortSignal.timeout(30_000),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} downloading image`);
        }

        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length > maxSize) {
          throw new Error(`Image too large: ${buffer.length} bytes (max ${maxSize})`);
        }

        const base64 = buffer.toString('base64');
        const filename = att.filename || `image_${crypto.randomUUID().slice(0, 8)}.${att.content_type.split('/')[1] || 'png'}`;

        results.push({
          id: crypto.randomUUID(),
          name: filename,
          type: att.content_type,
          size: buffer.length,
          data: base64,
        });
      } catch (err) {
        console.error(`[qq-adapter] Failed to download image: ${err instanceof Error ? err.message : err}`);
        throw err; // Re-throw to let caller handle
      }
    }

    return results;
  }

  private async sendImageError(userId: string, msgId: string, errorMsg: string): Promise<void> {
    const appId = getSetting('bridge_qq_app_id') || '';
    const appSecret = getSetting('bridge_qq_app_secret') || '';
    try {
      const token = await getAccessToken(appId, appSecret);
      await sendPrivateMessage(token, {
        openid: userId,
        content: `Failed to process image: ${errorMsg}`,
        msgId,
        msgSeq: nextMsgSeq(msgId),
      });
    } catch { /* best effort */ }
  }

  // ── Heartbeat ────────────────────────────────────────────────

  private startHeartbeat(ws: WebSocket, intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(buildHeartbeat(this.lastSequence)));
      }
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Reconnection ────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[qq-adapter] Max reconnect attempts reached, giving up');
      this._running = false;
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 60_000);
    console.log(`[qq-adapter] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(async () => {
      if (!this._running || !this.shouldReconnect) return;
      try {
        const appId = getSetting('bridge_qq_app_id') || '';
        const appSecret = getSetting('bridge_qq_app_secret') || '';
        const token = await getAccessToken(appId, appSecret);
        const gatewayUrl = await getGatewayUrl(token);
        await this.connectGateway(gatewayUrl, token);
      } catch (err) {
        console.error('[qq-adapter] Reconnect failed:', err);
        this.scheduleReconnect();
      }
    }, delay);
  }
}

// ── Self-Registration ──────────────────────────────────────

registerAdapterFactory('qq', () => new QQAdapter());
