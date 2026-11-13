# 共享桌面侧栏技术交接

关联执行计划：[2026-10-29-screen-share-sidebar.md](../exec-plans/completed/2026-10-29-screen-share-sidebar.md)
决策背景文档：[2026-10-29-screen-share-channel-exception.md](../insights/2026-10-29-screen-share-channel-exception.md)

## 功能概述

在工作区右侧栏中接入了与终端同级、可持久化的“共享桌面”（`screen-pinned`）标签页，允许用户在浏览器中实时查看并全权控制 codex-web 服务端所在主机的 X11 桌面。

## 架构与数据流

```text
Browser (/workspace/screen in iframe, noVNC)
  | binary WebSocket /screen-share/ws?token=<token>
  v
Web Bridge (ScreenShareManager + rfb-proxy)
  | RFB 3.8, terminates VNC-auth with one-time password
  v
x11vnc -localhost -rfbport <port> -once -passwdfile rm:<tempfile> -noclipboard -nosetclipboard
  |
  v
X11 Server ($DISPLAY)
```

## 核心实现模块

1. **配置与能力检测 (`server/screen-share/config.ts`, `server/screen-share/probe.ts`)**
   - 环境变量：`CODEX_WEB_SCREEN_SHARE=1` 显式开启；可选 `CODEX_WEB_SCREEN_SHARE_DISPLAY` / `CODEX_WEB_X11VNC_PATH`。
   - 边界守卫：多用户 broker 模式下无条件禁用（`enabled: false`）。
   - 能力探测：支持 Linux X11；非 Linux 或无 DISPLAY 或无 x11vnc 返回带明确原因的 `unsupported` 状态。
   - API 路由：`GET /api/codex/screen-share` 提供能力探测结果。

2. **进程管理 (`server/screen-share/x11vnc.ts`)**
   - 动态获取空闲回环端口，生成 8 字节随机密码并写入 `0600` 临时文件，传入 `rm:<file>`（x11vnc 读取后自动删除）。
   - 固定 argv 启动 `x11vnc`，无 shell，受控环境变量（仅 `DISPLAY`, `XAUTHORITY`, `PATH`, `HOME`）。
   - 连接断开、标签关闭或 bridge 退出时通过 `SIGTERM` 并在 3s 后 `SIGKILL` 清理进程。

3. **RFB 鉴权与协议代理 (`server/screen-share/rfb-proxy.ts`)**
   - 上游（x11vnc）：完成 RFB 3.8 版本握手，使用 DES-ECB（基于纯 JS 实现 `des.js`）完成 VNC-auth challenge 应答，密码无需传递至客户端。
   - 下游（浏览器）：向浏览器提供 Security Type 1 (None)，避免前端输入或保存 VNC 密码。
   - 解析 ServerInit 获取真实桌面分辨率（`data-source-breadcrumb="bridge.screen-share/rfb-serverinit"`）。
   - 过滤客户端消息：解析 RFB 客户端帧，阻断 `ClientCutText`（type 6）剪贴板内容推送。

4. **单会话排他与抢占状态机 (`server/screen-share/manager.ts`)**
   - 全局仅允许 1 个活动桌面会话。
   - 第二个客户端接入时拒绝（关闭代码 `4002`，原因 `already-active`）。
   - 客户端携带 `takeover=1` 时，强行终止旧会话（旧客户端收到 `4001`，原因 `taken-over`），由新客户端接管。
   - 审计日志：Bridge stderr 输出低噪不含敏感输入/帧数据的单行审计记录（start/stop/takeover/rejected）。

5. **前端 UI (`WorkspaceSidebar/ScreenSharePanel.tsx`, `ScreenShareFrame.tsx`)**
   - 侧栏面板嵌入 same-origin iframe 隔离 noVNC 全局环境与键盘劫持。
   - 顶部状态栏展示实时分辨率、连接状态以及在新窗口打开（Pop-out）按钮。
   - 遇冲突时展示“抢占控制”（Take over）或“重新连接”（Reconnect）交互。

## 验证与测试

- **单元测试**：
  - `server/tests/screen-share-config.test.ts`
  - `server/tests/screen-share-probe.test.ts`
  - `server/tests/screen-share-x11vnc.test.ts`
  - `server/tests/screen-share-rfb-proxy.test.ts`
  - `server/tests/screen-share-manager.test.ts`
  - `server/tests/websocket-bridge-screen-share.test.ts`
  - `src/components/layout/WorkspaceSidebar/screen-share-frame-protocol.test.ts`
  - `src/codex-web/tests/workspace-sidebar-ui-wiring.test.ts`
  - `src/lib/tests/workspace-sidebar.test.ts`
- **Smoke 测试**：
  - `pnpm run test:smoke:screen-share`：覆盖默认禁用、broker 禁用、darwin 检测、Linux 无 DISPLAY 探测、token 401 拦截、Origin 403 拦截、会话排他拒绝、takeover 抢占断开与进程清理 9 项负面/正面断言。
