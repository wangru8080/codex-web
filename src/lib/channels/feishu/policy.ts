/**
 * Feishu access control and group policy.
 */

import type { FeishuConfig } from './types';

/**
 * Check if a user is authorized based on the current config.
 *
 * DM policy logic:
 * - disabled → false
 * - open → allowFrom must include '*' or user's open_id
 * - allowlist → allowFrom must include user's open_id
 * - pairing → always true (pairing handled elsewhere)
 *
 * Group chat logic (chatId starts with 'oc_'):
 * - groupPolicy === 'disabled' → false
 * - groupPolicy === 'allowlist' → groupAllowFrom must include chatId
 * - groupPolicy === 'open' → true
 */
export function isUserAuthorized(
  config: FeishuConfig,
  userId: string,
  chatId: string,
): boolean {
  // Group chat check
  if (chatId.startsWith('oc_')) {
    if (config.groupPolicy === 'disabled') return false;
    if (config.groupPolicy === 'allowlist') {
      if (!config.groupAllowFrom.includes(chatId)) return false;
    }
    // groupPolicy === 'open' → allowed
    return true;
  }

  // DM policy check
  if (config.dmPolicy === 'disabled') return false;
  if (config.dmPolicy === 'pairing') return true;

  if (config.dmPolicy === 'open') {
    if (config.allowFrom.length === 0) return true;
    return config.allowFrom.includes('*') || config.allowFrom.includes(userId);
  }

  if (config.dmPolicy === 'allowlist') {
    return config.allowFrom.includes(userId);
  }

  return false;
}
