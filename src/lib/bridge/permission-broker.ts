/**
 * Permission Broker — forwards Claude permission requests to IM channels
 * and handles user responses via inline buttons.
 *
 * When Claude needs tool approval, the broker:
 * 1. Formats a permission prompt with inline keyboard buttons
 * 2. Sends it via the delivery layer
 * 3. Records the link between permission ID and IM message
 * 4. When a callback arrives, resolves the permission via the existing registry
 */

import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { ChannelAddress, OutboundMessage } from './types';
import type { BaseChannelAdapter } from './channel-adapter';
import { deliver } from './delivery-layer';
import { insertPermissionLink, getPermissionLink, markPermissionLinkResolved, getSession, getDb } from '../db';
import { resolvePendingPermission } from '../permission-registry';
import { escapeHtml } from './adapters/telegram-utils';

/**
 * Dedup recent permission forwards to prevent duplicate cards.
 * Key: permissionRequestId, value: timestamp. Entries expire after 30s.
 */
const recentPermissionForwards = new Map<string, number>();

/**
 * Forward a permission request to an IM channel as an interactive message.
 */
/**
 * Interactive tools that require structured user input (option picking,
 * form filling, etc.) cannot be handled by the bridge's Allow/Deny card
 * flow. These tools are explicitly denied at the broker level so the
 * model gets a clear reason and can fall back to plain text.
 *
 * AskUserQuestion is now specifically supported via buildAskUserQuestionCard()
 * and handleAskUserQuestionCallback() below (#282).
 *
 * Exported for unit testing — the check itself is pure (no IO).
 */
const BRIDGE_UNSUPPORTED_INTERACTIVE_TOOLS = new Set<string>();

export function isBridgeUnsupportedInteractiveTool(toolName: string): boolean {
  return BRIDGE_UNSUPPORTED_INTERACTIVE_TOOLS.has(toolName);
}

