# 会话模型切换标识 Implementation Plan

**目标：** 在同一会话中切换模型时展示官方 Codex App 风格的轻量标识，后续消息使用新模型，标识不进入模型上下文并在刷新后保持原位置。

**架构：** 模型列表与线程设置继续以 app-server 为事实源；切换标识仅保存模型名称和稳定的 turn 锚点到浏览器本地 UI 状态。消息列表按 turn 锚点把标识插在切换后的下一条用户消息之前。

**技术栈：** React、TypeScript、Codex app-server、Vitest、真实 Chrome CDP。

## 实施清单

- [x] 对齐官方模型切换分隔线、图标、文案和说明 Popover。
- [x] 手动切换后同步历史会话的本地发送模型，避免下一轮复用旧 `resumedModel`。
- [x] 使用稳定 app-server turn ID 恢复标识位置，不把标识作为聊天消息发送。
- [x] 修复开发 bridge URL 的服务端环境变量接线。
- [x] 修复 Turnstile 测试环境类型错误。
- [x] 增加模型切换 UI 存储和锚点测试。
- [x] 完成类型检查、定向测试、生产构建和真实浏览器正反例验证。

## Smoke Ledger

- `npm run typecheck`：通过。
- 定向 Vitest：2 个测试文件、5 项测试通过。
- `npm run build`：生产构建通过。
- 真实浏览器触发路径：GPT-5.5 第一问与回答 → 模型切换标识 → GPT-5.6-Sol 第二问与回答；`turn/start.params.model` 为 `gpt-5.6-sol`。
- 刷新反例：刷新后标识仍位于第二问之前，模型菜单保持 `5.6-Sol`，控制台无新增错误。
- `npm run test`：160 个测试文件、732 项测试全部通过。

## 自查

- 模型列表来源保持为 `app-server.model/list`。
- 模型更新继续通过 `thread/settings/update`，发送继续通过 `turn/start`。
- 标识仅属于浏览器 UI，不进入 Codex session 历史上下文。
- 未新增依赖、数据库迁移或伪造模型状态。
