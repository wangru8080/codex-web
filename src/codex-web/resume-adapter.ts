import type { ThreadResumeParams } from "@/codex/protocol/generated/v2/ThreadResumeParams";

export type BuildThreadResumeParamsInput = {
  threadId: string;
  cwd?: string;
  model?: string;
  runtimeOptions?: Pick<
    ThreadResumeParams,
    "approvalPolicy" | "approvalsReviewer" | "sandbox" | "config"
  >;
};

export function buildThreadResumeParams({
  threadId,
  cwd,
  model,
  runtimeOptions,
}: BuildThreadResumeParamsInput): ThreadResumeParams {
  return {
    threadId,
    model: model || null,
    cwd: cwd || null,
    ...runtimeOptions,
  };
}
