# Root 在线人数标识执行计划

状态：验证完成，待归档

## 目标

在聊天工作区顶部栏的 Workspace Sidebar 按钮右侧，为 `osUser=root` 的登录账号显示实时在线账号数；普通账号不可见。

## 架构

`UserRuntimeRegistry` 以拥有至少一个 peer 的用户 ID 统计在线账号。账号在离线与在线之间切换时，broker 通过已有连接只向 root runtime peer 推送 `bridge/presence/updated`；root 首次或新增页面连接时收到当前快照。浏览器把该通知写入 app-server store，顶部栏直接渲染，不增加轮询、API 或新连接。

## 实现步骤

- [x] 增加 broker presence notification 的常量、解析器和 source breadcrumb。
- [x] 增加在线账号计数，在 attach/detach 与配置重载时向 root peer 推送变化。
- [x] 在 `AppServerProvider` 接收人数并在 bridge 断线时清空。
- [x] 在 Workspace Sidebar 按钮右侧增加用户图标、人数、绿色状态点和悬停提示。
- [x] 增加中英文文案以及计数、权限、状态与 UI 接线测试。
- [x] 扩展真实 Chrome 多用户 smoke，验证 root 可见、普通账号隐藏、同账号多页面只计一人和上下线更新。
- [x] 完成定向测试、全量测试、生产 CLI 构建和桌面/移动端视觉检查。

## 成功标准

1. 在线人数按不同 broker 用户 ID 统计；同账号多 peer 只算 1。
2. 只有 `osUser=root` 的 peer 收到 presence notification。
3. root 首次连接立即收到快照，账号上线或最后一个 peer 离线后立即更新。
4. bridge 断线后隐藏旧人数，重连后由新快照恢复。
5. 普通账号页面不出现标识，也收不到人数数据。

## 决策日志

- 2026-08-04：采用现有 broker WebSocket 事件推送，不增加 10 秒轮询。
- 2026-08-04：在线定义为至少有一个浏览器 bridge peer；仅有运行中 Turn 或宽限期 app-server 不算在线。
- 2026-08-04：root 权限以 `osUser=root` 判断，不扩大到所有 `role=admin`。

## Smoke Ledger

- 已验证：root 首次连接显示 `3`，账号上线与最后一个 peer 离线时按 `3 → 4 → 3 → 2 → 1` 更新，不依赖轮询。
- 已验证：普通账号页面无标识；`rrssnas` 第二页面接入后人数仍为 `3`。
- 已验证：全局 app-server 与单账号 Turn 限制热加载后 presence 仍正常，所有 runtime、浏览器页面、Web CLI 和 broker 均已关闭。
- 已验证：桌面与 `390×844` 移动端标识无重叠。证据位于 `/volume2/SSD/codex/Temp/codex-web-multi-user-browser-smoke-q34VN4/`。
- 已验证：`npm run test`（164 个测试文件、773 项测试）与 `npm run build:cli` 通过。
