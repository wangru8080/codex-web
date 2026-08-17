# 移动端恢复运行态修复实施计划

> **执行要求：** 在当前会话内按步骤实施；使用 checkbox 跟踪，不自动提交或推送。

**目标：** 移动端切到后台、WebSocket 重连或页面重新加载后，正在运行的同一 Turn 不丢失已显示内容，也不会把后续增量拼接到错误的消息。

**架构：** `thread/resume` 继续作为运行状态事实源。前端仅在服务端确认相同 `threadId + turnId` 仍为 `inProgress` 时，按 item 身份合并内存或当前标签页的恢复候选；服务端返回终态或不同 Turn 时丢弃候选。若 resume 后分页已经返回终态，则以较新的分页事实显示 assistant 最终正文。

**技术栈：** TypeScript、React 19、Codex app-server JSON-RPC、Vitest、`sessionStorage`。

## 全局约束

- 测试使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不修改官方 `/home/rrssnas/code/codex`。
- 不引入依赖，不持久化终态，不让浏览器状态覆盖 app-server 的 Turn 身份或状态。
- 只修改恢复合并、当前标签页恢复候选、Provider 接线、对应测试和 reconnect smoke。

---

### Task 1：修正同一 Turn 的语义合并

**文件：**
- 修改：`src/codex-web/resumed-turn-hydration.ts`
- 测试：`src/codex-web/tests/resumed-turn-hydration.test.ts`

**接口：**
- 消费：`mergeResumedActiveTurn(current, resumed)`。
- 产出：item 身份一致、增量字段不回退的 `AppServerTurnState | null`。

- [x] **Step 1：补失败测试**
  - 不同 assistant item 采用 resume item，不保留旧 item 正文。
  - 同一 assistant item 的前缀内容保留更完整版本，分叉内容采用 resume。
  - 合并后继续收到 delta，顶层正文与 item 正文一致。
  - plan、diff、文件 patch、MCP 和 compaction 状态不因空 resume 快照丢失。
- [x] **Step 2：运行定向测试并确认失败**
- [x] **Step 3：实现最小字段和 item 合并**
- [x] **Step 4：重跑定向测试并确认通过**

### Task 2：增加当前标签页恢复候选

**文件：**
- 新建：`src/codex-web/resumable-turn-storage.ts`
- 新建：`src/codex-web/tests/resumable-turn-storage.test.ts`
- 修改：`src/codex-web/AppServerProvider.tsx`
- 修改：`src/codex-web/tests/app-server-reconnect-wiring.test.ts`

**接口：**
- 产出：`readResumableTurn(storage, threadId)` 与 `writeResumableTurns(storage, turns)`。
- 约束：只写入 `running` Turn；读取结果仅作为 `mergeResumedActiveTurn` 的候选输入。

- [x] **Step 1：补 storage 读写与无效数据测试**
- [x] **Step 2：实现最小 JSON 适配器**
- [x] **Step 3：Provider 在 `visibilitychange/pagehide` 保存候选**
- [x] **Step 4：resume 优先使用内存状态，否则读取候选；仍由服务端 Turn 身份验证**
- [x] **Step 5：运行 storage、hydration 和 wiring 定向测试**

### Task 3：真实反例与完整验证

**文件：**
- 修改：`scripts/reconnect-smoke.ts`
- 更新：`docs/exec-plans/active/2026-08-17-mobile-resume-state-recovery.md`

- [x] **Step 1：扩展 reconnect smoke，断言合并后继续 delta 不污染正文**
- [x] **Step 2：运行 `npm run typecheck`**
- [x] **Step 3：运行全量 Vitest**
- [x] **Step 4：运行 `npm run build`**
- [x] **Step 5：运行普通 smoke、reconnect smoke 和 streaming reconnect smoke**
- [x] **Step 6：运行真实浏览器反例、`git diff --check` 并更新状态、决策日志和 Smoke Ledger**

## 状态总览

- 当前状态：代码和验证完成；计划文件等待另行确认后移动到 `completed/`。
- 完成状态词：`Code complete`、`Tests pass`、`Smoke passed`。

## 决策日志

- 2026-08-17：不再以字符串长度判断权威内容；先比较 assistant item 身份，再检查同一 item 的前缀关系。
- 2026-08-17：页面重载候选使用 `sessionStorage`，但只在 app-server 确认同一运行 Turn 后采用。
- 2026-08-17：真实浏览器发现 resume 与历史分页之间存在状态竞态；只有分页中的 Turn 仍为 `inProgress` 时才省略 assistant 历史副本，分页已完成时直接显示最终正文。

## Smoke Ledger

| 场景 | 预期 | 状态 |
|---|---|---|
| 空 resume 快照 | 保留断线前同一 item 内容 | 通过：streaming reconnect 从 20 字符合并后仍为 20 字符 |
| resume 切换 assistant item | 采用新 item，不串旧正文 | 通过：定向单元测试 |
| 合并后继续 delta | 顶层正文与 item 正文一致 | 通过：streaming reconnect 继续增长到 22 字符 |
| plan/diff/MCP/fileChange | 空快照不清空本地增量 | 通过：定向单元测试 |
| 页面重载候选 | 仅同一 inProgress Turn 恢复 | 通过：真实 Chrome 在 `RSMF0050` 时 pagehide 并刷新，候选成功落盘 |
| completed/different Turn | 不采用旧候选 | 通过：storage/hydration 单元测试；完成态刷新后候选清空为 `{}` |
| resume/pagination 终态竞态 | 分页已 completed 时显示 assistant 最终正文 | 通过：真实 Chrome 刷新后显示 `RSMF0050` 与 `RSMF0999` |
| 全量回归 | 类型、单测、构建和 bridge smoke 无回归 | 通过：195 个测试文件、960 个测试、30 个静态页面、普通与流式 smoke |