// ── AskUserQuestion schema (matches builtin-tools/ask-user-question.ts) ──
interface AskUserQuestion {
  header?: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

interface AskUserQuestionInput {
  questions: AskUserQuestion[];
}

export type AskUserQuestionRejectReason =
  | 'multi_question'
  | 'multi_select'
  | 'no_options';

/**
 * Check whether the AskUserQuestion input can be represented with a single
 * option-button card. Returns a reject reason for forms the bridge can't
 * faithfully render, rather than silently truncating.
 */
function validateAskUserQuestion(toolInput: Record<string, unknown>): {
  ok: true;
  question: AskUserQuestion;
} | {
  ok: false;
  reason: AskUserQuestionRejectReason;
} {
  const input = toolInput as unknown as AskUserQuestionInput;
  const questions = Array.isArray(input?.questions) ? input.questions : [];

  if (questions.length === 0) return { ok: false, reason: 'no_options' };
  // Multi-question: refuse rather than dropping questions 2..N.
  if (questions.length > 1) return { ok: false, reason: 'multi_question' };

  const q = questions[0];
  // Multi-select: single callback_data button can't encode multiple choices.
  if (q.multiSelect === true) return { ok: false, reason: 'multi_select' };
  if (!Array.isArray(q.options) || q.options.length === 0) {
    return { ok: false, reason: 'no_options' };
  }
  return { ok: true, question: q };
}

/**
 * Build an interactive AskUserQuestion card for bridge channels that support buttons.
 * Call only after validateAskUserQuestion() returned ok.
 */
function buildAskUserQuestionCard(
  permissionRequestId: string,
  question: AskUserQuestion,
): { text: string; inlineButtons: { text: string; callbackData: string }[][] } {
  const lines: string[] = [];
  if (question.header) lines.push(`<b>${escapeHtml(question.header)}</b>`);
  lines.push(escapeHtml(question.question));
  if (question.options.some((o) => o.description)) {
    lines.push('');
    for (const opt of question.options) {
      if (opt.description) {
        lines.push(`• <b>${escapeHtml(opt.label)}</b>: ${escapeHtml(opt.description)}`);
      }
    }
  }

  // Each button carries the option index. Callback format: ask:{requestId}:{optionIndex}
  const buttons = question.options.map((opt, idx) => ({
    text: opt.label,
    callbackData: `ask:${permissionRequestId}:${idx}`,
  }));

  return { text: lines.join('\n'), inlineButtons: [buttons] };
}

/** Human-readable rejection messages for unsupported AskUserQuestion forms. */
const ASK_REJECT_MESSAGES: Record<AskUserQuestionRejectReason, string> = {
  multi_question:
    'AskUserQuestion with multiple questions is not supported in IM/bridge sessions. ' +
    'Please ask one question at a time (call AskUserQuestion once per question, or ' +
    'collapse into a single question).',
  multi_select:
    'AskUserQuestion with multiSelect is not supported in IM/bridge sessions because ' +
    'the chat card only accepts a single option tap. Please rephrase as a single-choice ' +
    'question, or ask the user to reply with their selections in plain text.',
  no_options:
    'AskUserQuestion requires at least one option. Please rephrase as a plain-text question.',
};

export async function forwardPermissionRequest(
  adapter: BaseChannelAdapter,
  address: ChannelAddress,
  permissionRequestId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  sessionId?: string,
  suggestions?: unknown[],
  replyToMessageId?: string,
): Promise<void> {
  if (isBridgeUnsupportedInteractiveTool(toolName)) {
    console.log(`[bridge] Denied ${toolName} (${permissionRequestId}) — interactive tools not supported in bridge sessions`);
    resolvePendingPermission(permissionRequestId, {
      behavior: 'deny',
      message: `${toolName} is not supported in IM/bridge sessions because the chat interface cannot render interactive option selection. Please ask your question as plain text instead.`,
    });
    return;
  }

  // Check if this session uses full_access permission profile — auto-approve without IM notification
  // Note: AskUserQuestion still needs the user to pick an option, so we don't auto-approve it even
  // under full_access (the user's choice carries semantic meaning, not just consent).
  if (sessionId && toolName !== 'AskUserQuestion') {
    const session = getSession(sessionId);
    if (session?.permission_profile === 'full_access') {
      console.log(`[bridge] Auto-approved permission ${permissionRequestId} (tool=${toolName}) due to full_access profile`);
      resolvePendingPermission(permissionRequestId, { behavior: 'allow' });
      return;
    }
  }

  // Dedup: prevent duplicate forwarding of the same permission request
  const now = Date.now();
  if (recentPermissionForwards.has(permissionRequestId)) {
    console.warn(`[permission-broker] Duplicate forward suppressed for ${permissionRequestId}`);
    return;
  }
  recentPermissionForwards.set(permissionRequestId, now);
  // Clean up old entries
  for (const [id, ts] of recentPermissionForwards) {
    if (now - ts > 30_000) recentPermissionForwards.delete(id);
  }

  console.log(`[permission-broker] Forwarding permission request: ${permissionRequestId} tool=${toolName} channel=${adapter.channelType}`);

  // Channels without inline button support (e.g. QQ, Weixin) need text-based
  // permission commands. Check if the adapter ignores inlineButtons.
  const supportsButtons = !['qq', 'weixin'].includes(adapter.channelType);

  // AskUserQuestion requires option-picking UX which isn't representable in
  // channels without inline buttons. Rather than degrading to Allow/Deny (which
  // would execute the tool with empty answers), deny with a clear reason and
  // let the model fall back to plain-text questions.
  if (toolName === 'AskUserQuestion' && !supportsButtons) {
    console.log(`[bridge] Denied AskUserQuestion (${permissionRequestId}) on ${adapter.channelType} — option buttons not supported on this channel`);
    resolvePendingPermission(permissionRequestId, {
      behavior: 'deny',
      message: `AskUserQuestion is not supported on ${adapter.channelType} because the chat interface cannot render option buttons. Please ask your question as plain text instead.`,
    });
    return;
  }

  // Validate AskUserQuestion shape — refuse multi-question / multi-select /
  // empty forms rather than silently truncating to a partial answer.
  if (toolName === 'AskUserQuestion') {
    const validation = validateAskUserQuestion(toolInput);
    if (!validation.ok) {
      console.log(`[bridge] Denied AskUserQuestion (${permissionRequestId}) — ${validation.reason}`);
      resolvePendingPermission(permissionRequestId, {
        behavior: 'deny',
        message: ASK_REJECT_MESSAGES[validation.reason],
      });
      return;
    }
  }

  let message: OutboundMessage;

  // AskUserQuestion: render as question card with option buttons (#282).
  // At this point validateAskUserQuestion() has confirmed a single single-select
  // question, so the card payload is always representable.
  const validatedAsk = toolName === 'AskUserQuestion'
    ? validateAskUserQuestion(toolInput)
    : null;
  const askCard = validatedAsk?.ok
    ? buildAskUserQuestionCard(permissionRequestId, validatedAsk.question)
    : null;

  if (askCard) {
    message = {
      address,
      text: askCard.text,
      parseMode: 'HTML',
      inlineButtons: askCard.inlineButtons,
      replyToMessageId,
    };
    // Also store the original questions payload so the callback handler
    // can echo them back as updatedInput when an option is chosen.
    try {
      insertPermissionLink({
        permissionRequestId,
        channelType: adapter.channelType,
        chatId: address.chatId,
        messageId: '', // will be updated after delivery
        toolName,
        suggestions: JSON.stringify(toolInput), // reuse field — carries AUQ input
      });
    } catch { /* best effort */ }
  } else {
    // Default permission card (Allow / Allow Session / Deny)
    const inputStr = JSON.stringify(toolInput, null, 2);
    const truncatedInput = inputStr.length > 300
      ? inputStr.slice(0, 300) + '...'
      : inputStr;

    const textLines = [
      `<b>Permission Required</b>`,
      ``,
      `Tool: <code>${escapeHtml(toolName)}</code>`,
      `<pre>${escapeHtml(truncatedInput)}</pre>`,
      ``,
    ];

    if (supportsButtons) {
      textLines.push(`Choose an action:`);
    } else {
      textLines.push(
        `Reply with one of:`,
        `/perm allow ${permissionRequestId}`,
        `/perm allow_session ${permissionRequestId}`,
        `/perm deny ${permissionRequestId}`,
      );
    }

    message = {
      address,
      text: textLines.join('\n'),
      parseMode: supportsButtons ? 'HTML' : 'plain',
      inlineButtons: supportsButtons
        ? [
            [
              { text: 'Allow', callbackData: `perm:allow:${permissionRequestId}` },
              { text: 'Allow Session', callbackData: `perm:allow_session:${permissionRequestId}` },
              { text: 'Deny', callbackData: `perm:deny:${permissionRequestId}` },
            ],
          ]
        : undefined,
      replyToMessageId,
    };
  }

  const result = await deliver(adapter, message, { sessionId });

  // Record the link so we can match callback queries back to this permission.
  // For AskUserQuestion we pre-inserted; here we update messageId if needed.
  if (result.ok && result.messageId) {
    try {
      if (askCard) {
        // Update the pre-inserted link with the actual message ID.
        // (Simple re-insert; insertPermissionLink uses INSERT OR REPLACE semantics.)
        insertPermissionLink({
          permissionRequestId,
          channelType: adapter.channelType,
          chatId: address.chatId,
          messageId: result.messageId,
          toolName,
          suggestions: JSON.stringify(toolInput),
        });
      } else {
        insertPermissionLink({
          permissionRequestId,
          channelType: adapter.channelType,
          chatId: address.chatId,
          messageId: result.messageId,
          toolName,
          suggestions: suggestions ? JSON.stringify(suggestions) : '',
        });
      }
    } catch { /* best effort */ }
  }
}

/**
 * Handle an AskUserQuestion callback (ask:{requestId}:{optionIndex}).
 * Responds with updatedInput containing { questions, answers } matching the
 * native AskUserQuestion tool's expected shape.
 *
 * Returns true if the callback was recognized and handled.
 */
export function handleAskUserQuestionCallback(
  callbackData: string,
  callbackChatId: string,
  callbackMessageId?: string,
): boolean {
  const parts = callbackData.split(':');
  if (parts.length < 3 || parts[0] !== 'ask') return false;

  // permId may contain colons — everything except prefix and last index.
  const optionIndex = parseInt(parts[parts.length - 1], 10);
  if (!Number.isFinite(optionIndex) || optionIndex < 0) return false;
  const permissionRequestId = parts.slice(1, -1).join(':');

  const link = getPermissionLink(permissionRequestId);
  if (!link) return false;
  if (link.chatId !== callbackChatId) return false;
  if (callbackMessageId && link.messageId !== callbackMessageId) return false;
  if (link.resolved) return false;

  let claimed: boolean;
  try {
    claimed = markPermissionLinkResolved(permissionRequestId);
  } catch {
    return false;
  }
  if (!claimed) return false;

  // Parse the stored questions to find the chosen option label.
  let questions: AskUserQuestion[] | undefined;
  try {
    const stored = JSON.parse(link.suggestions || '{}') as AskUserQuestionInput;
    questions = stored.questions;
  } catch { /* empty */ }
  if (!questions || questions.length === 0) return false;

  const firstQuestion = questions[0];
  const option = firstQuestion.options[optionIndex];
  if (!option) return false;

  // Build answers keyed by question text (matches PermissionPrompt.tsx format).
  const answers: Record<string, string> = { [firstQuestion.question]: option.label };

  return resolvePendingPermission(permissionRequestId, {
    behavior: 'allow',
    updatedInput: { questions, answers } as Record<string, unknown>,
  });
}

/**
 * Handle a permission callback from an inline button press.
 * Validates that the callback came from the same chat AND same message that
 * received the permission request, prevents duplicate resolution via atomic
 * DB check-and-set, and implements real allow_session semantics by passing
 * updatedPermissions (suggestions).
 *
 * Returns true if the callback was recognized and handled.
 */
export function handlePermissionCallback(
  callbackData: string,
  callbackChatId: string,
  callbackMessageId?: string,
): boolean {
  // Parse callback data: perm:action:permId
  const parts = callbackData.split(':');
  if (parts.length < 3 || parts[0] !== 'perm') return false;

  const action = parts[1];
  const permissionRequestId = parts.slice(2).join(':'); // permId might contain colons

  // Look up the permission link to validate origin and check dedup
  const link = getPermissionLink(permissionRequestId);
  if (!link) {
    console.warn(`[permission-broker] No permission link found for ${permissionRequestId}`);
    return false;
  }

  // Security: verify the callback came from the same chat that received the request
  if (link.chatId !== callbackChatId) {
    console.warn(`[permission-broker] Chat ID mismatch: expected ${link.chatId}, got ${callbackChatId}`);
    return false;
  }

  // Security: verify the callback came from the original permission message
  if (callbackMessageId && link.messageId !== callbackMessageId) {
    console.warn(`[permission-broker] Message ID mismatch: expected ${link.messageId}, got ${callbackMessageId}`);
    return false;
  }

  // Dedup: reject if already resolved (fast path before expensive resolution)
  if (link.resolved) {
    console.warn(`[permission-broker] Permission ${permissionRequestId} already resolved`);
    return false;
  }

  // Atomically mark as resolved BEFORE calling resolvePendingPermission
  // to prevent race conditions with concurrent button clicks
  let claimed: boolean;
  try {
    claimed = markPermissionLinkResolved(permissionRequestId);
  } catch {
    return false;
  }

  if (!claimed) {
    // Another concurrent handler already resolved this permission
    console.warn(`[permission-broker] Permission ${permissionRequestId} already claimed by concurrent handler`);
    return false;
  }

  let resolved: boolean;

  switch (action) {
    case 'allow':
      resolved = resolvePendingPermission(permissionRequestId, {
        behavior: 'allow',
      });
      break;

    case 'allow_session': {
      // Parse stored suggestions so subsequent same-tool calls auto-approve
      let updatedPermissions: PermissionUpdate[] | undefined;
      if (link.suggestions) {
        try {
          updatedPermissions = JSON.parse(link.suggestions) as PermissionUpdate[];
        } catch { /* fall through without updatedPermissions */ }
      }

      resolved = resolvePendingPermission(permissionRequestId, {
        behavior: 'allow',
        ...(updatedPermissions ? { updatedPermissions } : {}),
      });
      break;
    }

    case 'deny':
      resolved = resolvePendingPermission(permissionRequestId, {
        behavior: 'deny',
        message: 'Denied via IM bridge',
      });
      break;

    default:
      return false;
  }

  return resolved;
}

/**
 * Auto-approve all pending permission requests for a session.
 * Called when a session switches from 'default' to 'full_access' profile.
 * Resolves in-memory pending permissions and marks DB links as resolved.
 */
export function autoApprovePendingForSession(sessionId: string): number {
  // The permission_requests DB table tracks pending permissions by session_id.
  // Find all pending ones and resolve them via the in-memory registry.
  const db = getDb();

  const pendingRows = db.prepare(
    "SELECT id FROM permission_requests WHERE session_id = ? AND status = 'pending'"
  ).all(sessionId) as { id: string }[];

  let resolved = 0;
  for (const row of pendingRows) {
    const ok = resolvePendingPermission(row.id, { behavior: 'allow' });
    if (ok) {
      resolved++;
      console.log(`[bridge] Auto-approved pending permission ${row.id} for session ${sessionId} (profile switched to full_access)`);
    }
    // Also mark the IM link as resolved so the button becomes inoperative
    try { markPermissionLinkResolved(row.id); } catch { /* best effort */ }
  }

  if (resolved > 0) {
    console.log(`[bridge] Auto-approved ${resolved} pending permission(s) for session ${sessionId}`);
  }
  return resolved;
}
