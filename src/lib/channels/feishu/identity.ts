/**
 * Feishu bot identity resolution.
 */

import type * as lark from '@larksuiteoapi/node-sdk';
import type { FeishuBotInfo } from './types';

const LOG_TAG = '[feishu/identity]';

// The identity-retry timer polls getBotInfo every 60s until it resolves. Log a
// fetch failure AT MOST ONCE per process so a persistent failure (e.g. missing
// bot scope) doesn't spam the log every minute — that per-minute noise was the
// reported `undefined (reading 'v3')` symptom.
let loggedBotInfoFailure = false;

/** Test-only: re-arm the one-shot failure log between cases. */
export function resetBotInfoFailureLogForTests(): void {
  loggedBotInfoFailure = false;
}

/**
 * Shape of `GET /open-apis/bot/v3/info`. The SDK's response interceptor unwraps
 * to the response body, where `bot` sits at the top level; we also accept a
 * nested `data.bot` defensively in case a transport returns the full envelope.
 */
interface BotInfoResponse {
  bot?: BotInfoFields;
  data?: { bot?: BotInfoFields };
}
interface BotInfoFields {
  app_name?: string;
  open_id?: string;
}

/**
 * Fetch bot info from Feishu.
 *
 * `@larksuiteoapi/node-sdk` 1.59's generated client has NO bot namespace, so
 * the previous typed-client call (`client.bot` resolved to undefined) threw
 * `Cannot read properties of undefined (reading 'v3')` on every call — which
 * the 60s identity-retry timer surfaced as per-minute log noise. We call the
 * documented endpoint via the raw `client.request` (which carries tenant-token
 * auth) instead. Returns null on any failure, logged once per process (never
 * per retry).
 */
export async function getBotInfo(client: lark.Client): Promise<FeishuBotInfo | null> {
  try {
    const resp = await client.request<BotInfoResponse>({
      method: 'GET',
      url: '/open-apis/bot/v3/info',
    });
    const bot = resp?.bot ?? resp?.data?.bot;
    if (!bot?.open_id) return null;
    return {
      appId: '',
      botName: bot.app_name || '',
      openId: bot.open_id,
    };
  } catch (err) {
    if (!loggedBotInfoFailure) {
      loggedBotInfoFailure = true;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(LOG_TAG, 'bot info unavailable (mention detection degraded):', msg);
    }
    return null;
  }
}
