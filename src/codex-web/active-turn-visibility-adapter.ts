import type { AppServerTurnState } from "./turn-reducer";

export type ActiveTurnVisibility = {
  visibleTurn: AppServerTurnState | null;
  notice: { message: string; description?: string } | null;
};

export function selectVisibleActiveTurn(params: {
  activeTurn: AppServerTurnState | null;
  routeThreadId: string;
  resumedThreadId?: string | null;
}): ActiveTurnVisibility {
  const { activeTurn, routeThreadId, resumedThreadId } = params;
  if (!activeTurn || !activeTurn.threadId) {
    return { visibleTurn: null, notice: null };
  }

  if (activeTurn.threadId === routeThreadId || activeTurn.threadId === resumedThreadId) {
    return { visibleTurn: activeTurn, notice: null };
  }

  if (activeTurn.status !== "starting" && activeTurn.status !== "running") {
    return { visibleTurn: null, notice: null };
  }

  return {
    visibleTurn: null,
    notice: {
      message: "其它 Codex 会话正在运行",
      description: "当前页面只显示本会话的 app-server turn；其它 thread 的输出、approval 和工具状态不会串到本页。",
    },
  };
}
