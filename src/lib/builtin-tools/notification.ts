/**
 * builtin-tools/notification.ts — Notification tool handlers (shared between runtimes).
 *
 * These are the pure handler functions extracted from notification-mcp.ts.
 * Both SDK Runtime (via createSdkMcpServer) and Native Runtime (via AI SDK tool())
 * use these same handlers — single source of truth.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { NOTIFICATION_MCP_SYSTEM_PROMPT } from '@/lib/notification-mcp';

function getBaseUrl(): string {
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

/**
 * Phase 5d Phase 2 slice 2d (2026-05-17) — system prompt now
 * re-exports from the canonical MCP-side source. The previous local
 * Chinese paraphrase drifted shorter than the MCP authority and had
 * a slightly different vocabulary; the Expected Differences Ledger
 * entry for this drift is removed as part of this commit.
 *
 * The export name stays `NOTIFICATION_SYSTEM_PROMPT` (no underscore
 * change) so existing call sites in `builtin-tools/index.ts` keep
 * working.
 */
export const NOTIFICATION_SYSTEM_PROMPT = NOTIFICATION_MCP_SYSTEM_PROMPT;

/**
 * Phase 3 Step 4 follow-up — hidden run context for the schedule
 * tool. Mirrors `NotificationMcpContext` in notification-mcp.ts.
 * Native Runtime's tool factory closes over `{sessionId, workingDirectory}`
 * the same way the SDK MCP variant does so a model in chat session A
 * scheduling a task can't accidentally route the result to chat
 * session B (or to the buddy/heartbeat session).
 */
export interface NotificationToolsContext {
  sessionId?: string;
  workingDirectory?: string;
}

/**
 * Create notification tools as Vercel AI SDK ToolSet.
 * Can be used by both Native Runtime and as reference for SDK Runtime.
 */
