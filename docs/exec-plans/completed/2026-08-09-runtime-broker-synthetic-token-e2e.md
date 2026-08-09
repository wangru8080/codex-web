# Runtime Broker 合成 Token 生产链路 E2E

状态：Smoke passed

## 目标

使用完全离线的合成 Token，验证生产 Web、root Runtime Broker、`setpriv` 用户 runtime 和配置热加载链路中的环境隔离。

## 验收

- `rrssnas` 与 `codex` runtime 读取各自 Token 的 SHA-256 短指纹，且两个指纹不同。
- Token 原值不写入结果或日志，仅存在于唯一临时 `users.json`；Token 为随机测试值，不具备任何外部权限。
- 初始 `inheritLoginEnvironment: false` 时 runtime 不出现 profile 的 `NODE_HOME`。
- 将 `codex.inheritLoginEnvironment` 改为 `true` 后，旧 Session 返回 401，旧 PID 退出，新 PID 启动。
- 新 runtime 出现 profile 的 `NODE_HOME`，同时仍读取 `codex` 自己的合成 Token。
- `rrssnas` 和其他未变化 runtime 不重启，所有 runtime 最终回收。

## 验证

- [x] Typecheck 与相关单元测试通过：6 个测试文件、43 项测试。
- [x] root 运行 `npm run test:smoke:multi-user:unified-cli`，真实 Chrome 150 CDP 通过。
- [x] Token 指纹按用户隔离；`codex` 切换前后保持自己的指纹，`rrssnas` 指纹不同。
- [x] `codex` 旧 Session 失效并自动跳转登录页，失效提示可见；PID `2483532` 被 `2483868` 替换，`nodeHomeSet` 从 `false` 变为 `true`。
- [x] 结果保存于 `/volume2/SSD/codex/Temp/codex-web-unified-cli-browser-smoke-zPAiAN/result.json`，`expiredSessionRedirectedToLogin=true`，`realCodexHomeUsed=false`。
