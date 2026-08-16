# 右侧终端 Implementation Plan

状态：Code complete；Tests pass；Smoke passed；Release ready

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在已优化的右侧工作区侧栏中接入真实 app-server PTY 终端，并使终端画布对齐官方应用的纯白、左上角 shell prompt 形态。

**Architecture:** 浏览器继续通过现有 Web bridge 与 app-server 通信，不在浏览器或自定义 bridge 中启动进程。Provider 负责 `process/*` 生命周期和 notification 分发，TerminalPanel 负责 xterm.js 渲染、输入和尺寸同步，侧栏只负责标签与面板路由。

**Tech Stack:** Next.js、React、TypeScript、Codex app-server `process/*` experimental API、`@xterm/xterm`、`@xterm/addon-fit`、Vitest。

## Global Constraints

- 默认测试环境使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不修改 `~/code/codex`，不绕过 Web bridge，不在浏览器保存凭据。
- 终端目标是 app-server 所在主机；SSH 场景下必须明确按远端 cwd 运行。
- `process/*` 是无沙箱实验性接口，只能由用户显式打开终端触发；断线或关闭时终止进程。
- 所有用户可见状态必须来自 app-server request/notification；不展示伪造的运行状态。

---

### Task 1: 安装终端渲染依赖并定义协议适配

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/codex-web/process-terminal.ts`
- Create: `src/codex-web/tests/process-terminal.test.ts`

- [x] 安装 `@xterm/xterm@6.0.0` 与 `@xterm/addon-fit@0.11.0`。
- [x] 定义 process 参数、输出 notification 类型、base64 编解码和 Unix/Windows shell argv 构造。
- [x] 为参数构造、notification 解析、退出状态和空输出写测试。

### Task 2: 接入 AppServerProvider

**Files:**
- Modify: `src/codex-web/AppServerProvider.tsx`

- [x] 增加 `spawnProcess`、`writeProcessStdin`、`resizeProcessPty`、`killProcess` actions。
- [x] 增加按 `processHandle` 订阅 output/exited notification 的生命周期 API。
- [x] 让进程 notification 不进入通用诊断历史，保留真实退出错误。
- [x] bridge 断线和 Provider 卸载时清理订阅；终端关闭时显式 kill。

### Task 3: 接入右侧栏终端标签和面板

**Files:**
- Modify: `src/lib/workspace-sidebar.ts`
- Modify: `src/components/layout/WorkspaceSidebar/TabBar.tsx`
- Modify: `src/components/layout/WorkspaceSidebar/TabPanel.tsx`
- Create: `src/components/layout/WorkspaceSidebar/TerminalPanel.tsx`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`

- [x] 增加可关闭的 `terminal-pinned` 标签，启用总览和加号菜单终端入口。
- [x] TerminalPanel 挂载 xterm.js，白色画布、左上角内边距、等宽字体和无额外卡片标题。
- [x] 打开时按当前 cwd 启动真实 shell；键盘输入、PTY 输出、FitAddon resize 全部走 Provider actions。
- [x] 失败、不支持和退出状态显示真实错误；不生成假 prompt 或假运行数字。

### Task 4: 验证和文档收口

**Files:**
- Modify: `src/codex-web/tests/workspace-sidebar-ui-wiring.test.ts`
- Modify: `docs/exec-plans/active/2026-08-16-terminal-sidebar.md`
- Create: `docs/handover/2026-08-16-terminal-sidebar.md`

- [x] 运行 process adapter、workspace sidebar targeted tests。
- [x] 使用隔离 `CODEX_HOME` 运行 `npm run typecheck`、`npm run test`、`npm run build`。
- [x] 启动生产服务做浏览器验证：打开终端、执行命令、输入、ANSI 颜色、Ctrl-C、Git 彩色状态、画布尺寸/resize 接线、非零退出、窄窗口、关闭标签；旧 app-server unsupported 仅保留真实错误收口，未单独启动旧版本运行验证。
- [x] 更新 Smoke Ledger/交接文档，记录真实 app-server 来源和剩余风险。
