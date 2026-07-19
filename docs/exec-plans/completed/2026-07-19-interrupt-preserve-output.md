# 中断后保留输出实施计划

> **供自动化执行者使用：** 本计划按任务逐项执行；由于项目规则禁止未授权的子代理，本次在当前会话内直接实施并逐项验证。

**目标：** 用户停止正在生成的回合后，保留 app-server 已经输出的内容，不再用固定“Codex 已中断”消息替换已有输出。

**架构：** 在 app-server 消息块适配器中增加终态消息内容选择函数，集中约束 completed、interrupted 和 failed 的持久化规则。新会话页与历史会话 ChatView 复用该函数，app-server notification reducer 仍是状态事实源。

**技术栈：** TypeScript、React、Next.js、Vitest、Playwright smoke、Codex app-server。

## 全局约束

- 开发和测试显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不修改 `/home/rrssnas/code/CodexWeb`，仅沿用其现有消息展示结构。
- 不新增中断占位文本，不伪造 app-server 状态。
- 不执行删除命令，不修改无关代码。

---

### 任务 1：定义中断终态消息持久化规则

**文件：**
- 修改：`src/codex-web/app-server-message-blocks.ts`
- 测试：`src/codex-web/app-server-message-blocks.test.ts`

**接口：**
- 输入：`AppServerTurnState`，状态及内容来自 app-server notification reducer。
- 输出：`appServerTerminalTurnToMessageContent(turn): string | null`，仅为 completed/interrupted 且具有可见内容的终态返回消息内容。

- [x] **步骤 1：编写失败测试**

新增 interrupted 部分正文、interrupted 空输出、completed 正文和 failed 正文四组断言，预期在导出函数尚不存在时失败。

- [x] **步骤 2：运行定向测试确认失败**

运行：

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test -- src/codex-web/app-server-message-blocks.test.ts
```

预期：测试因 `appServerTerminalTurnToMessageContent` 尚未导出而失败。

- [x] **步骤 3：实现最小终态选择函数**

规则：

```ts
export function appServerTerminalTurnToMessageContent(
  turn: AppServerTurnState,
): string | null {
  if (turn.status !== "completed" && turn.status !== "interrupted") return null;
  if (!turn.assistantText.trim() && !turn.reasoningText.trim() && turn.items.length === 0) {
    return null;
  }
  return appServerTurnToMessageContent(turn);
}
```

- [x] **步骤 4：运行定向测试确认通过**

运行与步骤 2 相同的命令，预期目标测试文件通过。

### 任务 2：接入新会话与历史会话终态收口

**文件：**
- 修改：`src/app/chat/page.tsx`
- 修改：`src/components/chat/ChatView.tsx`

**接口：**
- 消费：任务 1 导出的 `appServerTerminalTurnToMessageContent()`。
- 产出：interrupted 有输出时保存真实输出，无输出时直接结束，不添加固定中断提示。

- [x] **步骤 1：修改两条终态 effect**

在 failed 分支继续显示错误；其余终态调用适配器，返回内容时追加助手消息，不再构造 `temp-interrupted-*` 和固定中文提示。

- [x] **步骤 2：增加静态接线反例测试**

在消息块测试中读取两处页面源码，断言两条接线均调用终态适配器，且不再包含 `Codex 已中断。可以继续发送下一轮。`。

- [x] **步骤 3：运行定向测试**

运行：

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test -- src/codex-web/app-server-message-blocks.test.ts
```

预期：中断内容规则与两条页面接线断言均通过。

### 任务 3：完整验证与记录

**文件：**
- 更新：`docs/exec-plans/active/2026-07-19-interrupt-preserve-output.md`
- 移动至：`docs/exec-plans/completed/2026-07-19-interrupt-preserve-output.md`

- [x] **步骤 1：运行完整测试**

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test
```

预期：typecheck 与全部 Vitest 测试通过。

- [x] **步骤 2：运行生产构建**

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run build
```

预期：Next.js 生产构建完成；如存在既有 warning，记录但不误报为失败。

- [x] **步骤 3：运行 smoke**

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test:smoke
```

预期：隔离环境下页面、bridge、initialize 和基础消息链路通过。

- [x] **步骤 4：启动应用并验证交互边界**

启动隔离环境开发服务器，验证中断保留已有正文，同时无输出中断不显示固定提示；无法稳定触发真实模型输出时，明确记录验证边界，不宣称该项通过。

- [x] **步骤 5：更新 Smoke Ledger 并归档计划**

记录普通 completed 与 interrupted 反例结果，将计划移动到 completed 目录。

## Smoke Ledger

| 路径 | 预期 | 状态 | 证据 |
|---|---|---|---|
| completed 有正文 | 正常保存助手消息 | 通过 | 定向单元测试、完整测试 |
| interrupted 有部分正文 | 保存已有内容，不显示固定中断提示 | 通过 | 单元测试；真实浏览器在标记出现后停止，正文保留且固定提示不存在 |
| interrupted 无输出 | 不新增助手占位消息 | 通过 | 定向单元测试 |
| failed 有正文 | 不把失败内容误存为成功助手消息 | 通过 | 定向单元测试 |

## 状态总览

- 当前状态：实现与验证完成，待归档
- 完成状态词：`Code complete`、`Tests pass`、`Smoke passed`、`Review passed`

## 决策日志

- 2026-07-19：保持 app-server `interrupted` 为 turn 级事实状态，只调整终态内容持久化；不修改 reducer 和工具状态。
- 2026-07-19：按用户要求移除固定中断提示，避免它覆盖或替代真实输出。
- 2026-07-19：定向测试先因终态适配器未导出而失败；实现后 1 个文件、11 条测试通过，`git diff --check` 通过。
- 2026-07-19：完整 `npm run test` 退出码为 0；生产构建成功生成 23 个路由，仅保留既有 NFT trace warning。
- 2026-07-19：隔离 smoke 通过，`models=7`，账号来源为 `app-server.account/read`。沙箱内首次因 `tsx` IPC socket 的 `EPERM` 失败，按规则在沙箱外重跑后通过。
- 2026-07-19：开发服务器 `/chat` 首次编译长时间无响应，停止后改用完整生产构建服务验证。CDP 中页面标题为 `CodexWeb`，聊天工作台正常渲染。
- 2026-07-19：真实中断验证使用隔离环境：流式正文出现 `INTERRUPT-PRESERVE-CHECK` 后点击停止；停止控件消失、发送控件恢复、正文仍存在，固定中断提示不存在。
- 2026-07-19：页面仍有既有 `/api/setup` 与 `/api/settings/app` 404；与终态内容改动无关，本次不扩展处理。
