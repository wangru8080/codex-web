/**
 * Feishu adapter — thin proxy that delegates to FeishuChannelPlugin.
 *
 * The actual implementation lives in src/lib/channels/feishu/.
 * This file exists only to maintain the existing self-registration pattern
 * used by bridge-manager via adapters/index.ts.
 */

import { registerAdapterFactory } from '../channel-adapter';
import { ChannelPluginAdapter } from '../../channels/channel-plugin-adapter';
import { FeishuChannelPlugin } from '../../channels/feishu';

// Self-register so bridge-manager can create FeishuAdapter via the registry.
registerAdapterFactory('feishu', () =>
  new ChannelPluginAdapter(new FeishuChannelPlugin())
);
