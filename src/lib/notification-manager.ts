/**
 * Notification Manager — unified multi-channel notification dispatch.
 *
 * Phase 3 Step 3 — events / deliveries split (v4 plan):
 *   • One logical task notification = one `notification_events` row
 *     (the umbrella). `sendNotification()` writes it.
 *   • Each candidate channel = one `notification_deliveries` row tied
 *     to that event by `event_id` (1:N relationship). Renderer /
 *     Electron / Bridge each ack their channel via
 *     `POST /api/tasks/notify/ack`, which UPSERTs `queued → delivered`
 *     or `queued → error` on the same `(event_id, channel)` row (v5
 *     plan — never INSERT a duplicate).
 *
 * Channel × priority matrix (v4 plan locks Bridge to urgent):
 *   - low     → renderer-toast (queued)
 *   - normal  → renderer-toast (queued) + electron-native (queued)
 *   - urgent  → renderer-toast (queued) + electron-native (queued)
 *               + bridge-telegram (queued / not_configured / skipped)
 *
 * non-urgent priority deliberately writes NO `bridge-*` delivery row —
 * Bridge is not a candidate channel for these priorities, and writing
 * `skipped_by_priority` would imply we considered Bridge then bailed,
 * which misrepresents the product policy.
 *
 * In-app delivery: notifications are queued in a server-side ring
 * buffer for `useNotificationPoll` to drain. The drained payload now
 * carries `event_id` so the renderer can ack the `renderer-toast` (and
 * Electron-native, when present) delivery row after a successful
 * `showToast` / `Notification.show`.
 */

// ── Server-side notification queue (survives HMR via globalThis) ────

interface QueuedNotification {
  id: string;
  /** Phase 3 Step 3 — links the queue payload back to the umbrella
   *  `notification_events.event_id` so the renderer can ack the
   *  matching `notification_deliveries` row after display. */
  event_id: string;
  /** Phase 3 Step 3 — payload for click → router.push. */
  task_id?: string;
  session_id?: string;
  title: string;
  body: string;
  priority: 'low' | 'normal' | 'urgent';
  timestamp: number;
}

const QUEUE_KEY = '__codepilot_notification_queue__';
const MAX_QUEUE_SIZE = 50;

function getQueue(): QueuedNotification[] {
  if (!(globalThis as Record<string, unknown>)[QUEUE_KEY]) {
    (globalThis as Record<string, unknown>)[QUEUE_KEY] = [];
  }
  return (globalThis as Record<string, unknown>)[QUEUE_KEY] as QueuedNotification[];
}

/** Push a notification into the server-side queue for frontend polling. */
export function enqueueNotification(
  title: string,
  body: string,
  priority: 'low' | 'normal' | 'urgent',
  meta?: { event_id?: string; task_id?: string; session_id?: string },
): void {
  const queue = getQueue();
  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    event_id: meta?.event_id ?? '',
    task_id: meta?.task_id,
    session_id: meta?.session_id,
    title,
    body,
    priority,
    timestamp: Date.now(),
  });
  // Ring buffer: drop oldest if over limit
  while (queue.length > MAX_QUEUE_SIZE) queue.shift();
}

/** Drain all queued notifications (returns and clears the queue). */
export function drainNotifications(): QueuedNotification[] {
  const queue = getQueue();
  const items = [...queue];
  queue.length = 0;
  return items;
}

/**
 * Send a notification through appropriate channels based on priority.
 *
 * Implementation lives in the Next.js server process. The actual
 * display happens in the renderer (toast + native via IPC) or Electron
 * main (bg-poller native). Each channel acks its delivery row when the
 * surface that displayed it confirms success.
 */
