/**
 * WeChat Adapter — implements BaseChannelAdapter for WeChat ilink bot API.
 *
 * Uses HTTP long-polling (one worker per enabled account) for real-time
 * message consumption. Text-only outbound. No streaming preview.
 * No inline buttons — permission handled via /perm text command.
 *
 * Multi-account: each QR-linked account runs its own poll loop.
 * Synthetic chatId format: weixin::<accountId>::<peerUserId>
 */

import type {
  ChannelType,
  InboundMessage,
  OutboundMessage,
  SendResult,
} from '../types';
import type { FileAttachment } from '@/types';
import { BaseChannelAdapter, registerAdapterFactory } from '../channel-adapter';
import {
  listWeixinAccounts,
  getWeixinAccount,
  getWeixinContextToken,
  upsertWeixinContextToken,
  getChannelOffset,
  setChannelOffset,
  insertAuditLog,
  getSetting,
} from '../../db';
import type { WeixinAccountRow } from '../../db';
import { getUpdates, sendTextMessage, sendTyping as apiSendTyping, getConfig } from './weixin/weixin-api';
import type { WeixinCredentials, WeixinMessage, MessageItem, GetUpdatesResponse } from './weixin/weixin-types';
import { MessageItemType, TypingStatus, ERRCODE_SESSION_EXPIRED } from './weixin/weixin-types';
import { encodeWeixinChatId, decodeWeixinChatId } from './weixin/weixin-ids';
import { downloadMediaFromItem } from './weixin/weixin-media';
import { isPaused, setPaused, clearAllPauses } from './weixin/weixin-session-guard';

/** Max number of message_ids to keep for dedup per account. */
const DEDUP_MAX = 500;

/** Backoff after consecutive failures. */
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 30_000;

export class WeixinAdapter extends BaseChannelAdapter {
  readonly channelType: ChannelType = 'weixin';

  private _running = false;
  private queue: InboundMessage[] = [];
  private waiters: Array<(msg: InboundMessage | null) => void> = [];
  private pollAborts = new Map<string, AbortController>();
  private seenMessageIds = new Map<string, Set<string>>();
  private consecutiveFailures = new Map<string, number>();
  private typingTickets = new Map<string, string>();

  // Per-batch cursor ack tracking: hold cursor in memory until all
  // messages in the batch are acknowledged by bridge-manager.
  private pendingCursors = new Map<number, {
    offsetKey: string;
    cursor: string;
    remaining: number;
    sealed: boolean;
  }>();
  private nextBatchId = 1;

  // ── Lifecycle ───────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;
    clearAllPauses();

    const accounts = listWeixinAccounts().filter(a => a.enabled === 1);
    if (accounts.length === 0) {
      console.log('[weixin-adapter] No enabled accounts, adapter started but idle');
    }

    for (const account of accounts) {
      this.startAccountWorker(account);
    }

