/**
 * Synthetic chatId encode/decode for WeChat multi-account isolation.
 *
 * Format: weixin::<accountId>::<peerUserId>
 * This ensures each (account, peer) pair maps to a unique channel_bindings row
 * without modifying the existing schema.
 */

const WEIXIN_PREFIX = 'weixin::';
const SEPARATOR = '::';

export function encodeWeixinChatId(accountId: string, peerUserId: string): string {
  return `${WEIXIN_PREFIX}${accountId}${SEPARATOR}${peerUserId}`;
}

export function decodeWeixinChatId(chatId: string): { accountId: string; peerUserId: string } | null {
  if (!chatId.startsWith(WEIXIN_PREFIX)) return null;
  const rest = chatId.slice(WEIXIN_PREFIX.length);
  const sepIdx = rest.indexOf(SEPARATOR);
  if (sepIdx < 0) return null;
  const accountId = rest.slice(0, sepIdx);
  const peerUserId = rest.slice(sepIdx + SEPARATOR.length);
  if (!accountId || !peerUserId) return null;
  return { accountId, peerUserId };
}

export function isWeixinChatId(chatId: string): boolean {
  return chatId.startsWith(WEIXIN_PREFIX) && decodeWeixinChatId(chatId) !== null;
}
