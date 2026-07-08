/**
 * runtime/index.ts — Initialize and register all agent runtimes.
 *
 * Import this module once at app startup to make runtimes available
 * via resolveRuntime().
 */

export type { AgentRuntime, RuntimeStreamOptions } from './types';
export { registerRuntime, getRuntime, getAllRuntimes, getAvailableRuntimes, resolveRuntime, predictNativeRuntime } from './registry';

import { registerRuntime } from './registry';
import { nativeRuntime } from './native-runtime';
import { sdkRuntime } from './sdk-runtime';
import { codexRuntime } from '@/lib/codex/runtime';

// Register built-in runtimes
registerRuntime(nativeRuntime);
registerRuntime(sdkRuntime);
// Phase 5 Phase 3 (2026-05-13) — Codex Runtime. `isAvailable()` gates
// the runtime registry resolver, so chat sends only route here when
// `codex` binary is on PATH (or CODEX_BIN env override is set).
registerRuntime(codexRuntime);
