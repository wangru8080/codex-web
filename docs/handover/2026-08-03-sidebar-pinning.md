# 左侧栏项目与会话置顶技术交接

> 对应计划：[左侧栏项目与会话置顶实施计划](../exec-plans/completed/2026-08-03-sidebar-pinning.md)

## 结论

左侧栏已支持项目级和会话级置顶，并对齐官方 Codex App 的条件式“置顶”分组、折叠交互与菜单文案。没有有效置顶内容时，整个“置顶”标题和箭头都不会渲染。

## 数据边界

- 会话标题、目录、更新时间和运行状态仍来自 `app-server.thread/list` 及既有 notification reducer。
- 置顶是浏览器 UI 排序偏好，分别保存在 `codex-web:pinned-projects` 和 `codex-web:pinned-sessions`。
- 项目置顶后整个项目从普通项目区移到置顶区。
- 单独置顶会话从所属普通项目中移到置顶区。
- 项目置顶覆盖内部会话的独立展示，但不会清除会话置顶偏好；取消项目置顶后，原会话置顶会恢复。
- 过期项目路径、已归档会话 ID 或损坏存储不会产生虚假置顶分组。

## 代码位置

- `src/components/layout/chat-list-utils.ts`：置顶偏好读写与纯分组函数。
- `src/components/layout/ChatListPanel.tsx`：置顶区状态、条件渲染、折叠和普通区去重。
- `src/components/layout/ProjectGroupHeader.tsx`：项目置顶/取消置顶菜单。
- `src/components/layout/SessionListItem.tsx`：会话菜单与独立置顶行的快捷图钉。
- `src/codex-web/tests/chat-list-utils.test.ts`：排序、去重、无效键和存储容错测试。
- `src/codex-web/tests/sidebar-pinning-wiring.test.ts`：UI 接线契约测试。

## 验证

- `npm exec vitest run -- src/codex-web/tests/chat-list-utils.test.ts src/codex-web/tests/sidebar-pinning-wiring.test.ts`：13 条通过。
- `npm run test`：退出码 0。
- `npm run build`：生产构建通过。
- `npm run test:smoke`：bridge smoke 通过，使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- Chrome CDP 真实浏览器：完成会话置顶、折叠/展开、项目置顶、取消项目置顶、快捷取消会话置顶；console 错误为 0。
- 截图目录：`/volume2/SSD/codex/Temp/sidebar-pinning-2026-08-03/`。

## 剩余边界

置顶偏好仅在当前浏览器配置中持久化，不跨浏览器或设备同步。若未来 app-server 提供官方置顶协议，应迁移为协议事实源并保留本地键的一次性兼容读取。
