# 线程运行设置持久化与完全访问修复计划

**状态：已完成**

> **执行要求：** 在当前会话逐项实施并更新状态；使用隔离 `CODEX_HOME` 验证，不自动提交 Git。

**目标：** 模型、推理等级和审批策略按 Codex thread 独立保持，刷新、切换会话和退出登录后不回退；新对话使用 app-server 有效配置；完全访问确认不再锁死页面。

**协议依据：** 模型目录来自 `model/list`，首页有效配置来自 `config/read`。运行中线程通过 `thread/settings/update` 修改，并以 `thread/settings/updated` 为事实源；历史线程通过 `thread/resume` 恢复。浏览器保存的只是不随 app-server 进程重启丢失的用户选择，恢复时必须重新提交 app-server，不能只更新 UI。

## 实施清单

- [x] 增加按 `threadId` 隔离的模型、推理等级和审批策略偏好存储。
- [x] 从 `thread/resume` / `thread/settings/updated` 映射当前审批策略。
- [x] 历史会话恢复偏好并重新提交 app-server。
- [x] 新线程创建及后续选择时保存实际设置。
- [x] 新对话从有效 `config/read` 解析审批策略，缺省时使用 Codex 默认。
- [x] 修复权限下拉与完全访问确认框的模态切换。
- [x] 运行定向测试、完整测试、构建、权限 Smoke 和实际 UI 验证。

## Smoke Ledger

- 定向测试：线程偏好、权限映射、新对话默认值、恢复接线、动态推理档位等 8 个用例通过。
- 完整测试：`npm run test` 通过，共 169 个测试文件、792 项测试，包含 TypeScript 检查。
- 生产构建：`npm run build` 通过，生成 26 个静态页面。
- 真实协议 Smoke：`npm run test:smoke:permissions` 通过；`:workspace` 用户审批、`:workspace` 自动审批、`:danger-full-access` 和 config 档均收到匹配的 `thread/settings/updated`。
- 首页反例：从“请求批准”切换到“完全访问权限”并确认后，警告框和菜单均关闭，`body.pointerEvents` 为空，页面可继续交互。
- 历史 session 反例：选择 `GPT-5.5 / max / 完全访问权限` 后，刷新、切换到其他 session 再返回、退出 Web 登录再登录，三项均保持不变，并重新提交 app-server。
- 动态档位：实际 `model/list` 对 GPT-5.6-Sol 返回 6 档，UI 全量展示，不再硬编码为 4 项；补齐 `ultra` 中英文文案。
- 首页默认值：隔离 `config/read` 的有效模型与 effort 显示为 `GPT-5.5 / low`，审批策略按有效配置显示为“请求批准”。
- 浏览器控制台仍有既有 `/api/settings/workspace` 404；其他标签页还保留已停止的 `37695` 服务连接错误，均与本次改动无关。
- 验证环境：`CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`；一次性 `3002` 测试服务已停止。
