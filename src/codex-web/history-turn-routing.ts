export type HistoryTurnTargetInput = {
  routeThreadId: string;
  resumedThreadId?: string | null;
  requestedCwd?: string;
  routeCwd: string;
  resumedCwd?: string;
  requestedModel?: string;
  routeModel?: string;
  resumedModel?: string;
  defaultModel: string;
};

export type HistoryTurnTarget = {
  requiresResume: boolean;
  threadId: string;
  cwd: string;
  model: string;
};

export function resolveHistoryTurnTarget(input: HistoryTurnTargetInput): HistoryTurnTarget {
  const threadId = input.resumedThreadId || input.routeThreadId;
  return {
    requiresResume: !input.resumedThreadId,
    threadId,
    cwd: input.resumedCwd || input.requestedCwd || input.routeCwd,
    model: input.resumedModel || input.requestedModel || input.routeModel || input.defaultModel,
  };
}