export async function sendNotification(opts: {
  title: string;
  body: string;
  priority: 'low' | 'normal' | 'urgent';
  taskId?: string;
  sessionId?: string;
  source?: 'codepilot' | 'external';
  action?: { type: string; payload: string };
}): Promise<{
  event_id: string;
  deliveries: Array<{ channel: string; status: string; error?: string }>;
}> {
  // 1. Generate the umbrella event id and persist the events row.
  const event_id = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  let dbHelpers:
    | {
        insertNotificationEvent: typeof import('@/lib/db').insertNotificationEvent;
        upsertNotificationDelivery: typeof import('@/lib/db').upsertNotificationDelivery;
        getSetting: typeof import('@/lib/db').getSetting;
      }
    | null = null;
  try {
    dbHelpers = await import('@/lib/db');
  } catch {
    // DB unavailable → degrade gracefully: still queue + best-effort
    // Bridge fire, just no events / deliveries persisted. UI will
    // show the toast; observability is the only thing lost.
  }

  if (dbHelpers) {
    try {
      dbHelpers.insertNotificationEvent({
        event_id,
        task_id: opts.taskId ?? null,
        session_id: opts.sessionId ?? null,
        source: opts.source ?? 'codepilot',
        title: opts.title,
        body: opts.body,
        priority: opts.priority,
      });
    } catch {
      // best effort
    }
  }

  // 2. Enumerate candidate channels per priority. Each candidate gets
  //    a `notification_deliveries` row immediately. v4 plan: 1:N
  //    relationship — events row is written ONCE above; the per-channel
  //    rows below are deliveries, not extra event rows.
  //
  // v7 fix (P2) — track delivery states in a Map keyed by channel so
  // the return shape always reflects the FINAL state per channel,
  // never the queued-then-delivered history. The DB row is already
  // UPSERTed in place by upsertNotificationDelivery; the previous
  // Array-based collector pushed an extra entry on every status flip
  // and exposed `bridge-telegram: queued` + `bridge-telegram: delivered`
  // both in the API response.
  const deliveryStates = new Map<
    string,
    { status: 'queued' | 'delivered' | 'error' | 'not_configured' | 'skipped'; error?: string }
  >();

  const writeDelivery = (
    channel: string,
    status: 'queued' | 'delivered' | 'error' | 'not_configured' | 'skipped',
    error?: string,
  ): void => {
    deliveryStates.set(channel, { status, error });
    if (!dbHelpers) return;
    try {
      dbHelpers.upsertNotificationDelivery({ event_id, channel, status, error });
    } catch {
      // best effort
    }
  };

  // renderer-toast: every priority. Drives the in-app toast via the
  // /api/tasks/notify GET drain.
  writeDelivery('renderer-toast', 'queued');

  // electron-native: normal + urgent. The renderer's
  // `useNotificationPoll` hook calls `electronAPI.notification.show`
  // for these priorities; Electron bg-poller (when window is hidden)
  // shows them too.
  if (opts.priority === 'normal' || opts.priority === 'urgent') {
    writeDelivery('electron-native', 'queued');
  }

  // bridge-telegram: urgent only (v4 plan locks). For non-urgent we
  // write nothing — the absence of a bridge-* row already expresses
  // "Bridge wasn't a candidate" (product policy: remote channel is
  // urgent-only).
  if (opts.priority === 'urgent') {
    if (dbHelpers) {
      const enabled = dbHelpers.getSetting('telegram_enabled') === 'true';
      const botToken = dbHelpers.getSetting('telegram_bot_token') || '';
      const chatId = dbHelpers.getSetting('telegram_chat_id') || '';
      if (!botToken || !chatId) {
        writeDelivery('bridge-telegram', 'not_configured');
      } else if (!enabled) {
        writeDelivery('bridge-telegram', 'skipped');
      } else {
        writeDelivery('bridge-telegram', 'queued');
      }
    } else {
      // DB unavailable — record as queued in the local Map so the
      // bridge fire below can still flip it to delivered/error.
      deliveryStates.set('bridge-telegram', { status: 'queued' });
    }
  }

  // 3. Queue for renderer poll (toast surface). Carries event_id +
  //    task_id so the hook can ack after display and the click handler
  //    can route to the right page.
  enqueueNotification(opts.title, opts.body, opts.priority, {
    event_id,
    task_id: opts.taskId,
    session_id: opts.sessionId,
  });

  // 4. Bridge fire — urgent + the row we just wrote was 'queued' (i.e.,
  //    actually configured + enabled). On success / failure, flip the
  //    same delivery row in place via UPSERT. v5 plan: UNIQUE(event_id,
  //    channel) at the DB layer means duplicate INSERTs are SQL-rejected
  //    even if a buggy ack route ever tries. v7 fix: also overwrites
  //    the Map entry so the return shape carries only the final state.
  if (opts.priority === 'urgent') {
    const bridgeStatus = deliveryStates.get('bridge-telegram')?.status;
    if (bridgeStatus === 'queued') {
      try {
        const { notifyGeneric } = await import('@/lib/telegram-bot');
        await notifyGeneric(opts.title, opts.body);
        writeDelivery('bridge-telegram', 'delivered');
      } catch (err) {
        writeDelivery(
          'bridge-telegram',
          'error',
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  // v7 fix (P2) — emit one entry per channel reflecting the FINAL
  // state, not the (queued, delivered) history. Map iteration order
  // matches insertion, so renderer-toast comes before electron-native
  // before bridge-* in the response.
  // v8 fix — preserve `error` alongside `status` so external API
  // consumers (Bridge clients, /api/tasks/notify response readers,
  // future delivery-log surfaces) can show *why* a channel failed,
  // not just that it did. The DB row keeps it via
  // `upsertNotificationDelivery`; the in-memory Map keeps it on
  // `writeDelivery`; the response is the only place it was being
  // dropped. Only emit the field when actually present so successful
  // channels still serialise as `{ channel, status }` (no `error: ""`
  // noise in the response).
  const deliveries = Array.from(deliveryStates.entries()).map(
    ([channel, { status, error }]) =>
      error ? { channel, status, error } : { channel, status },
  );
  return { event_id, deliveries };
}

/**
 * Format a notification for display.
 */
export function formatNotification(title: string, body: string): string {
  return body ? `${title}: ${body}` : title;
}
