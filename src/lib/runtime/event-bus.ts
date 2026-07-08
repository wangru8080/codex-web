/**
 * event-bus.ts — Runtime lifecycle event bus.
 *
 * Inspired by open-agent-sdk's HookRegistry.
 * Provides a simple pub/sub for runtime lifecycle events.
 * Handlers run async but emit is fire-and-forget (never blocks the main flow).
 *
 * Use this to decouple cross-cutting concerns (DB persistence, SSE forwarding,
 * bridge notifications, metrics, logging) from the main agent loop.
 */

export type RuntimeEventType =
  | 'session:start'
  | 'session:end'
  | 'tool:pre-use'
  | 'tool:post-use'
  | 'permission:request'
  | 'permission:resolved'
  | 'compact:before'
  | 'compact:after';

export interface RuntimeEventData {
  sessionId: string;
  [key: string]: unknown;
}

type Handler = (data: RuntimeEventData) => void | Promise<void>;

const listeners = new Map<RuntimeEventType, Set<Handler>>();

/**
 * Register an event handler.
 */
export function on(event: RuntimeEventType, handler: Handler): void {
  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }
  listeners.get(event)!.add(handler);
}

/**
 * Remove an event handler.
 */
export function off(event: RuntimeEventType, handler: Handler): void {
  listeners.get(event)?.delete(handler);
}

/**
 * Emit an event. Handlers run async, errors are caught and logged.
 * Never throws, never blocks the caller.
 */
export function emit(event: RuntimeEventType, data: RuntimeEventData): void {
  const handlers = listeners.get(event);
  if (!handlers || handlers.size === 0) return;

  for (const handler of handlers) {
    try {
      const result = handler(data);
      if (result && typeof result === 'object' && 'catch' in result) {
        (result as Promise<void>).catch(err => {
          console.warn(`[event-bus] Handler error for ${event}:`, err instanceof Error ? err.message : err);
        });
      }
    } catch (err) {
      console.warn(`[event-bus] Handler error for ${event}:`, err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Remove all handlers (for testing or cleanup).
 */
export function clear(): void {
  listeners.clear();
}
