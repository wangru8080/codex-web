/**
 * Feishu channel internal types and constants.
 */

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  /** SDK domain: 'feishu' | 'lark' or a custom base URL. */
  domain: string;
  /** Allowed user IDs (open_id). ['*'] means all users. */
  allowFrom: string[];
  /** Allowed group chat IDs. */
  groupAllowFrom: string[];
  /** DM policy: open / pairing / allowlist / disabled */
  dmPolicy: 'open' | 'pairing' | 'allowlist' | 'disabled';
  /** Group policy: open / allowlist / disabled */
  groupPolicy: 'open' | 'allowlist' | 'disabled';
  /** Whether to require @mention in group chats */
  requireMention: boolean;
  /** Whether to use per-thread sessions */
  threadSession: boolean;
  /** Card streaming config (always enabled) */
  cardStreamConfig: CardStreamConfig;
}

export interface CardStreamConfig {
  /** Throttle interval for stream updates (ms) */
  throttleMs: number;
  /** Footer display options (status line and elapsed time) */
  footer?: {
    status: boolean;
    elapsed: boolean;
  };
}

export interface FeishuBotInfo {
  appId: string;
  botName: string;
  openId: string;
}

/** Feishu message item from list/search API */
export interface FeishuMessageItem {
  messageId: string;
  rootId?: string;
  parentId?: string;
  msgType: string;
  createTime: string;
  updateTime?: string;
  content: string;
  sender: {
    id: string;
    idType: string;
    senderType: string;
    tenantKey?: string;
  };
}

/** Result from readMessages / searchMessages */
export interface MessageListResult {
  items: FeishuMessageItem[];
  hasMore: boolean;
  pageToken?: string;
}
