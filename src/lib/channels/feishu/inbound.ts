/**
 * Feishu inbound message processing.
 *
 * Converts raw Feishu event data into InboundMessage for the bridge queue.
 */

import type { InboundMessage } from '../../bridge/types';
import type { FeishuConfig } from './types';
import type { FeishuResourceType } from './resource-downloader';

/** Resource metadata extracted from non-text messages, to be downloaded separately. */
export interface PendingResource {
  messageId: string;
  fileKey: string;
  resourceType: FeishuResourceType;
  /** Optional caption (for image messages, Feishu users often include text) */
  caption?: string;
}

/** Parse result: either a ready InboundMessage (text) or a PendingResource (non-text). */
export type ParseResult =
  | { kind: 'text'; message: InboundMessage }
  | { kind: 'resource'; message: InboundMessage; resources: PendingResource[] }
  | null;

const LOG_TAG = '[feishu/inbound]';

/** A single @mention entry in a Feishu message */
interface FeishuMention {
  key?: string;
  id?: { open_id?: string };
  name?: string;
}

/** Shape of a Feishu im.message.receive_v1 event message */
interface FeishuRawMessage {
  chat_id?: string;
  message_id?: string;
  message_type?: string;
  content?: string;
  root_id?: string;
  create_time?: string;
  mentions?: FeishuMention[];
}

/** Shape of a Feishu event (may be wrapped or unwrapped) */
interface FeishuRawEvent {
  event?: {
    message?: FeishuRawMessage;
    sender?: { sender_id?: { open_id?: string } };
  };
  message?: FeishuRawMessage;
  sender?: { sender_id?: { open_id?: string } };
}

/** Find the bot's mention entry in the mentions array, if any. */
function findBotMention(
  mentions: FeishuMention[] | undefined,
  botOpenId: string,
): FeishuMention | undefined {
  if (!mentions || !botOpenId) return undefined;
  return mentions.find((m) => m?.id?.open_id === botOpenId);
}

/** Parse a raw Feishu im.message.receive_v1 event into an InboundMessage. */
export function parseInboundMessage(
  eventData: unknown,
  config: FeishuConfig,
  botOpenId?: string,
): InboundMessage | null {
  try {
    const raw = eventData as FeishuRawEvent;
    const event = raw?.event ?? raw;
    const message = event?.message;
    if (!message) return null;

    const chatId = message.chat_id || '';
    const messageId = message.message_id || '';
    const sender = event.sender?.sender_id?.open_id || '';
    const msgType = message.message_type;

    // Group chats start with "oc_"; DMs use a different prefix.
    const isGroupChat = chatId.startsWith('oc_');
    const botMention = isGroupChat
      ? findBotMention(message.mentions, botOpenId || '')
      : undefined;

    // When requireMention is on (#384), drop group messages that don't @bot.
    // DMs always bypass this check.
    //
    // Fail-open if botOpenId hasn't resolved yet: the bot identity fetch is async
    // (fires in index.ts after gateway.start) and may take a few seconds, or may
    // fail entirely on flaky networks. Dropping every group message during that
    // window would look like the bot is broken. The trade-off: during the startup
    // gap (~1-5s typically), un-mentioned group messages also get through. This
    // mirrors the "degrade gracefully" intent stated in index.ts#resolveBotIdentity.
    if (isGroupChat && config.requireMention && botOpenId && !botMention) {
      return null;
    }

    // Build thread-session address only when threadSession is explicitly enabled.
    // Without this guard (#321), the bot would always route thread messages to a
    // separate session, bleeding context across threads even for users who expect
    // a single chat to share one conversation.
    const rootId = message.root_id || '';
    const effectiveChatId = (config.threadSession && rootId)
      ? `${chatId}:thread:${rootId}`
      : chatId;

    const address = { channelType: 'feishu' as const, chatId: effectiveChatId, userId: sender };
    const timestamp = parseInt(message.create_time || '0', 10) || Date.now();

    // Text message path
    if (msgType === 'text') {
      let text = '';
      try {
        const content = JSON.parse(message.content || '{}');
        text = content.text || '';
      } catch {
        text = message.content || '';
      }
      if (!text.trim()) return null;

      if (botMention?.key) {
        text = text.split(botMention.key).join('').trim();
      }

      return {
        messageId,
        address,
        text: text.trim(),
        timestamp,
      };
    }

    // Non-text messages with resources (#291): image / file / audio / video.
    // Return a PendingResource alongside a stub InboundMessage; the caller
    // is expected to download and attach before enqueuing.
    const resources = extractResources(messageId, msgType, message.content || '');
    if (resources && resources.length > 0) {
      return {
        messageId,
        address,
        text: resources.map((r) => r.caption).filter(Boolean).join('\n') || '',
        timestamp,
        // attachments will be populated by the caller after download
      };
    }

    // Unhandled message type — skip silently
    return null;
  } catch (err) {
    console.error(LOG_TAG, 'Failed to parse inbound message:', err);
    return null;
  }
}

/**
 * Extract resource metadata (file_key, type, caption) from a non-text Feishu message content.
 * Returns null for unsupported types.
 */
export function extractResources(
  messageId: string,
  msgType: string | undefined,
  contentJson: string,
): PendingResource[] | null {
  if (!msgType || !contentJson) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(contentJson);
  } catch {
    return null;
  }

  switch (msgType) {
    case 'image': {
      const imageKey = typeof parsed.image_key === 'string' ? parsed.image_key : '';
      if (!imageKey) return null;
      return [{
        messageId,
        fileKey: imageKey,
        resourceType: 'image',
      }];
    }
    case 'file': {
      const fileKey = typeof parsed.file_key === 'string' ? parsed.file_key : '';
      if (!fileKey) return null;
      const fileName = typeof parsed.file_name === 'string' ? parsed.file_name : '';
      return [{
        messageId,
        fileKey,
        resourceType: 'file',
        caption: fileName ? `[File: ${fileName}]` : undefined,
      }];
    }
    case 'audio': {
      const fileKey = typeof parsed.file_key === 'string' ? parsed.file_key : '';
      if (!fileKey) return null;
      return [{
        messageId,
        fileKey,
        resourceType: 'audio',
      }];
    }
    case 'media':
    case 'video': {
      const fileKey = typeof parsed.file_key === 'string' ? parsed.file_key : '';
      if (!fileKey) return null;
      return [{
        messageId,
        fileKey,
        resourceType: 'video',
      }];
    }
    default:
      return null;
  }
}

/**
 * Parse and extract pending resources (non-text messages) without building the final message.
 * Used by callers that want to download resources before enqueuing.
 */
export function parseMessageWithResources(
  eventData: unknown,
  config: FeishuConfig,
  botOpenId?: string,
): { message: InboundMessage; resources: PendingResource[] } | null {
  const base = parseInboundMessage(eventData, config, botOpenId);
  if (!base) return null;

  // Re-extract resources so the caller has access to them for download.
  const raw = eventData as FeishuRawEvent;
  const event = raw?.event ?? raw;
  const message = event?.message;
  if (!message) return { message: base, resources: [] };

  const resources = extractResources(
    message.message_id || '',
    message.message_type,
    message.content || '',
  ) || [];

  return { message: base, resources };
}
