import type { Thread } from "@/codex/protocol/generated/v2/Thread";
import type { AppServerTurnState } from "./turn-reducer";

export type ActiveTurnVisibility = {
  visibleTurn: AppServerTurnState | null;
  notice: { message: string; description?: string } | null;
};

export function selectVisibleActiveTurn(params: {
  activeTurn: AppServerTurnState | null;
  routeThreadId: string;
  resumedThreadId?: string | null;
  thread?: Thread | null;
}): ActiveTurnVisibility {
  const { activeTurn, routeThreadId, resumedThreadId, thread } = params;
  if (!activeTurn || !activeTurn.threadId) {
    return selectThreadReadDegradedNotice(thread);
  }

  if (activeTurn.threadId === routeThreadId || activeTurn.threadId === resumedThreadId) {
    return { visibleTurn: activeTurn, notice: null };
  }

  if (activeTurn.status !== "starting" && activeTurn.status !== "running") {
    return selectThreadReadDegradedNotice(thread);
  }

  return {
    visibleTurn: null,
    notice: {
      message: "其它 Codex 会话正在运行",
      description: "当前页面只显示本会话的 app-server turn；其它 thread 的输出、approval 和工具状态不会串到本页。",
    },
  };
}

function selectThreadReadDegradedNotice(thread?: Thread | null): ActiveTurnVisibility {
  if (!thread || !threadReadSuggestsRunning(thread)) {
    return { visibleTurn: null, notice: null };
  }

  return {
    visibleTurn: null,
    notice: {
      message: "此会话可能仍在运行",
      description:
        "页面刷新后没有可复用的实时 notification 流；当前提示来自 app-server.thread/read，Web 不会伪造实时输出。",
    },
  };
}

function threadReadSuggestsRunning(thread: Thread): boolean {
  if (thread.status.type === "active") return true;
  return thread.turns.some((turn) => turn.status === "inProgress");
}
