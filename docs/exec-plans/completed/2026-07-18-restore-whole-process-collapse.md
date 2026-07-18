# 恢复整轮中间过程折叠实施计划

> **执行要求：** 在当前会话内逐项实现并验证；未经用户要求不创建 Git 提交。

**目标：** 保留连续工具组完成即折叠，同时恢复 Final answer 开始后整轮中间过程统一折叠为“已处理”的展示结构。

**架构：** 继续使用 `groupConsecutiveToolBlocks()` 和 `ToolActionsGroup` 管理连续工具子分组；在流式与历史消息外层重新接入现有 `ProcessCollapseGroup`。Final answer 位于外层折叠之外，流式过程在 final 首 token 前展开、之后折叠，历史过程默认折叠。

**技术栈：** React 19、TypeScript、Vitest、Next.js、现有 `ProcessCollapseGroup` 与 `ToolActionsGroup`。

## 全局约束

- UI 行为以官方 `codex-rs/tui` 过程语义和 `/home/rrssnas/code/CodexWeb` 样式为参考。
- 不修改 `/home/rrssnas/code/CodexWeb`，不改变 app-server 事实源或协议类型。
- 不修改连续工具分组算法、工具输出截断和“已探索 N 项”规则。
- 测试和调试显式使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 所有代码注释、文档和说明使用中文。

---

### 任务 1：锁定双层折叠接线

**文件：**

- 修改：`src/components/chat/streaming-process-groups.test.ts`

**接口：**

- 流式消息必须同时包含 `ProcessCollapseGroup`、`groupConsecutiveToolBlocks()` 和 `ToolActionsGroup`。
- 历史消息必须把 `thinking` 与 `processParts` 放入默认折叠的 `ProcessCollapseGroup`，final parts 保持在外部。

- [x] **步骤 1：把旧的“不得存在总折叠”断言改为双层折叠断言**

```ts
expect(streaming).toContain("<ProcessCollapseGroup");
expect(streaming).toContain("defaultExpanded={!finalStarted}");
expect(streaming).toContain("groupConsecutiveToolBlocks(orderedProcessBlocks)");
expect(history).toContain("<ProcessCollapseGroup");
expect(history).toContain("defaultExpanded={false}");
```

- [x] **步骤 2：运行定向测试并确认失败**

```bash
CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm exec vitest run src/components/chat/streaming-process-groups.test.ts
```

预期：流式与历史组件尚未恢复 `ProcessCollapseGroup`，两项接线测试失败；连续工具分组纯函数测试继续通过。

### 任务 2：恢复流式整轮过程折叠

**文件：**

- 修改：`src/components/chat/StreamingMessage.tsx`

**接口：**

- `finalStarted = content.trim().length > 0` 决定外层默认展开态。
- `ProcessCollapseGroup` 在 final 前 `defaultExpanded=true` 且 active，final 开始后切换为折叠。
- 内层 `processSegments` 与 legacy `toolItems` 分组逻辑保持不变。

- [x] **步骤 1：恢复导入和 final 边界**

```tsx
import { ProcessCollapseGroup, ToolActionsGroup } from '@/components/ai-elements/tool-actions-group';
const finalStarted = content.trim().length > 0;
```

- [x] **步骤 2：用外层折叠包裹现有过程内容**

```tsx
<ProcessCollapseGroup
  defaultExpanded={!finalStarted}
  active={!finalStarted && isStreaming}
  summary={<span>...</span>}
>
  <div className="w-full space-y-1">...</div>
</ProcessCollapseGroup>
```

- [x] **步骤 3：确认 Final answer 和媒体/计划块仍在外层折叠之后**

不得把 `content` 的 final answer、媒体预览或计划块移入 `ProcessCollapseGroup`。

### 任务 3：恢复历史整轮过程折叠

**文件：**

- 修改：`src/components/chat/MessageItem.tsx`

**接口：**

