import { defaultTestCodexHome } from "./test-codex-home";

export const historyPaginationRegressionNodeHome = "/volume2/SSD/node-v24.14.0";

export type HistoryPaginationRegressionPlanOptions = {
  threadId?: string;
  markerPrefix?: string;
  codexHome?: string;
};

export type HistoryPaginationRegressionStep = {
  title: string;
  command?: string;
  expected: string;
};

export function buildHistoryPaginationRegressionPlan(
  options: HistoryPaginationRegressionPlanOptions = {},
): HistoryPaginationRegressionStep[] {
  const markerPrefix = options.markerPrefix ?? "phase6t";
  const threadId = options.threadId ?? "<thread-id-from-fixture-output>";
  const codexHome = options.codexHome ?? defaultTestCodexHome;
  const envPrefix = `env NODE_HOME=${historyPaginationRegressionNodeHome} PATH=${historyPaginationRegressionNodeHome}/bin:$PATH CODEX_HOME=${codexHome}`;

  return [
    {
      title: "创建隔离长历史 fixture",
      command: `${envPrefix} ./node_modules/.bin/tsx scripts/create-long-history-fixture.ts 35 ${markerPrefix}`,
      expected: "输出 threadId、turnCount=35、markerPrefix 和 rolloutPath；rolloutPath 位于隔离 CODEX_HOME/sessions 下。",
    },
    {
      title: "复查真实 app-server 分页",
      command: `${envPrefix} ./node_modules/.bin/tsx scripts/inspect-thread-pagination.ts ${threadId} 30`,
      expected: "第一页 count=30 且 nextCursor 存在；第二页 count=5；seenTurns=35；uniqueTurns=35。",
    },
    {
      title: "启动 Load Earlier 失败注入 dev server",
      command: `${envPrefix} CODEX_WEB_FAIL_THREAD_TURNS_LIST_ON_CALL=2 npm run dev`,
      expected: "首个 thread/turns/list 用于初始加载并成功；第二个 thread/turns/list 在点击 Load Earlier 时返回测试注入错误。",
    },
    {
      title: "真实浏览器验证初始分页",
      expected: `打开 /chat/${threadId}；应看到“加载更早的消息”，看不到 ${markerPrefix}-answer-01，能看到 ${markerPrefix}-answer-06 和 ${markerPrefix}-answer-35。`,
    },
    {
      title: "真实浏览器验证 Load Earlier 失败",
      expected: `点击“加载更早的消息”后，应看到“历史分页暂不可用”；${markerPrefix}-answer-06 和 ${markerPrefix}-answer-35 仍各出现 1 次；${markerPrefix}-answer-01 仍不可见；Load Earlier 按钮消失。`,
    },
    {
      title: "标准提交前验证",
      command: `${envPrefix} npm run test && ${envPrefix} npm run build && ${envPrefix} npm run test:smoke`,
      expected: "test、build、smoke 均通过；若 build 或 smoke 在受限沙箱出现 listen/bind EPERM，按权限流程提权重跑并记录。",
    },
  ];
}
