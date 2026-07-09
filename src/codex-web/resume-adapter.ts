import type { ThreadResumeParams } from "@/codex/protocol/generated/v2/ThreadResumeParams";

export type BuildThreadResumeParamsInput = {
  threadId: string;
  cwd?: string;
  model?: string;
};

export function buildThreadResumeParams({
  threadId,
  cwd,
  model,
}: BuildThreadResumeParamsInput): ThreadResumeParams {
  return {
    threadId,
    model: model || null,
    cwd: cwd || null,
    approvalPolicy: "on-request",
  };
}
