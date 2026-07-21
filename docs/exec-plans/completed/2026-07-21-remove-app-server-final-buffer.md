# 移除 app-server 最终回答缓冲实施计划

**目标：** 让 app-server 最终回答从第一个 `item/agentMessage/delta` 开始显示，避免短回答一次性出现和中文回答额外等待。

**方案：** 保留 `StreamingMessageResponse` 的流式 Markdown 解析，仅移除 `StreamingMessage` 外层的 2.5 秒/40 词内容隐藏逻辑。中间过程、reasoning、工具输出、Plan、过程折叠和完成态不作改动。

**约束：** 不修改 app-server 协议、不引入依赖、不触碰已有用户提交；开发和验证使用隔离 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。

## 执行步骤

- [x] 修改 `src/components/chat/StreamingMessage.tsx`，直接渲染 `content`，删除仅服务于最终回答缓冲的常量、状态和定时器。
- [x] 修改 `src/components/chat/streaming-process-groups.test.ts`，增加缓冲移除的接线回归断言，并保留中间过程折叠断言。
- [x] 运行 targeted Vitest，4 个文件、31 项通过。
- [x] 运行 `npm run test`、`npm run build` 和 `npm run test:smoke`。
- [x] 记录验证结果和中文回答反例，将本计划移入 `docs/exec-plans/completed/`。

## 成功标准

- 最终回答不再经过 `BUFFER_WORD_THRESHOLD` 或 `BUFFER_MAX_MS` 延迟。
- `StreamingMessageResponse` 仍使用流式 Markdown 模式。
- 中间过程、工具调用、reasoning、Plan 和折叠行为保持原有接线。
- targeted、全量测试、构建和 smoke 命令均以实际结果记录，不虚报未运行的验证。

## 验证结果

- targeted Vitest：4 个文件、31 项通过。
- `npm run test`：typecheck 通过；101 个测试文件、486 项通过。
- `npm run build`：生产构建通过；仅有既存 Turbopack NFT tracing warning。
- `npm run test:smoke`：通过；隔离 `CODEX_HOME`，models=7，账号来源为 `app-server.account/read`。
- 反例：中文短回答不再按空格词数等待；中间过程接线断言仍通过。
