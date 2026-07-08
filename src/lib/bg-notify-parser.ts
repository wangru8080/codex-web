/**
 * Parse notification API response for background polling.
 * Pure function — no Electron dependencies, used by both electron/main.ts
 * and unit tests.
 *
 * Phase 3 Step 3: payload now carries `event_id` + `task_id` +
 * `session_id` so the bg-poller can (a) ack the right delivery row
 * after `notification.show()` succeeds, and (b) include enough payload
 * in the OS notification's click handler to drive
 * `router.push('/settings/tasks?focus=…')` when the user clicks.
 */
export interface BgNotification {
  title: string;
  body: string;
  priority: string;
  event_id?: string;
  task_id?: string;
  session_id?: string;
}

export function parseBgNotifications(json: string): BgNotification[] {
  try {
    const parsed = JSON.parse(json);
    const notifications: BgNotification[] = parsed.notifications || [];
    // Filter out notifications without title
    return notifications.filter((n) => n.title);
  } catch {
    return [];
  }
}
