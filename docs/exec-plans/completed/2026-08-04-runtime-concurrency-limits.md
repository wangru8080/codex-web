# Runtime 并发限制执行计划

状态：已完成

## 目标

为多用户 runtime broker 增加两个可选限制：全局活跃 app-server 上限与单账号并发 Turn 上限。字段缺失表示无限制，限制变化支持热加载。

## 实现步骤

- [x] 在 broker 配置中增加 `maxActiveAppServers` 与 `users[].maxConcurrentTurns`，仅接受正整数。
- [x] 在创建新用户 runtime 前执行全局上限检查，已存在 runtime 的账号仍可重连。
- [x] 在转发 `turn/start` 前执行账号级限制，并覆盖请求已接受但事件尚未到达的并发窗口。
- [x] 热加载限制时保留现有 runtime、Session 和运行中的 Turn，只影响后续请求。
- [x] 更新 README、systemd 配置示例和多用户 runtime 技术交接文档。
- [x] 完成 targeted test、全量测试、生产构建与多用户 smoke。

## 成功标准

1. 两个字段缺失时，创建 runtime 与启动 Turn 均不受数量限制。
2. 达到全局上限后，新账号不能创建 app-server；已有账号仍可复用并重连。
3. 达到账号上限后，新的 `turn/start` 收到明确 JSON-RPC 错误，连接保持可用。
4. 同时到达的 `turn/start` 不得利用 `turn/started` 事件延迟绕过限制。
5. `turn/start` 失败或 `turn/completed` 后释放名额。
6. 热加载降低限制不终止已有工作；提高或移除限制立即允许后续请求。

## 决策日志

- 2026-08-04：字段缺失表示无限制；`0` 不作为无限制别名，避免配置歧义。
- 2026-08-04：限制是 broker 调度策略，不参与 Session credential version，也不触发 app-server 重启。
- 2026-08-04：单账号并发以该 broker 用户下全部浏览器连接与 Thread 的 Turn 总数计算。

## Smoke Ledger

- 普通路径：未配置限制时，不同账号可分别创建 runtime，同账号可发送多个 `turn/start`；单元与集成测试通过。
- 反例路径：全局上限为 2 时第三个账号 attach 被拒绝；账号上限为 1 时第二个并发 `turn/start` 收到明确错误。
- 状态变化：完成首个 Turn 后新请求恢复；运行中移除限制后第三个账号立即创建 runtime，已有 runtime 未重启。
- 真实浏览器：生产 Web + Chrome CDP 隔离 smoke 通过，结果位于 `/volume2/SSD/codex/Temp/codex-web-multi-user-browser-smoke-YVHsfR/result.json`。
- 回归：162 个测试文件、764 项测试通过；`npm run build:cli` 通过。
