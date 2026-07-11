import type { JsonRpcMessage } from "../src/codex/protocol/json-rpc";
import type { ClientMessageInterceptor } from "./websocket-bridge";

export type ThreadTurnsListFailureInterceptorOptions = {
  failOnCall: number;
  message?: string;
};

export const failThreadTurnsListOnCallEnvName = "CODEX_WEB_FAIL_THREAD_TURNS_LIST_ON_CALL";

export function createThreadTurnsListFailureInterceptor(
  options: ThreadTurnsListFailureInterceptorOptions,
): ClientMessageInterceptor {
  let callCount = 0;
  const failOnCall = Math.max(1, options.failOnCall);
  const message = options.message ?? "Phase 6R 模拟 thread/turns/list 失败";

  return (rpcMessage: JsonRpcMessage) => {
    if (!("method" in rpcMessage) || rpcMessage.method !== "thread/turns/list" || rpcMessage.id === undefined) {
      return null;
    }

    callCount += 1;
    if (callCount !== failOnCall) {
      return null;
    }

    return {
      id: rpcMessage.id,
      error: {
        code: -32000,
        message,
      },
    };
  };
}

export function createThreadTurnsListFailureInterceptorFromEnv(
  env: Partial<NodeJS.ProcessEnv>,
): ClientMessageInterceptor | undefined {
  const failOnCall = parsePositiveInteger(env[failThreadTurnsListOnCallEnvName]);
  return failOnCall
    ? createThreadTurnsListFailureInterceptor({ failOnCall })
    : undefined;
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