- 重新消费 `parseToolBlocks()` 返回的 `elapsedMs` 与 `processCount`。
- `thinking` 和 `processParts` 放进 `ProcessCollapseGroup defaultExpanded={false}`。
- `planParts` 与 `finalParts` 保持折叠外直接渲染。

- [x] **步骤 1：恢复导入和摘要元数据**

```tsx
const { text, pairedTools, renderParts, thinking, elapsedMs, processCount } = useMemo(...);
```

- [x] **步骤 2：恢复历史外层折叠**

```tsx
<ProcessCollapseGroup elapsedMs={elapsedMs} processCount={processCount} defaultExpanded={false}>
  {thinking && <ToolActionsGroup ... />}
  {processParts.map((part, index) => renderAssistantPart(part, index))}
</ProcessCollapseGroup>
```

### 任务 4：验证、清理与归档

**文件：**

- 更新并移动：`docs/exec-plans/active/2026-07-18-restore-whole-process-collapse.md` → `docs/exec-plans/completed/2026-07-18-restore-whole-process-collapse.md`

- [x] **步骤 1：运行定向与完整测试**

```bash
export NODE_HOME=/volume2/SSD/node-v24.14.0
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm exec vitest run src/components/chat/streaming-process-groups.test.ts
npm run test
```

- [x] **步骤 2：运行生产构建与 Smoke**

```bash
npm run build
npm run test:smoke
```

- [x] **步骤 3：浏览器验证双层折叠**

验证历史或完成会话首先只显示整轮“已处理”；展开后显示连续工具子组“已处理 N 项”；再次展开子组可看到独立命令结果；Final answer 始终在总折叠外。

- [x] **步骤 4：清理验证产物并归档计划**

若生成 `.playwright-mcp/`，按用户确认移动到 `/volume2/SSD/Trash/2026-07-18-codex-web-whole-process-verify/home/rrssnas/code/codex/web/.playwright-mcp`，随后归档计划。

## Smoke Ledger

| 场景 | 预期 | 结果 |
| --- | --- | --- |
| 连续两个命令运行完成 | 工具子组先折叠为“已处理 2 项” | UI 验证通过：展开整轮后子组 `aria-expanded=false` |
| Final answer 开始 | 整轮过程折叠为“已处理”，final 仍可见 | UI 验证通过：外层初始 `aria-expanded=false`，Final answer 保持可见 |
| 展开整轮过程 | 可看到过程说明和已折叠的工具子组 | UI 验证通过：外层切换为 `true`，出现“已处理 2 项”子组 |
| 再展开工具子组 | 两条命令及结果独立可见 | UI 验证通过：子组切换为 `true`，`pwd` 与 `git status --short` 结果均可见 |
| 无中间过程直接 final | 不显示空“已处理” | 代码与完整测试反例通过：仍由 `hasProcessActivity` / `hasAssistantProcess` 门禁控制 |

## 状态总览

- 当前状态：Smoke passed
- 用户影响：恢复“已处理 + Final answer”的整体结构，同时保留工具密集过程的二级折叠。
- 验证：定向测试 6 项通过；`npm run test` 通过（76 个文件、358 项测试）；`npm run build` 通过；`npm run test:smoke` 通过并确认隔离 `CODEX_HOME`；浏览器双层折叠实测通过。
- 剩余风险：页面仍持续产生既有 `/api/setup`、`/api/settings/app`、`/api/git/status` 404；生产构建仍有既有 Turbopack NFT 动态路径告警，均与本次改动无关。

## 决策日志

- 2026-07-18：采用双层折叠，整轮过程为一级，连续工具组为二级。
- 2026-07-18：流式一级折叠仍以 final answer 首 token 为边界，历史一级折叠默认关闭。
- 2026-07-18：复用隔离会话验证“已处理 12s”一级折叠与“已处理 2 项”二级折叠，Final answer 始终位于一级折叠外。
- 2026-07-18：Playwright 临时产物经用户预先确认后移入 `/volume2/SSD/Trash/2026-07-18-codex-web-whole-process-verify/`，未覆盖既有 Trash 内容。
