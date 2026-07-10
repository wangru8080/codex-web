import type { Thread } from "@/codex/protocol/generated/v2/Thread";
import type { TurnStatus } from "@/codex/protocol/generated/v2/TurnStatus";
import type { AppServerTurnState } from "./turn-reducer";

export type HistoryTurnStatusSource =
  | "app-server.thread/turns/list"
  | "app-server.thread/read";

export type LatestHistoryTurn = {
  status: TurnStatus;
  source: HistoryTurnStatusSource;
};

export type ActiveTurnVisibility = {
  visibleTurn: AppServerTurnState | null;
  notice: { message: string; description?: string } | null;
};

export function selectVisibleActiveTurn(params: {
  activeTurn: AppServerTurnState | null;
  routeThreadId: string;
  resumedThreadId?: string | null;
  thread?: Thread | null;
  latestHistoryTurn?: LatestHistoryTurn | null;
}): ActiveTurnVisibility {
  const { activeTurn, routeThreadId, resumedThreadId, thread, latestHistoryTurn } = params;
  if (!activeTurn || !activeTurn.threadId) {
    return selectHistoryNotice(thread, latestHistoryTurn);
  }

  if (activeTurn.threadId === routeThreadId || activeTurn.threadId === resumedThreadId) {
    return { visibleTurn: activeTurn, notice: null };
  }

  if (activeTurn.status !== "starting" && activeTurn.status !== "running") {
    return selectHistoryNotice(thread, latestHistoryTurn);
  }

  return {
    visibleTurn: null,
    notice: {
      message: "其它 Codex 会话正在运行",
      description: "当前页面只显示本会话的 app-server turn；其它 thread 的输出、approval 和工具状态不会串到本页。",
    },
  };
}

function selectHistoryNotice(
  thread?: Thread | null,
  latestHistoryTurn?: LatestHistoryTurn | null,
): ActiveTurnVisibility {
  const suggestsRunning =
    latestHistoryTurn?.status === "inProgress" ||
    (!!thread && threadReadSuggestsRunning(thread));
  if (suggestsRunning) {
    return {
      visibleTurn: null,
      notice: {
        message: "此会话可能仍在运行",
        description:
          `页面刷新后没有可复用的实时 notification 流；当前提示来自 ${
            latestHistoryTurn?.status === "inProgress"
              ? latestHistoryTurn.source
              : "app-server.thread/read"
          }，Web 不会伪造实时输出。`,
      },
    };
  }

  if (latestHistoryTurn?.status === "interrupted") {
    return {
      visibleTurn: null,
      notice: {
        message: "Codex 已中断",
        description:
          `此状态来自 ${latestHistoryTurn.source} 的最新 turn；可以继续发送下一轮。`,
      },
    };
  }

  return { visibleTurn: null, notice: null };
}

function threadReadSuggestsRunning(thread: Thread): boolean {
  if (thread.status.type === "active") return true;
  return thread.turns.some((turn) => turn.status === "inProgress");
}
