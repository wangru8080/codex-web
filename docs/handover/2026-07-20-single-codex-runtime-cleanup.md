# Codex app-server 单 Runtime 清理交接

> 对应执行计划：[移除非 Codex app-server 遗留模块实施计划](../exec-plans/completed/2026-07-20-remove-legacy-runtimes.md)

## 结论

本轮按依赖顺序完成 Tasks、Dashboard/Widget、第三方 Provider、Claude Code/Native runtime、自建图片生成、Scheduler 和相关兼容层清理。浏览器工作台的运行时事实源收敛为 `Codex app-server`，原有聊天、左右侧栏、账户、模型、Thread/Turn/Item、Goal/Plan、Approval、Skills、MCP、Plugins、文件和图片附件功能继续保留。

## 主要改动

- 移除 Tasks 设置路由、Dashboard 固定标签、runtime/provider 选择入口、图片生成和批量生成组件。
- 消息渲染不再解释 `show-widget`、`image-gen-request`、`batch-plan` 等文本伪协议。
- 移出旧 runtime、Provider、Dashboard、Scheduler、Claude Code、bridge conversation engine 和自建图片生成实现，共 225 个源码文件。
- Codex 设置页改用 `AppServerProvider` 的 `account/*` 和 `account/rateLimits/read`。
- 模型列表只读取 `app-server.model/list`，不再访问第三方 Provider API。
- 从依赖中移除 `recharts`、`html-to-image`、`pngjs`、`qrcode` 及两个对应类型包。
- 所有完整文件和目录均暂存于 `/volume2/SSD/Trash/home/rrssnas/code/codex/web/` 的原层级位置，没有执行删除命令。

## 保留边界

- 图片：保留用户附件、历史媒体展示和 app-server `image/localImage`；仅移除 Web 自建图片生成 runtime。
- 任务语义：保留 app-server Goal/Plan 和 archived Threads；仅移除 Scheduler/TodoWrite Tasks 产品面。
- 插件：保留 app-server Skills、MCP 和 Plugins 页面。
- 兼容路由：旧设置 URL 继续重定向到 `/settings/codex`，避免书签失效。

## 验证

- `npm run test`：93 个测试文件、443 条测试通过。
- 定向核心回归：10 个测试文件、62 条测试通过，覆盖 Goal、Plan、历史线程、图片附件、设置接线和单 runtime 边界。
- `npm run build`：通过，22 个路由完成生成。
- `npm run test:smoke`：通过；隔离 `CODEX_HOME`，读取 7 个模型，账户来源为 `app-server.account/read`。
- 生产页面走查：`/chat`、`/settings/codex`、`/settings/archived`、`/plugins` 均返回 HTTP 200。
- 反例扫描：生产 UI 不再引用 `/api/tasks`、`/api/providers`、`/api/dashboard`、`/api/media/generate`、`/api/claude-status`，也不再监听 Dashboard/widget/图片生成完成事件。

## 已知事项

- 构建仍有一个既存 Turbopack NFT 警告：`src/lib/theme/loader.ts` 的动态文件访问触发宽范围 trace。本轮未修改主题加载器，不影响构建成功。
- 验收实例运行在 `http://192.168.3.12:3002`，使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
