/**
 * claude-code-compat/index.ts — Factory for Claude Code-compatible proxy adapter.
 *
 * Creates a LanguageModelV3 instance that speaks the wire format
 * Claude Code proxy APIs expect (Anthropic Messages API with betas).
 */

export { ClaudeCodeCompatModel } from './claude-code-compat-model';
export type { ClaudeCodeCompatConfig } from './types';

import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { ClaudeCodeCompatConfig } from './types';
import { ClaudeCodeCompatModel } from './claude-code-compat-model';

/**
 * Create a LanguageModel for a Claude Code-compatible proxy.
 * Use this for providers marked sdkProxyOnly in the catalog.
 */
export function createClaudeCodeCompatModel(config: ClaudeCodeCompatConfig): LanguageModelV3 {
  return new ClaudeCodeCompatModel(config);
}
