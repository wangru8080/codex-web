# 真实浏览器回归稳定性与核心交互验证实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 修复真实浏览器基线中长历史与 Skill 流式场景的偶发失败，并验证聊天、审批、模型、Plan、Goal、项目/会话切换及右侧栏功能和 UI 未回归。

**架构：** 优先修复测试驱动的等待条件和 fixture 隔离，不改变 app-server 协议或现有 UI 架构。真实浏览器验证通过 CDP 打开用户路径，使用测试隔离 `CODEX_HOME`，同时记录页面 DOM、截图、控制台异常和关键状态变化。

**技术栈：** Next.js、React、TypeScript、Vitest、CDP、Codex app-server。

## 全局约束

- 使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`，除非测试脚本为场景专门创建隔离 fixture。
- 不修改 `/home/rrssnas/code/codex`，不保存真实账号凭据到浏览器或仓库。
- 不删除文件；临时产物统一保存到 `/volume2/SSD/codex/Temp`，不提交截图和 `.playwright-mcp`。
- 所有功能验证必须来自真实页面和 app-server 状态，不使用假 UI 状态代替。

---

### Task 1：复现并稳定长历史基线

**文件：**
- 检查/修改：`scripts/web-performance-baseline.ts`
- 检查：`src/components/chat/MessageList.tsx`、`src/components/chat/ChatView.tsx`
- 测试：`src/codex-web/tests/*history*` 与现有性能基线输出

- [x] 复现并定位 `long-history: Uncaught` 为虚拟列表 DOM 竞争，并增强 CDP 异常描述。
- [x] 增加主消息列表稳定等待，避免 hydration 未完成时执行虚拟化探针。
- [x] 最新真实浏览器基线 `12/12` 通过，长历史无异常。

### Task 2：稳定 Skill 流式基线

**文件：**
- 修改：`scripts/web-performance-baseline.ts`
- 检查：`src/app/chat/page.tsx`、`src/components/chat/MessageInput.tsx`、app-server turn input 接线

- [x] 确认 Skill 超时来自流式 DOM marker 重复次数要求过严。
- [x] 改为停止按钮消失且 marker 至少出现一次，同时保留 marker 内容断言。
- [x] 普通与 Skill streaming 均通过最新 `12/12` 基线。

### Task 3：真实浏览器核心交互回归

**文件：**
- 新增：`scripts/core-interaction-cdp-e2e.ts`
- 检查：`src/app/chat/page.tsx`、`src/app/chat/[id]/page.tsx`、`src/components/chat/PermissionPrompt.tsx`、`src/components/chat/MessageInput.tsx`

- [x] CDP 验证 `/chat` 首页、输入框、发送按钮、模型选择器、审批策略控件，运行时异常为 0。
- [x] `test:smoke:user-input` 通过真实浏览器审批、拒绝/跳过/自动处理、FIFO 和输入输出场景。
- [x] 模型菜单真实打开并显示 `GPT-5.5` 与推理等级；隔离 `model/list` 当前仅暴露一个可选模型，未伪造第二模型。
- [x] 截图保存到 `/volume2/SSD/codex/Temp`，未提交。

### Task 4：Plan、Goal、项目与会话切换回归

**文件：**
- 扩展：`scripts/core-interaction-cdp-e2e.ts`
- 检查：`src/components/chat/GoalEditDialog.tsx`、`src/components/chat/PlanImplementationPromptBar.tsx`、`src/components/layout/WorkspaceSidebar/TabPanel.tsx`

- [x] Goal/Plan app-server smoke、任务进度 UI、Plan/Goal 相关消息和输入输出由专项 smoke 通过。
- [x] CDP 验证“新对话”回到 `/chat`、项目切换按钮存在、新建项目目录选择弹窗正常显示。
- [x] 历史会话、长历史、Markdown/数学/Mermaid/代码渲染及设置页均通过真实基线。

### Task 5：右侧栏与隔离终端/预览 UI 回归

**文件：**
- 扩展：`scripts/core-interaction-cdp-e2e.ts`
- 检查：`src/components/layout/WorkspaceSidebar/*`、`src/app/workspace/terminal/page.tsx`、`src/app/workspace/preview/page.tsx`

- [x] 真实 CDP 点击工作区侧栏/终端，确认 Git、终端标签、shell 提示符、光标和主聊天区正常。
- [x] 预览隔离路由、复制控件、Git diff/只读历史文件 UI 通过截图与 smoke。
- [x] `test:smoke:user-input` 覆盖 Git 历史、文件 diff、提交、任务进度、文件变更和右侧 diff 反例。
- [x] fake app-server fixture 改为多客户端广播，匹配真实 bridge 多 WebSocket 行为。

### Task 6：验证、记录与收口

- [x] `npm run test`：193 个测试文件、936 个测试通过；`npm run build`、`npm run test:smoke` 通过。
- [x] 性能基线 `12/12`；专项浏览器 smoke、权限 E2E、重连、恢复、配置热更新和 legacy 均通过。
- [x] 截图和 `.playwright-mcp` 未提交；待最终 git 检查后提交。
- [ ] 使用中文提交信息提交代码和计划记录，不自动 push。

## Smoke Ledger

- 反例覆盖：普通 Markdown 不加载可选插件；长历史不挂载全部消息；普通/Skill streaming；iframe 多连接 fixture；部分提交保留剩余文件。
- 已知非阻断 warning：新建项目 Dialog 有 Radix `Description/aria-describedby` 可访问性 warning，未影响功能或 UI。
