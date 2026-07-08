/**
 * agent-types.ts — Self-owned types replacing SDK imports.
 *
 * These mirror the types previously imported from @anthropic-ai/claude-agent-sdk
 * so the Native Runtime doesn't need the SDK at all.
 */

/** Permission decision from the user */
export interface NativePermissionResult {
  behavior: 'allow' | 'deny';
  message?: string;
  updatedInput?: Record<string, unknown>;
  updatedPermissions?: unknown[];
}