    console.log(`[weixin-adapter] Started with ${accounts.length} account(s)`);
  }

  async stop(): Promise<void> {
    if (!this._running) return;
    this._running = false;

    // Abort all poll loops
    for (const [, controller] of this.pollAborts) {
      controller.abort();
    }
    this.pollAborts.clear();

    // Wake up pending consumeOne() calls
    for (const waiter of this.waiters) {
      waiter(null);
    }
    this.waiters = [];
    this.queue = [];
    this.seenMessageIds.clear();
    this.consecutiveFailures.clear();
    this.typingTickets.clear();
    this.pendingCursors.clear();

    console.log('[weixin-adapter] Stopped');
  }

  isRunning(): boolean {
    return this._running;
  }

  /**
   * Called by bridge-manager after handleMessage completes for a message.
   * Decrements the batch counter; when all messages in the batch are done,
   * commits the poll cursor to DB.
   */
  acknowledgeUpdate(updateId: number): void {
    const batch = this.pendingCursors.get(updateId);
    if (!batch) return;
    batch.remaining = Math.max(0, batch.remaining - 1);
    this.maybeCommitPendingCursor(updateId);
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
    try {
      const decoded = decodeWeixinChatId(message.address.chatId);
      if (!decoded) {
        return { ok: false, error: 'Invalid WeChat chatId format' };
      }

      const { accountId, peerUserId } = decoded;
      const account = getWeixinAccount(accountId);
      if (!account) {
        return { ok: false, error: `WeChat account ${accountId} not found` };
      }

      const contextToken = getWeixinContextToken(accountId, peerUserId);
      if (!contextToken) {
        return { ok: false, error: `No context_token for peer ${peerUserId} on account ${accountId}` };
      }

      const creds = this.accountToCreds(account);

      // Strip HTML/Markdown — WeChat only supports plain text
      let content = message.text;
      if (message.parseMode === 'HTML') {
        content = content.replace(/<[^>]+>/g, '');
      }
      // Simple markdown strip
      content = content
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/__(.*?)__/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/_(.*?)_/g, '$1')
        .replace(/`{3}[\s\S]*?`{3}/g, (m) => m.replace(/`{3}\w*\n?/g, '').replace(/`{3}/g, ''))
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

      // sendTextMessage returns local clientId; HTTP errors throw
      const { clientId } = await sendTextMessage(creds, peerUserId, content, contextToken);

      return { ok: true, messageId: clientId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── Typing ────────────────────────────────────────────────

  onMessageStart(chatId: string): void {
    this.sendTypingIndicator(chatId, TypingStatus.TYPING).catch(() => {});
  }

  onMessageEnd(chatId: string): void {
    this.sendTypingIndicator(chatId, TypingStatus.CANCEL).catch(() => {});
  }

  private async sendTypingIndicator(chatId: string, status: number): Promise<void> {
    const decoded = decodeWeixinChatId(chatId);
    if (!decoded) return;

    const { accountId, peerUserId } = decoded;
    const account = getWeixinAccount(accountId);
    if (!account) return;

    const contextToken = getWeixinContextToken(accountId, peerUserId);
    if (!contextToken) return;

    const creds = this.accountToCreds(account);

    // Get or fetch typing ticket (per-user, requires context_token)
    const ticketKey = `${accountId}:${peerUserId}`;
    let ticket = this.typingTickets.get(ticketKey);
    if (!ticket) {
      try {
        const config = await getConfig(creds, peerUserId, contextToken);
        if (config.typing_ticket) {
          ticket = config.typing_ticket;
          this.typingTickets.set(ticketKey, ticket);
        }
      } catch {
        return; // Best effort
      }
    }
    if (!ticket) return;

    await apiSendTyping(creds, peerUserId, ticket, status);
  }

  // ── Config & Auth ──────────────────────────────────────────

  validateConfig(): string | null {
    const accounts = listWeixinAccounts().filter(a => a.enabled === 1);
    if (accounts.length === 0) {
      return 'No enabled WeChat accounts. Add an account via QR code login first.';
    }
    // Check that at least one account has a token
    const hasToken = accounts.some(a => a.token && a.token.length > 0);
    if (!hasToken) {
      return 'No WeChat accounts have valid tokens. Re-login via QR code.';
    }
    return null;
  }

  isAuthorized(_userId: string, chatId: string): boolean {
    // Decode the synthetic chatId to get accountId
    const decoded = decodeWeixinChatId(chatId);
    if (!decoded) return false;

    // Check per-account allowed_users (stored in settings)
    // For now, all users are allowed (WeChat bot already restricts to paired users)
    return true;
  }

  // ── Per-Account Poll Loop ──────────────────────────────────

  private startAccountWorker(account: WeixinAccountRow): void {
    const controller = new AbortController();
    this.pollAborts.set(account.account_id, controller);
    this.seenMessageIds.set(account.account_id, new Set());
    this.consecutiveFailures.set(account.account_id, 0);

    // Fire-and-forget async poll loop
    this.runPollLoop(account.account_id, this.accountToCreds(account), controller.signal);
  }

  private async runPollLoop(
    accountId: string,
    creds: WeixinCredentials,
    signal: AbortSignal,
  ): Promise<void> {
    console.log(`[weixin-adapter] Poll loop started for account ${accountId}`);

    while (this._running && !signal.aborted) {
      // Check pause state
      if (isPaused(accountId)) {
        await this.sleep(10_000, signal);
        continue;
      }

      try {
        // Read persisted poll cursor (default '0' from db means no cursor yet)
        const offsetKey = `weixin:${accountId}`;
        const rawOffset = getChannelOffset(offsetKey);
        const buf = rawOffset === '0' ? '' : rawOffset;

        const resp: GetUpdatesResponse = await getUpdates(creds, buf);

        // Check for session expiry
        if (resp.errcode === ERRCODE_SESSION_EXPIRED) {
          setPaused(accountId, 'Session expired (errcode -14)');
          console.warn(`[weixin-adapter] Account ${accountId} session expired, pausing`);
          continue;
        }

        // Check for other API errors
        if (resp.errcode && resp.errcode !== 0) {
          throw new Error(`API error: ${resp.errcode} ${resp.errmsg || ''}`);
        }

        // Process messages — assign a batch ID so the cursor is only
        // committed after bridge-manager finishes handleMessage for ALL
        // messages in this batch (via acknowledgeUpdate).
        let batchId: number | undefined;
        let batchCompleted = false;

        if (resp.msgs && resp.msgs.length > 0 && resp.get_updates_buf) {
          batchId = this.nextBatchId++;
          this.pendingCursors.set(batchId, {
            offsetKey: `weixin:${accountId}`,
            cursor: resp.get_updates_buf,
            remaining: 0,
            sealed: false,
          });
          for (const msg of resp.msgs) {
            await this.processMessage(accountId, creds, msg, batchId);
          }
          batchCompleted = true;
        } else if (resp.msgs && resp.msgs.length > 0) {
          // No new cursor — process without batch tracking
          for (const msg of resp.msgs) {
            await this.processMessage(accountId, creds, msg);
          }
        }

        // Only seal successful batches. If processing failed mid-batch, drop the
        // pending cursor so the upstream cursor is not advanced and messages can
        // be retried on the next poll.
        if (batchId !== undefined && resp.get_updates_buf) {
          const batch = this.pendingCursors.get(batchId);
          if (batchCompleted && batch) {
            batch.sealed = true;
            this.maybeCommitPendingCursor(batchId);
          } else if (!batchCompleted) {
            this.pendingCursors.delete(batchId);
          }
        }

        // Reset failure counter on success
        this.consecutiveFailures.set(accountId, 0);

      } catch (err) {
        if (signal.aborted) break;

        const failures = (this.consecutiveFailures.get(accountId) || 0) + 1;
        this.consecutiveFailures.set(accountId, failures);

        const backoff = Math.min(
          BACKOFF_BASE_MS * Math.pow(2, failures - 1),
          BACKOFF_MAX_MS,
        );

        console.error(
          `[weixin-adapter] Poll error for ${accountId} (failure ${failures}):`,
          err instanceof Error ? err.message : err,
        );

        await this.sleep(backoff, signal);
      }
    }

    console.log(`[weixin-adapter] Poll loop ended for account ${accountId}`);
  }

  private async processMessage(
    accountId: string,
    creds: WeixinCredentials,
    msg: WeixinMessage,
    batchId?: number,
  ): Promise<void> {
    if (!msg.from_user_id) return;

    // Dedup by message_id or seq
    const msgKey = msg.message_id || `seq_${msg.seq}`;
    const seen = this.seenMessageIds.get(accountId);
    if (seen?.has(msgKey)) return;
    seen?.add(msgKey);

    // Trim dedup set
    if (seen && seen.size > DEDUP_MAX) {
      const arr = Array.from(seen);
      for (let i = 0; i < arr.length - DEDUP_MAX; i++) {
        seen.delete(arr[i]);
      }
    }

    // Persist context_token
    if (msg.context_token) {
      upsertWeixinContextToken(accountId, msg.from_user_id, msg.context_token);
    }

    // Extract text from item_list
    let text = '';
    const items = msg.item_list || [];
    for (const item of items) {
      if (item.type === MessageItemType.TEXT && item.text_item?.text) {
        text += item.text_item.text;
      }
    }

    // Handle quoted/referenced messages
    if (msg.ref_message) {
      const refParts: string[] = [];
      if (msg.ref_message.title) refParts.push(msg.ref_message.title);
      if (msg.ref_message.content) refParts.push(msg.ref_message.content);
      if (refParts.length > 0) {
        text = `[引用: ${refParts.join(' | ')}]\n${text}`;
      }
    }

    // Build synthetic chatId
    const chatId = encodeWeixinChatId(accountId, msg.from_user_id);

    // Download media attachments
    let attachments: FileAttachment[] | undefined;
    const mediaEnabled = getSetting('bridge_weixin_media_enabled') !== 'false';
    if (mediaEnabled) {
      attachments = await this.downloadMediaItems(items, creds.cdnBaseUrl, accountId);
    }

    const inbound: InboundMessage = {
      messageId: msg.message_id || `weixin_${accountId}_${msg.seq || Date.now()}`,
      address: {
        channelType: 'weixin',
        chatId,
        userId: msg.from_user_id,
        displayName: msg.from_user_id.slice(0, 8),
      },
      text: text.trim(),
      timestamp: msg.create_time ? msg.create_time * 1000 : Date.now(),
      attachments,
      raw: { accountId, originalMessage: msg },
      updateId: batchId,
    };

    // Only enqueue if we have text or attachments
    if (inbound.text || (inbound.attachments && inbound.attachments.length > 0)) {
      if (batchId !== undefined) {
        const batch = this.pendingCursors.get(batchId);
        if (batch) {
          batch.remaining++;
        }
      }
      this.enqueue(inbound);
    }

    insertAuditLog({
      channelType: 'weixin',
      chatId,
      direction: 'inbound',
      messageId: inbound.messageId,
      summary: text.slice(0, 200),
    });
  }

  private async downloadMediaItems(
    items: MessageItem[],
    cdnBaseUrl: string,
    accountId: string,
  ): Promise<FileAttachment[]> {
    const results: FileAttachment[] = [];

    for (const item of items) {
      if (item.type === MessageItemType.TEXT) continue;

      try {
        const media = await downloadMediaFromItem(item, cdnBaseUrl);
        if (media) {
          const id = `weixin_${accountId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          results.push({
            id,
            name: media.filename,
            type: media.mimeType,
            size: media.data.length,
            data: media.data.toString('base64'),
          });
        }
      } catch (err) {
        console.error(`[weixin-adapter] Media download failed:`, err instanceof Error ? err.message : err);
        // Continue processing other items
      }
    }

    return results;
  }

  // ── Helpers ────────────────────────────────────────────────

  private accountToCreds(account: WeixinAccountRow): WeixinCredentials {
    return {
      botToken: account.token,
      ilinkBotId: account.account_id,
      baseUrl: account.base_url || 'https://ilinkai.weixin.qq.com',
      cdnBaseUrl: account.cdn_base_url || 'https://novac2c.cdn.weixin.qq.com/c2c',
    };
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  private maybeCommitPendingCursor(updateId: number): void {
    const batch = this.pendingCursors.get(updateId);
    if (!batch || !batch.sealed || batch.remaining > 0) {
      return;
    }
    setChannelOffset(batch.offsetKey, batch.cursor);
    this.pendingCursors.delete(updateId);
  }
}

// ── Self-Registration ──────────────────────────────────────

registerAdapterFactory('weixin', () => new WeixinAdapter());
