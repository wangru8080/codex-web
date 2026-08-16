# 右侧终端交接

## 已交付

- 右侧工作区总览和加号菜单现在可以打开 `terminal-pinned` 标签。
- TerminalPanel 使用 `@xterm/xterm` 和 `@xterm/addon-fit`，画布为白色、等宽字体、左上角内边距，对齐官方终端参考图。
- xterm 配置完整 ANSI 16 色/亮色调色板；PTY 注入 `TERM=xterm-256color`、`COLORTERM=truecolor`、`CLICOLOR=1`，保留 shell 和工具自身的彩色输出，不修改用户 shell 配置。
- 终端通过当前 Web bridge 转发到 app-server 的 `process/spawn`、`process/writeStdin`、`process/resizePty`、`process/kill`。
- shell 的当前 cwd 来自工作区；Unix 使用目标环境的 `$SHELL`，Windows 使用 PowerShell。
- `process/outputDelta` 和 `process/exited` 按 `processHandle` 订阅，未写入通用 diagnostics；关闭标签会终止进程。

## 真实来源与边界

- 终端输出来源：`app-server.process/outputDelta`。
- 终端退出来源：`app-server.process/exited`。
- 终端启动来源：`app-server.process/spawn`。
- `process/*` 是 app-server 实验性、无 Codex sandbox 的用户终端接口；SSH/远端运行时的命令会作用于 app-server 所在远端主机。
- 如果旧版 app-server 不支持 `process/*`，Provider 请求失败后显示真实错误，不展示伪造 prompt。

## Smoke Ledger

- 普通路径：打开终端后真实显示 `(base) rrssnas@DX4600-E224:/volume2/SSD/codex/Chat$`。
- 触发路径：通过浏览器输入 `printf TERMINAL_SMOKE_OK\\n`，页面出现 `TERMINAL_SMOKE_OK`。
- 反例：终端入口之前为 disabled 占位；现在入口可用，但侧边聊天仍保持 disabled，占位状态没有被伪造为可用功能。
- 关闭路径：关闭终端标签后 `[data-testid=workspace-terminal]` 与终端标签均消失，组件 cleanup 调用 `process/kill`。
- 视觉检查：截图保存于 `/volume2/SSD/codex/Temp/codex-web-terminal-sidebar.png`，右侧终端画布白底、无额外卡片标题、prompt 位于左上区域。
- 彩色检查：截图保存于 `/volume2/SSD/codex/Temp/codex-web-terminal-colored.png`；ANSI 红/绿、24 位真彩色、彩色 prompt 和 Git 状态均实际渲染。

## 验证记录

- `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run typecheck`：通过。
- `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run test`：193 个文件、933 个测试通过。
- `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home npm run build`：通过。
- 生产服务 `http://192.168.3.12:3001`：通过浏览器验证入口、PTY 输入输出、ANSI 颜色、Ctrl-C、Git 彩色状态、画布尺寸/resize 接线、非零退出提示、窄窗口和关闭标签；console errors 为 0。
- 实测 PTY 尺寸从 `36 56` 变为 `36 69`；`sleep 30` 被 Ctrl-C 中断；`exit 7` 显示真实退出码。
- `npm run dev`：服务 ready，但 `/chat` 首次 Turbopack 编译超过 45 秒未完成；生产构建和生产服务验证正常。

## 后续风险

- 当前终端在切换到其他标签后会卸载并终止进程，再次进入会新建 shell；若需要跨标签保持会话，需要把 TerminalPanel 生命周期提升到侧栏壳层。
- `process/*` 依赖目标 app-server 版本，发布前应在旧版本矩阵中补充 unsupported smoke。
