/**
 * skill-nudge.ts — Heuristic for suggesting when a multi-step flow
 * should be saved as a reusable Skill.
 *
 * At the end of an agent loop run, if the conversation involved enough
 * steps AND enough distinct tool calls to suggest a "workflow" rather
 * than a one-shot interaction, emit a nudge via SSE encouraging the
 * user to save the flow as a Skill they can replay later.
 *
 * Reference: docs/research/hermes-agent-analysis.md §3.6
 */

/**
 * Statistics collected during the agent loop run. Compute this from
 * the per-step tool calls accumulated in the agent loop.
 */
export interface AgentRunStats {
  /** Total number of loop iterations (agent steps). */
  step: number;
  /** Distinct tool names used across all steps. */
  distinctTools: ReadonlySet<string>;
}

/**
 * Threshold constants — chosen to avoid nudging on trivial interactions
 * while still catching moderately complex multi-step workflows.
 */
export const SKILL_NUDGE_STEP_THRESHOLD = 8;
export const SKILL_NUDGE_DISTINCT_TOOL_THRESHOLD = 3;

/**
 * Decide whether to suggest saving the current run as a Skill.
 *
 * Pure function — takes stats, returns boolean. Easy to test in
 * isolation from the agent loop.
 */
export function shouldSuggestSkill(stats: AgentRunStats): boolean {
  if (stats.step < SKILL_NUDGE_STEP_THRESHOLD) return false;
  if (stats.distinctTools.size < SKILL_NUDGE_DISTINCT_TOOL_THRESHOLD) return false;
  return true;
}

/**
 * Build the nudge payload to emit as an SSE event. Keep it short and
 * action-oriented — the model (and optionally the frontend) should be
 * able to use this to surface a "save as Skill" affordance.
 *
 * The returned object is serialized as JSON in the SSE data field.
 */
export interface SkillNudgePayload {
  type: 'skill_nudge';
  /** Human-readable suggestion shown to the user. */
  message: string;
  /** Why the nudge triggered — useful for UI and telemetry. */
  reason: {
    step: number;
    distinctToolCount: number;
    toolNames: string[];
  };
}

export function buildSkillNudgePayload(stats: AgentRunStats): SkillNudgePayload {
  const toolNames = [...stats.distinctTools].sort();
  return {
    type: 'skill_nudge',
    message:
      `This workflow involved ${stats.step} agent steps across ${toolNames.length} ` +
      `distinct tools. If you expect to repeat it, save it as a Skill for one-click replay.`,
    reason: {
      step: stats.step,
      distinctToolCount: toolNames.length,
      toolNames,
    },
  };
}

/**
 * The JSON-serializable data body for the SSE `status` event that
 * carries the skill nudge. Shape is designed to be consumed by both
 * the web SSE parser and the bridge conversation engine:
 *
 *   - Web parser (useSSEStream.ts:109-135): `notification: true` +
 *     `message` routes through `callbacks.onStatus(message)` so the
 *     nudge shows in the status bar.
 *   - Bridge parser (conversation-engine.ts:411-433): `subtype:
 *     'skill_nudge'` triggers a dedicated handler that appends the
 *     nudge to the assistant reply as a separated text block.
 *   - Future dedicated UI: `subtype` + full `payload` provide
 *     structured data for a rich nudge card.
 */
export interface SkillNudgeStatusEvent {
  notification: true;
  message: string;
  subtype: 'skill_nudge';
  payload: SkillNudgePayload;
}

/**
 * Build the SSE status event body for a skill nudge. Extracted into a
 * helper so the agent loop emits consistent shape and unit tests can
 * verify the contract without standing up the full loop.
 */
export function buildSkillNudgeStatusEvent(stats: AgentRunStats): SkillNudgeStatusEvent {
  const payload = buildSkillNudgePayload(stats);
  return {
    notification: true,
    message: payload.message,
    subtype: 'skill_nudge',
    payload,
  };
}
