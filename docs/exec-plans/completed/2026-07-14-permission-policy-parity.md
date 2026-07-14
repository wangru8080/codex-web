# 权限策略功能对齐执行计划

> 本计划用于将 Codex Web 的四项权限菜单与官方 Codex App/TUI 的 app-server 行为对齐。

**目标：** 菜单选择、当前线程权限、审批请求和自定义配置均以 app-server 的真实权限状态为准。

**范围：** 请求批准、替我审批、完全访问、自定义（config.toml）；不修改 `/home/rrssnas/code/CodexWeb`，不使用真实生产 `CODEX_HOME`。

## 执行步骤

- [x] 核对隔离 app-server 的 `config/read`、`permissionProfile/list`、`configRequirements/read`、`thread/settings/update` 能力。
- [x] 对齐新建、恢复和下一轮 Turn 的四项权限参数。
- [x] 菜单选择后立即发送 `thread/settings/update`，等待 `thread/settings/updated` 确认。
- [x] 自定义模式恢复当前工作目录的完整有效权限配置，不伪造固定预设。
- [x] 保持命令、文件变更、权限提升三类审批响应符合官方 schema。
- [x] 增加单元测试、反例测试和隔离 app-server smoke。
- [x] 运行完整验证并归档本计划。

## 官方行为基准

- 请求批准：`on-request`、`user`、workspace 权限，网络和工作区外操作需要用户审批。
- 替我审批：`on-request`、`auto_review`、workspace 权限，审批由 Auto Review 判断。
- 完全访问：`never`、无权限沙箱，不产生普通权限审批。
- 自定义：使用 app-server 针对当前工作目录解析出的配置、命名权限 profile 和管理约束。

## Smoke Ledger

- `npm run test`：37 个测试文件、174 项测试通过。
- `npm run build`：生产构建通过；保留仓库已有的 NFT 动态路径追踪警告。
- `npm run test:smoke`：隔离 app-server bridge、模型和账号来源通过。
- `npm run test:smoke:permissions`：真实 app-server 依次确认 Auto Review、请求批准、完全访问和 config profile。
- 反例：首先发送与当前配置相同的“请求批准”不会产生 `thread/settings/updated`；改为先切换 Auto Review 后，通知按预期产生，说明 UI 不能仅以请求返回判断设置变化。
- CDP 历史会话：首次切换先执行 `thread/resume`；四项选择均发送真实 `thread/settings/update`，并收到对应 `thread/settings/updated`。请求批准为 `on-request/user/:workspace`，替我审批为 `on-request/auto_review/:workspace`，完全访问为 `never/user/:danger-full-access`，自定义显式恢复 `config/read` 的默认 `on-request/user/workspaceWrite`。
- CDP 新建会话：首条回复完成后立即切换“替我审批”，请求使用新线程 ID，收到 `auto_review` 的完整线程设置通知。
- CDP 反例：权限切换过程中没有 `/api/chat/sessions/*` 请求、`thread not found`、权限更新失败或重复的本地成功状态；页面仍有不属于本计划的旧 `/api/setup`、`/api/settings/*`、`/api/git/status` 等 404。
- 真实工具 E2E：四项均让 `gpt-5.6-sol` 实际调用 shell，在工作区外写 marker 并通过 HTTPS 下载 `https://example.com/`。请求批准和自定义各产生 1 次用户 approval；替我审批产生 0 次用户 approval 且 Auto Review 返回 `approved`；完全访问产生 0 次 approval。四个 marker 内容与预期一致，四个联网文件均为 559 字节并包含 `Example Domain`。
- 真实工具 E2E 产物：`/volume2/SSD/codex/Temp/codex-permission-e2e-20260714-142802`，按清理规则保留，未执行删除或移动。
