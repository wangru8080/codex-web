# 输入框插件引用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让首页、新对话和 session 页共享的输入框通过 app-server 展示并引用已安装插件，同时修复活动 writer 恢复错误。

**Architecture:** 复用现有 MessageInput、useSlashCommands 和 PopoverItem 管线。插件列表从 `plugin/installed` 获取，UI 只保存短暂的结构化插件引用，发送时由现有 turn input 构造器生成 `[@名称](plugin://插件@市场/)` 文本；session 恢复错误沿已有 app-server 状态入口收口。

**Tech Stack:** Next.js, React, TypeScript, Vitest, Codex app-server JSON-RPC。

## Global Constraints

- app-server notification/request 是 UI 事实源，不伪造插件状态。
- 浏览器不保存 OAuth/token/CODEX_HOME 凭据。
- 默认测试环境使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 代码注释、文档和测试说明使用简体中文。
- 不删除文件、不静默覆盖已有同名目标。

---

### Task 1: 插件输入数据模型与协议读取

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/hooks/useSlashCommands.ts`
- Test: `src/codex-web/tests/composer-plugin-mention-wiring.test.ts`

- [x] 为插件引用定义最小字段：名称、插件 URI、显示图标 URL、描述和 app-server 来源。
- [x] 在 `useSlashCommands` 中读取 `plugin/installed`，仅保留 `installed && enabled` 的插件，并在 `@` 触发时合并文件与插件候选。
- [x] 为插件选择返回结构化引用，不改变普通文件 mention 行为。
- [x] 用 wiring/unit 测试锁定插件 URI 格式。

### Task 2: 共享输入框菜单与弹层

**Files:**
- Modify: `src/components/chat/MessageInput.tsx`
- Modify: `src/components/chat/SlashCommandPopover.tsx`
- Modify: `src/i18n/zh.ts`

- [x] 将“+”按钮 tooltip 改为“添加文件等内容 @”。
- [x] + 菜单展示文件入口后按“插件”分组渲染真实插件图标、名称和描述。
- [x] `@` 弹层同时显示“插件”和“文件和聊天”；无文件搜索时保留“输入字符以搜索当前项目文件”。
- [x] 选择插件后在输入框上方显示可移除的图标+名称胶囊，并保留补充文本输入。

### Task 3: 发送 prompt 与活动 writer 收口

**Files:**
- Modify: `src/codex-web/turn-input.ts`
- Modify: `src/components/chat/MessageInput.tsx`
- Modify: `src/codex-web/AppServerProvider.tsx` 或实际恢复共享入口
- Test: `src/codex-web/tests/composer-plugin-mention-wiring.test.ts`
- Test: `src/codex-web/tests/active-writer-recovery.test.ts`

- [x] 发送时把插件引用编码为 `[@名称](plugin://插件@市场/)`，与用户补充内容拼接后作为真实 turn input。
- [x] 成功发送后清除插件胶囊；失败时恢复文本和插件选择。
- [x] active writer 冲突不再显示误导性的“Start a new chat”，保留线程并显示同步提示。

### Task 4: 验证

- [x] 运行 `npm run typecheck`、`npm run test`、`npm run build`。
- [x] 启动 `npm run dev` 验证 `/chat` 路由可访问；隔离环境未登录，未执行插件点击 smoke。
- [x] 检查 git diff，确认无临时产物和无关修改。
