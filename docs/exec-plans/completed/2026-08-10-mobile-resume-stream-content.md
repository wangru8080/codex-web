# 移动端重连保留流式正文执行计划

> **执行要求：** 在当前会话内逐项实施并验证；步骤使用 checkbox 跟踪。

**目标：** 移动端浏览器切到后台并重连后，保留断线前已经显示的同一 Turn 流式正文、推理内容和工具输出，不再退回“正在思考”。

**架构：** app-server 的 `thread/resume` 仍负责确认真实运行 Turn。前端只在恢复快照与当前状态具有相同 `threadId + turnId` 时合并两者；快照缺少流式增量时保留当前累计内容，快照包含更完整内容时采用快照内容。不同 Turn 不做合并。

**技术栈：** TypeScript、React 19、Codex app-server JSON-RPC、Vitest、真实 app-server smoke。

## 全局约束

- 测试使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- app-server 仍是 Turn 状态事实源，不伪造 completed、interrupted 或 failed。
- 不修改官方 `/home/rrssnas/code/codex` 代码。
- 不删除文件，不覆盖用户未提交改动，不触碰 `codex-web-0.9.6.tgz.sha`。
- 只修改恢复状态适配器、Provider 接线、对应测试和 reconnect smoke。

---

### Task 1：定义同一 Turn 的恢复合并规则

**文件：**
- 修改：`src/codex-web/resumed-turn-hydration.ts`
- 测试：`src/codex-web/tests/resumed-turn-hydration.test.ts`

**接口：**
- 消费：当前 `AppServerTurnState | null` 与 `thread/resume` 水合后的 `AppServerTurnState | null`。
- 产出：`mergeResumedActiveTurn(current, resumed): AppServerTurnState | null`。

- [x] **Step 1：写入失败测试**
  - 同一 Turn 的空 resume 快照保留已有 `assistantText`、`reasoningText`、`toolOutputs`。
  - resume 内容更长时采用 resume 内容。
  - 不同 Turn 不合并旧内容。
- [x] **Step 2：运行定向测试并确认新增断言失败**
  - 命令：`npm run test -- src/codex-web/tests/resumed-turn-hydration.test.ts`
- [x] **Step 3：实现最小合并函数**
  - 仅同一 `threadId + turnId` 合并。
  - 文本选择长度较长者；记录按 key 选择长度较长值。
- [x] **Step 4：重跑定向测试并确认通过**

### Task 2：接入 Provider 重连水合

**文件：**
- 修改：`src/codex-web/AppServerProvider.tsx`
- 测试：`src/codex-web/tests/app-server-reconnect-wiring.test.ts`

**接口：**
- 消费：`activeTurnFromResume(response)` 与当前线程的 active Turn。
- 产出：合并后的 `activeTurn`、`activeTurnsByThreadId` 和 `turnSnapshots`。

- [x] **Step 1：补 Provider 接线测试**
  - 断言 `resumeThread()` 使用 `mergeResumedActiveTurn`，不直接覆盖同一 Turn。
- [x] **Step 2：在 `setState` 内合并当前状态与 resume 快照**
  - 合并发生在读取最新 store state 时，避免请求期间的通知竞态。
- [x] **Step 3：运行恢复适配器与 reconnect wiring 定向测试**

### Task 3：真实 app-server 反例 smoke

**文件：**
- 修改：`scripts/reconnect-smoke.ts`

**接口：**
- 消费：断线前累计的 `item/agentMessage/delta` 与重连后的 `thread/resume` response。
- 产出：同一 Turn 恢复后正文不回退的 smoke 断言。

- [x] **Step 1：在 reconnect smoke 增加流式正文场景**
  - 收到首段正文后断开客户端。
  - 重连并 resume，使用产品适配器合并恢复状态。
  - 断言合并后的 `assistantText` 不短于断线前正文。
- [x] **Step 2：保留普通重连反例**
  - 已完成 Turn 再次 resume 不得恢复为 running。
- [x] **Step 3：运行 `npm run test:smoke:reconnect`**

### Task 4：完整验证与记录

**文件：**
- 更新：`docs/exec-plans/active/2026-08-10-mobile-resume-stream-content.md`

- [x] **Step 1：运行 `npm run test`**
  - 通过 PTY 执行原命令：184 files / 893 tests 全部通过。
- [x] **Step 2：运行 `npm run build`**
  - 通过 PTY 执行：Next.js 编译、TypeScript、28 个静态页面和 postbuild 全部通过。
- [x] **Step 3：运行 `npm run test:smoke`**
- [x] **Step 4：运行 `npm run test:smoke:reconnect`**
- [x] **Step 5：运行 `git diff --check` 并检查工作区状态**
- [x] **Step 6：更新状态总览、决策日志和 Smoke Ledger**

## 状态总览

- 当前状态：Code complete；Tests pass；Smoke passed；Build passed。
- 完成状态词：尚未达到 `Code complete`。

## 决策日志

- 2026-08-10：真实协议探针确认断线前收到 20 个字符，`thread/resume` 返回同一 inProgress Turn 但不含 agentMessage；前端直接覆盖导致正文消失。
- 2026-08-10：选择同一 Turn 单调合并，不引入浏览器本地持久化，不伪造 app-server 终态。
- 2026-08-10：新增三组恢复合并单测和 Provider 接线测试；定向验证 15/15 通过。
- 2026-08-10：真实重连 smoke 观测到断线前正文 20、resume 正文 0、合并正文 20，确认修复覆盖实际协议行为。

## Smoke Ledger

| 场景 | 预期 | 状态 |
|---|---|---|
| 正常运行中重连 | 恢复同一 inProgress Turn | Smoke 通过 |
| 断线前已有正文、resume 无正文 | 已显示正文不回退 | Smoke 通过（20 → 0 → 20） |
| resume 返回更完整正文 | 使用更完整正文 | 单测通过 |
| 不同 Turn | 不串入旧正文 | 单测通过 |
| 已完成 Turn 再次 resume | 不恢复为 running | Smoke 通过 |

## 验证记录

- `npm run test -- src/codex-web/tests/resumed-turn-hydration.test.ts src/codex-web/tests/app-server-reconnect-wiring.test.ts`：通过，2 files / 15 tests。
- `npm run test:smoke`：通过，5 models，账号来源为 `app-server.account/read`。
- `npm run test:smoke:reconnect`：通过，断线前正文 20、resume 正文 0、合并正文 20。
- `npm run test`：通过 PTY 执行，184 files / 893 tests。
- `npm run build`：通过 PTY 执行，Next.js 生产构建和 postbuild 通过。
- `git diff --check`：通过。
