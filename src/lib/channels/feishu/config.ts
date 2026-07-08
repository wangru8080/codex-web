/**
 * Feishu configuration loading and validation.
 */

import { getSetting } from '../../db';
import type { FeishuConfig } from './types';

/** Parse a comma-separated string into a trimmed, non-empty string array. */
function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

/** Load Feishu config from settings DB. Returns null if incomplete. */
export function loadFeishuConfig(): FeishuConfig | null {
  const appId = getSetting('bridge_feishu_app_id');
  const appSecret = getSetting('bridge_feishu_app_secret');
  if (!appId || !appSecret) return null;

  const domain = getSetting('bridge_feishu_domain') || 'feishu';

  const allowFrom = parseList(getSetting('bridge_feishu_allow_from'));
  const groupAllowFrom = parseList(getSetting('bridge_feishu_group_allow_from'));
  const dmPolicy = (getSetting('bridge_feishu_dm_policy') || 'open') as FeishuConfig['dmPolicy'];
  const groupPolicy = (getSetting('bridge_feishu_group_policy') || 'open') as FeishuConfig['groupPolicy'];
  const requireMention = getSetting('bridge_feishu_require_mention') === 'true';
  const threadSession = getSetting('bridge_feishu_thread_session') === 'true';

  // Validation: when dmPolicy is 'open', allowFrom should include '*'
  if (dmPolicy === 'open' && allowFrom.length > 0 && !allowFrom.includes('*')) {
    allowFrom.push('*');
  }

  return {
    appId,
    appSecret,
    domain,
    allowFrom,
    groupAllowFrom,
    dmPolicy,
    groupPolicy,
    requireMention,
    threadSession,
    cardStreamConfig: {
      throttleMs: 200,
      footer: { status: true, elapsed: true },
    },
  };
}

/** Validate a Feishu config. Returns null if valid, error message otherwise. */
export function validateFeishuConfig(config: FeishuConfig | null): string | null {
  if (!config) return 'Feishu App ID and App Secret are required.';
  if (!config.appId) return 'Feishu App ID is required.';
  if (!config.appSecret) return 'Feishu App Secret is required.';
  return null;
}