export function createNotificationTools(ctx: NotificationToolsContext = {}) {
  return {
    codepilot_notify: tool({
      description: 'Send an immediate notification to the user.',
      inputSchema: z.object({
        title: z.string().describe('Notification title'),
        body: z.string().describe('Notification body text'),
        priority: z.enum(['low', 'normal', 'urgent']).optional().describe('low=toast, normal=toast+system, urgent=+telegram'),
      }),
      execute: async ({ title, body, priority }) => {
        try {
          const { sendNotification } = await import('@/lib/notification-manager');
          await sendNotification({ title, body, priority: priority || 'normal' });
          return `Notification sent: "${title}"`;
        } catch (err) {
          return `Failed to send notification: ${err instanceof Error ? err.message : 'unknown'}`;
        }
      },
    }),

    codepilot_schedule_task: tool({
      description:
        'Create a scheduled task (cron / interval / once). Pick `kind` based on user intent:\n' +
        '  - "reminder" — natural-language reminders like "remind me to drink water in 5 minutes" / ' +
        '"提醒我 9 点开会". The scheduler will pop a notification with the prompt as the body and ' +
        'will NOT call any AI model. Use this whenever the user just wants to be reminded of ' +
        'something at a future time.\n' +
        '  - "ai_task" — workflows where the user wants an AI to actually run something on a schedule, ' +
        'e.g. "every morning summarize my unread emails", "every Monday review last week\'s commits". ' +
        'The scheduler feeds the prompt to the configured provider and surfaces the AI\'s reply.',
      inputSchema: z.object({
        name: z.string().describe('Task name'),
        prompt: z.string().describe(
          'For kind=reminder: the reminder body the user will see in the notification. ' +
          'For kind=ai_task: the instruction handed to the model.',
        ),
        // Phase 3 Step 3 — kind required so reminders bypass the AI
        // path. Server validates; if this is missing, /api/tasks/schedule
        // returns 400. DB default 'ai_task' is migration-only.
        kind: z.enum(['reminder', 'ai_task']).describe(
          "Task kind: 'reminder' (notification only, no AI call) or 'ai_task' (run prompt against configured provider)",
        ),
        schedule_type: z.enum(['cron', 'interval', 'once']),
        schedule_value: z.string().describe('cron: "0 9 * * *", interval: "30m", once: ISO timestamp'),
        priority: z.enum(['low', 'normal', 'urgent']).optional(),
        notify_on_complete: z.boolean().optional(),
        durable: z.boolean().optional().describe('true=persists across restart'),
      }),
      execute: async ({ name, prompt, kind, schedule_type, schedule_value, priority, notify_on_complete, durable }) => {
        try {
          // v6 fix (P2): if `durable=false`, take the session-only
          // branch — match `notification-mcp.ts` exactly so the AI
          // SDK builtin and the MCP variant behave the same way. The
          // previous code accepted the param then silently ignored
          // it, creating a persistent task; that broke the schema's
          // implicit promise.
          if (durable === false) {
            const cryptoMod = await import('crypto');
            const { addSessionTask, parseInterval, getNextCronTime } = await import('@/lib/task-scheduler');
            const id = cryptoMod.randomBytes(8).toString('hex');
            const now = new Date();
            let next_run: string;
            if (schedule_type === 'once') {
              next_run = schedule_value; // ISO timestamp
            } else if (schedule_type === 'interval') {
              next_run = new Date(now.getTime() + parseInterval(schedule_value)).toISOString();
            } else {
              const cronNext = getNextCronTime(schedule_value);
              if (!cronNext) {
                return `Cron expression "${schedule_value}" has no valid occurrence within 4 years. Task not created.`;
              }
              next_run = cronNext.toISOString();
            }
            // v4 fix #1 — session task literal MUST carry `kind`
            // explicitly. Bypassing /api/tasks/schedule means the
            // server-side kind validation doesn't run; the in-memory
            // dispatch in executeDueTask reads task.kind directly.
            const task = {
              id,
              name,
              prompt,
              kind,
              schedule_type,
              schedule_value,
              next_run,
              consecutive_errors: 0,
              status: 'active' as const,
              priority: priority || 'normal',
              notify_on_complete: notify_on_complete === false ? 0 : 1,
              permanent: 0,
              // Hidden run context (closure-captured) — same rationale
              // as the SDK MCP variant: the model's literal args don't
              // carry which project session this task belongs to.
              origin_session_id: ctx.sessionId,
              working_directory: ctx.workingDirectory,
              created_at: now.toISOString(),
              updated_at: now.toISOString(),
            };
            addSessionTask(task);
            return `Session task "${name}" scheduled (${kind}, non-durable). ID: ${id}, next run: ${next_run}`;
          }

          // v7 fix — POST body must carry `notify_on_complete` as 0/1,
          // never raw boolean. The /api/tasks/schedule route now also
          // normalizes defensively, but matching the MCP variant here
          // keeps the wire format consistent across both AI surfaces.
          // Maps false → 0, anything else (true/undefined) → 1.
          const notifyFlag: 0 | 1 = notify_on_complete === false ? 0 : 1;
          const baseUrl = getBaseUrl();
          const res = await fetch(`${baseUrl}/api/tasks/schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name,
              prompt,
              kind,
              schedule_type,
              schedule_value,
              priority,
              notify_on_complete: notifyFlag,
              durable,
              // Hidden run context — model can't override; closure
              // value wins. Empty when the tool was registered
              // without context (legacy callers / unit tests).
              origin_session_id: ctx.sessionId,
              working_directory: ctx.workingDirectory,
            }),
          });
          const data = await res.json();
          if (!res.ok) return `Failed to create task: ${data.error || res.statusText}`;
          return `Task "${name}" created (${kind}, ${schedule_type}: ${schedule_value})`;
        } catch (err) {
          return `Failed to create task: ${err instanceof Error ? err.message : 'unknown'}`;
        }
      },
    }),

    codepilot_list_tasks: tool({
      description: 'List scheduled tasks (durable + session-only).',
      inputSchema: z.object({
        status: z.enum(['active', 'paused', 'completed', 'disabled', 'all']).optional(),
      }),
      // Phase 5e Phase 0.5 P1 parity (2026-05-17) — pre-fix this
      // handler only hit `/api/tasks/list` (durable tasks). The MCP
      // authority (`notification-mcp.ts:222-`) merges session-only
      // tasks from `getSessionTasks()` so the model sees the FULL
      // set. Native must match — running `list_tasks` in a session
      // that scheduled an in-memory task should show it.
      //
      // Phase 5e review fix P1 #3 (2026-05-18) — two bugs in the
      // first pass:
      //   1. Used `t.scheduleType / t.scheduleValue` (camelCase) on the
      //      session task rows. Actual `ScheduledTask` interface
      //      (src/types/index.ts:1683) uses `schedule_type /
      //      schedule_value` snake_case. Result: every session row
      //      rendered as `[one-shot: ]` (fallback default) instead of
      //      the real schedule.
      //   2. The `status` filter was only forwarded to the durable
      //      `/api/tasks/list` query string; session tasks were ALWAYS
      //      merged regardless of the user's filter. MCP authority
      //      (notification-mcp.ts:228) filters session tasks too —
      //      Native must match.
      execute: async ({ status }) => {
        try {
          const baseUrl = getBaseUrl();
          const qs = status ? `?status=${status}` : '';
          const res = await fetch(`${baseUrl}/api/tasks/list${qs}`);
          const data = await res.json();
          if (!res.ok) return `Failed to list tasks: ${data.error || res.statusText}`;
          const durable = (data.tasks || []) as Array<{
            id?: string;
            name: string;
            status: string;
            schedule_type: string;
            schedule_value: string;
          }>;

          // Merge session-only in-memory tasks. Apply the same status
          // filter the user requested so the merged output matches the
          // MCP authority shape.
          const sessionRows: string[] = [];
          try {
            const { getSessionTasks } = await import('@/lib/task-scheduler');
            const sessionMap = getSessionTasks();
            for (const [, task] of sessionMap) {
              if (status && status !== 'all' && task.status !== status) continue;
              sessionRows.push(
                `- ${task.name} (${task.status}, session-only) [${task.schedule_type}: ${task.schedule_value}]`,
              );
            }
          } catch {
            // task-scheduler not available — degrade to durable-only
          }

          const durableRows = durable.map(
            (t) => `- ${t.name} (${t.status}) [${t.schedule_type}: ${t.schedule_value}]`,
          );
          const all = [...durableRows, ...sessionRows];
          if (all.length === 0) return 'No scheduled tasks found.';
          return all.join('\n');
        } catch (err) {
          return `Failed to list tasks: ${err instanceof Error ? err.message : 'unknown'}`;
        }
      },
    }),

    // Phase 5e round 8 follow-up (2026-05-18) — Native parity for the
    // `assistant_buddy` capability. Previously this lived only in the
    // MCP authority (notification-mcp.ts:287); the catalog drift fix
    // in round 4 marked `assistant_buddy.exposure.native` as
    // `unsupported`. Round 8 user direction: "我们自家 Runtime 是基础
    // 盘 — CodexWeb 不能停在 7/8". This Native handler mirrors the
    // MCP version verbatim (same HTTP endpoint, same response shape,
    // same lazy `@/lib/buddy` import) so both runtimes share the
    // SAME contract — adding a stat / changing a label only needs to
    // happen in one canonical place going forward (next refactor
    // slice can extract this body to a shared helper).
    codepilot_hatch_buddy: tool({
      description:
        'Hatch a new buddy companion for the user, or update the buddy name. Call this when the user wants to adopt/hatch their buddy or give it a name.',
      inputSchema: z.object({
        buddyName: z.string().optional().describe('Name for the buddy (user-given)'),
      }),
      execute: async ({ buddyName }) => {
        try {
          const res = await fetch(`${getBaseUrl()}/api/workspace/hatch-buddy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ buddyName: buddyName || '' }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (!data.buddy) throw new Error('No buddy data');

          const b = data.buddy;
          const { SPECIES_LABEL, RARITY_DISPLAY, STAT_LABEL, SPECIES_IMAGE_URL, getBuddyTitle } =
            await import('@/lib/buddy');
          const speciesName =
            SPECIES_LABEL[b.species as keyof typeof SPECIES_LABEL]?.zh || b.species;
          const rarityInfo = RARITY_DISPLAY[b.rarity as keyof typeof RARITY_DISPLAY];
          const title = getBuddyTitle(b);
          const imageUrl = SPECIES_IMAGE_URL[b.species as keyof typeof SPECIES_IMAGE_URL] || '';
          const statsText = Object.entries(b.stats)
            .map(([stat, val]) => `${STAT_LABEL[stat as keyof typeof STAT_LABEL]?.zh || stat}: ${val}`)
            .join(' · ');

          return [
            data.alreadyHatched ? `Updated buddy name to "${buddyName}"` : `Hatched a new buddy!`,
            `Species: ${b.emoji} ${speciesName}`,
            `Rarity: ${rarityInfo?.stars || ''} ${rarityInfo?.label.zh || b.rarity}`,
            title ? `Title: "${title}"` : '',
            `Stats: ${statsText}`,
            `Peak: ${b.peakStat}`,
            imageUrl ? `Image: ${imageUrl}` : '',
            buddyName ? `Name: ${buddyName}` : '',
          ]
            .filter(Boolean)
            .join('\n');
        } catch (err) {
          return `Failed to hatch buddy: ${err instanceof Error ? err.message : 'unknown'}`;
        }
      },
    }),

    codepilot_cancel_task: tool({
      description: 'Cancel a scheduled task by ID (checks session-only tasks first, then durable).',
      inputSchema: z.object({
        task_id: z.string().describe('Task ID to cancel'),
      }),
      // Phase 5e Phase 0.5 P1 parity (2026-05-17) — pre-fix this
      // handler only DELETE'd `/api/tasks/:id` (durable). The MCP
      // authority (`notification-mcp.ts:264-`) tries
      // `removeSessionTask(task_id)` FIRST, then falls back to the
      // durable DELETE. Native must match — session-only IDs aren't
      // in the durable DB and the previous shape returned a 404 for
      // them.
      execute: async ({ task_id }) => {
        // 1. Try session-only tasks first.
        try {
          const { removeSessionTask, getSessionTasks } = await import('@/lib/task-scheduler');
          const sessionTasks = getSessionTasks();
          if (sessionTasks.has(task_id)) {
            removeSessionTask(task_id);
            return `Task ${task_id} cancelled (session-only).`;
          }
        } catch {
          // task-scheduler unavailable — fall through to durable DELETE
        }

        // 2. Fall back to durable DELETE.
        try {
          const baseUrl = getBaseUrl();
          const res = await fetch(`${baseUrl}/api/tasks/${task_id}`, { method: 'DELETE' });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            return `Failed to cancel task: ${(data as { error?: string }).error || res.statusText}`;
          }
          return `Task ${task_id} cancelled.`;
        } catch (err) {
          return `Failed to cancel task: ${err instanceof Error ? err.message : 'unknown'}`;
        }
      },
    }),
  };
}
