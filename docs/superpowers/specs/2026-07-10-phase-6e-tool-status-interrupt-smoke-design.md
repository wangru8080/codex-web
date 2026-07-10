# Phase 6E：工具状态与中断反例验证设计

## 背景

Phase 6D 已经统一实时和历史工具 item 的状态映射，覆盖 `commandExecution`、`fileChange`、`mcpToolCall`、`dynamicToolCall` 和 `collabAgentToolCall`。当前仍有三项语义验收没有闭环：

- 普通消息和工具消息的反例验证。
- success、failed、interrupted 三类状态的可复现验证。
- 页面刷新后从 app-server 历史状态恢复 interrupted 提示。

当前仓库没有 Playwright E2E 测试套件。`npm run test:smoke` 验证的是 Web bridge、app-server initialize、model/list 和 account/read，不包含浏览器交互。因此 Phase 6E 采用混合验证：确定性状态边界使用单元测试，真实浏览器只验证一条隔离环境主路径。

## 官方事实源

- 工具状态来自 app-server `ThreadItem.status`、command exit code、MCP error 和 MCP content block 的 `is_error`。
- turn 状态来自 `Turn.status`，包括 `completed`、`failed`、`interrupted` 和 `inProgress`。
- 页面刷新后不再拥有原 turn 的实时 notification stream，只能读取 `thread/read` 或 `thread/turns/list` 返回的历史状态。
- `interrupted` 是 turn 级状态，不得写成工具 item 的 cancelled/interrupted 状态。

## 推荐方案

扩展现有 `active-turn-visibility-adapter`，让它在没有可复用实时 turn 时检查页面传入的最新历史 turn 状态和来源：

- 最新 turn 为 `interrupted`：返回明确的中断 notice。
- 最新 turn 为 `completed`：不显示中断 notice。
- 历史中存在 interrupted，但之后已有 completed turn：不显示过期 notice。
- thread 为 active 或存在 inProgress turn：继续使用现有“此会话可能仍在运行” degraded notice。

历史中断 notice 复用现有 `appServerNotice -> ChatView -> ErrorBanner` 接线，不新增 UI 组件，不向历史 transcript 注入伪 assistant 消息。

分页主路径建议文案：

- message：`Codex 已中断`
- description：`此状态来自 app-server.thread/turns/list 的最新 turn；可以继续发送下一轮。`

fallback 使用 `thread/read { includeTurns: true }` 时，description 中的 source breadcrumb 相应写为 `app-server.thread/read`。

## 范围

### 产品修复

- 修改 `src/codex-web/active-turn-visibility-adapter.ts`。
- 修改 `src/app/chat/[id]/page.tsx`，保存 metadata-first 历史加载得到的最新 turn status 和 source breadcrumb。
- 为最新 interrupted turn 返回来源明确的 notice。
- 保持其它 thread active turn 隔离和 active/inProgress degraded 提示不变。

### 单元测试

- 最新 turn 为 interrupted 时返回中断 notice。
- interrupted 后存在更新的 completed turn 时不显示旧中断 notice。
- completed 历史不显示中断 notice。
- 普通 agentMessage 不产生工具信息。
- command exit code 0 和非零 exit code 产生不同 `is_error`。
- turn interrupted 不改变工具 item 自身状态。

### 真实浏览器验证

使用隔离环境：

```bash
export NODE_HOME="/volume2/SSD/node-v24.14.0"
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
```

验证四条路径：

1. 普通消息：发送只要求文本回复的消息，页面不出现工具 cell。
2. success：要求 Codex 执行一个返回 exit code 0 的短命令，完成后工具 cell 显示成功状态。
3. failed：要求 Codex 执行一个明确返回非零 exit code 的短命令，完成后工具 cell 显示失败状态，展开后可见 exit code 和输出。
4. interrupted：执行长命令并点击停止；页面显示 turn interrupted。重新打开同一历史 route 后，显示带真实 source breadcrumb 的中断 notice；分页主路径应为 `app-server.thread/turns/list`，fallback 才是 `app-server.thread/read`。

真实浏览器验证允许受账号、模型、网络和 approval 状态影响。若其中一条无法触发，需要在 Smoke Ledger 中记录环境原因，不得用伪成功结果替代。

## 数据流

刷新后 interrupted 路径：

1. `/chat/[id]` 调用 `thread/read { includeTurns: false }` 获取 metadata。
2. 页面调用 `thread/turns/list { sortDirection: "desc" }`；第一页 `data[0].status` 是最新 turn status。
3. experimental 分页不可用并回退 `thread/read { includeTurns: true }` 时，从完整历史 turns 读取最新 turn status。
4. 页面构造 `latestHistoryTurn = { status, source }`：分页主路径 source 为 `app-server.thread/turns/list`，fallback source 为 `app-server.thread/read`。
5. 页面把 `Thread` metadata 和 `latestHistoryTurn` 一起传给 `selectVisibleActiveTurn()`。
6. selector 在没有当前页面可见实时 turn 时，根据最新历史 turn status 返回 interrupted 或 inProgress notice，并保留真实 source breadcrumb。
7. `/chat/[id]` 把 notice 作为 `appServerNotice` 传给 `ChatView`。
8. `ChatView` 复用现有 `ErrorBanner` 展示来源和继续发送提示。

## 边界处理

- 只检查最新 turn，不能因为更早的 interrupted turn 持续显示过期提示。
- metadata-first 主路径必须使用 `thread/turns/list(desc)` 第一项的 status 和 source，不能假设 `thread/read(includeTurns:false)` 带有 turns。
- 若存在当前页面的实时 turn，实时状态优先于历史 notice。
- 若其它 thread 正在运行，继续优先显示跨 thread 隔离 notice。
- 若 thread.status 为 active 或历史存在 inProgress turn，继续显示 existing degraded notice。
- 不把 interrupted notice 写入 `messages`，避免它进入 transcript、搜索或后续 prompt。
- 不修改 generated schema、不新增浏览器私有协议。

## 验证标准

Targeted tests：

```bash
npm run test -- src/codex-web/active-turn-visibility-adapter.test.ts
npm run test -- src/codex-web/tool-item-adapter.test.ts
npm run test -- src/codex-web/tool-adapter.test.ts
```

完整验证：

```bash
npm run test
npm run build
npm run test:smoke
```

构建后必须检查 `next-env.d.ts`。若 Next 将其改为 `./.next/types/routes.d.ts`，按用户要求恢复为 `./.next/dev/types/routes.d.ts`。

真实浏览器验证需要记录：

- 页面 route。
- 普通消息是否无工具 cell。
- success 工具 cell 状态。
- failed 工具 cell 状态和展开后的 exit code。
- interrupted 即时提示。
- 刷新后的 interrupted notice 及其 source breadcrumb。
- 浏览器 console errors / warnings。

## 不做范围

- 不引入新的 Playwright npm 依赖或持久 E2E runner。
- 不新增 turn-status 专用 UI 组件。
- 不注入伪 assistant 中断消息到历史 transcript。
- 不修改工具详情布局或折叠样式。
- 不使用本地真实 `CODEX_HOME`。
- 不处理历史归档、重命名或删除入口。
