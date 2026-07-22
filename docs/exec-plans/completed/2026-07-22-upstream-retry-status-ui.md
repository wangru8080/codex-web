# 上游模型重试状态 UI 实施计划

> **目标：** 当 app-server 因模型或上游暂时不可用而发送 `error.willRetry=true` 时，Web UI 保持 Turn 运行，并展示连接重试标题与可展开的真实错误详情。

**架构：** 复用 app-server `error` notification 作为唯一事实源。Turn reducer 保存重试状态，普通后续 notification 清除该状态；`StreamingMessage` 只负责把该状态按 CodexWeb 现有流式消息风格呈现。`willRetry=false` 仍走现有失败收口。

**技术栈：** React 19、Next.js、TypeScript、Vitest、Phosphor icons、Tailwind CSS。

## 全局约束

- 开发、测试和 smoke 显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不修改 `/home/rrssnas/code/CodexWeb`，不复制 CodexBrowser 或 CodePilot 代码。
- 用户可见错误必须来自 `app-server.notification`，不伪造重试次数或模型状态。
- 不执行删除、移动或静默覆盖操作。

## Task 1：定义协议归约契约

**文件：** `src/codex-web/turn-reducer.ts`、`src/codex-web/turn-reducer.test.ts`

- 增加 `retryStatus`，解析 `{ error: { message, additionalDetails }, willRetry }`。
- `willRetry=true` 保持 `running`；`willRetry=false` 置为 `failed`。
- 任何后续非 `error` notification 清除重试状态。
- 测试可重试正例、非重试反例和恢复清除行为。

## Task 2：接入流式 UI

**文件：** `src/app/chat/page.tsx`、`src/components/chat/MessageList.tsx`、`src/components/chat/StreamingMessage.tsx`

- 从当前 Turn 传递真实重试状态。
- 在流式消息顶部展示连接图标、重试标题、折叠/展开详情和“正在思考”状态。
- 沿用现有状态色、间距和消息容器，不改变 CodexWeb 的整体布局。

## Task 3：验证

运行 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm exec vitest run src/codex-web/turn-reducer.test.ts src/components/chat/streaming-process-groups.test.ts`，随后运行 `npm run test` 和 `npm run build`。启动 `npm run dev` 做页面启动检查，结束开发服务后记录结果。

## 状态总览

- 当前状态：Code complete、Tests pass、Smoke passed、Review passed、Release ready。
- 用户影响：上游暂时不可用时，当前 Turn 不再被提前标记失败；消息流展示 app-server 提供的重试标题与可展开详情，恢复后自动回到正常流式状态。
- 剩余风险：本次使用受控 WebSocket 协议夹具复现 app-server 活动 Turn 时序，未主动制造真实模型服务故障；真实 Chromium 已覆盖相同 `error.willRetry=true` 协议路径。

## 决策日志

- 2026-07-22：严格使用 `error.willRetry` 区分临时重试与终态失败，不根据 HTTP 文本猜测。
- 2026-07-22：重试次数和错误详情完全使用 `error.message`、`error.additionalDetails`，不在浏览器端推算。
- 2026-07-22：沿用 TUI 行为，收到后续非 `error` notification 后清除临时重试状态。
- 2026-07-22：中文界面仅本地化官方完整格式 `Reconnecting... N/M`，动态次数仍来自 app-server；其他错误标题保持原文。

## Smoke Ledger

| 日期 | 环境 | 场景 | 结果 | 说明 |
|---|---|---|---|---|
| 2026-07-22 | 隔离 CODEX_HOME，Vitest | 可重试错误、非重试反例、恢复清除与 UI 接线 | 通过 | targeted 2 个文件、25 项 |
| 2026-07-22 | 隔离 CODEX_HOME，全量 | `npm run test` | 通过 | 104 个文件、509 项 |
| 2026-07-22 | 隔离 CODEX_HOME，生产构建 | `npm run build` | 通过 | 22 个路由生成；保留既有 NFT 动态路径告警 |
| 2026-07-22 | 隔离 CODEX_HOME，开发服务 | `/chat` 页面可达性 | 通过 | 首次 Turbopack 编译后 HTTP 200 |
| 2026-07-22 | 隔离 CODEX_HOME，真实上游故障 | app-server `error.willRetry=true` | 未执行 | 未主动影响真实模型服务；由下方协议等价夹具覆盖产品路径 |
| 2026-07-22 | 真实 Chromium CDP，生产构建页面、独立 WebSocket 夹具 | 历史活动 Turn 收到 `error.willRetry=true`、展开/折叠详情、普通 notification 恢复 | 通过 | 浏览器收到 `error`、`item/started` 真实 WebSocket 帧；重试标题与 503 详情可见，折叠状态切换，恢复后节点清除；无脚本异常和横向溢出 |
| 2026-07-22 | 真实 Chromium CDP，中文界面、独立 WebSocket 夹具 | 英文协议消息连续更新 `2/5` 至 `5/5` | 通过 | 网络帧为 `Reconnecting... 2/5` 至 `5/5`；页面逐次显示“正在重新连接 2/5”至“5/5”，恢复后节点清除；无脚本异常 |
