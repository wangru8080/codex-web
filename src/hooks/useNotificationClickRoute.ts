'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Phase 3 Step 3 — route Electron notification clicks to the right page.
 *
 * The OS notification carries `{ taskId?, sessionId?, event_id? }` (the
 * payload sendNotification stamped onto the events row, threaded
 * through `electron/main.ts`'s notification.show / bg-poller paths).
 * On click the main process re-opens the window and forwards the
 * payload via IPC; we listen here and `router.push` to:
 *
 *   - taskId present  → `/settings/tasks?focus=<taskId>`
 *   - sessionId only  → `/chat/<sessionId>` (a task tied to a chat
 *                       session might have a useful chat to land in;
 *                       the tasks page still has the focus row, but
 *                       the chat is the "what just happened" view)
 *   - neither         → no-op (legacy onClick payloads handled
 *                       elsewhere)
 */
export function useNotificationClickRoute(): void {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const electronAPI = (window as unknown as {
      electronAPI?: {
        notification?: {
          onClick?: (
            cb: (
              action:
                | { type: string; payload: string }
                | { taskId?: string; sessionId?: string; event_id?: string },
            ) => void,
          ) => () => void;
        };
      };
    }).electronAPI;
    const onClick = electronAPI?.notification?.onClick;
    if (!onClick) return;

    const unsubscribe = onClick((action) => {
      if (!action || typeof action !== 'object') return;
      // Task / session payload — route to /settings/tasks or /chat
      if ('taskId' in action && action.taskId) {
        router.push(`/settings/tasks?focus=${encodeURIComponent(action.taskId)}`);
        return;
      }
      if ('sessionId' in action && action.sessionId) {
        router.push(`/chat/${encodeURIComponent(action.sessionId)}`);
        return;
      }
      // Legacy onClick payload (`{ type, payload }`) — leave to other
      // listeners (e.g. AppShell's hash bridge for #providers).
    });

    return unsubscribe;
  }, [router]);
}
