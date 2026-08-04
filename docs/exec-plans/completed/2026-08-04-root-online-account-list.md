# Root 在线账号分页列表实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** root 点击在线人数标识后，可按 cursor 分页、搜索并查看在线账号；普通账号不能查询或看到入口。

**Architecture:** 保留 `bridge/presence/updated` 的轻量人数推送，在 runtime registry 内截获新的 `bridge/presence/list` JSON-RPC 请求。列表只在 Popover 打开或搜索、滚动时按需读取，使用稳定排序、服务端 cursor 和前端虚拟列表，避免在线账号达到 10,000 时推送完整列表。

**Tech Stack:** TypeScript、JSON-RPC、React 19、Radix Popover、react-virtuoso、Vitest、Playwright/CDP smoke。

## 全局约束

- 列表查询只允许 `osUser === "root"` 的账号。
- 默认每页 50 条，最大 100 条；不提供加载全部。
- 人数推送不携带账号列表。
- 不返回密码、home、`CODEX_HOME`、cwd 或 PID。
- 普通账号必须有权限反例测试，少量账号必须有单页反例测试。
- 不新增依赖，不修改官方 Codex app-server 协议。

---

### Task 1: Broker 分页协议与权限

**Files:**
- Modify: `src/codex-web/broker-presence.ts`
- Modify: `server/user-runtime-registry.ts`
- Test: `server/tests/user-runtime-registry.test.ts`
- Test: `src/codex-web/tests/broker-presence.test.ts`

**Interfaces:**
- Consumes: 已认证 runtime peer 与 `RuntimeBrokerUserConfig`。
- Produces: `BROKER_PRESENCE_LIST_METHOD`、`BrokerPresenceListParams`、`BrokerPresenceListResponse`、`listOnlineUsers()`。

- [x] **Step 1: 写分页、搜索、权限和少量账号失败测试**

```ts
expect(page.items.map((item) => item.email)).toEqual(["a@example.com", "b@example.com"]);
expect(page.nextCursor).toBeTruthy();
expect(nonRootResponse.error?.code).toBe(-32003);
expect(singlePage.nextCursor).toBeNull();
```

- [x] **Step 2: 运行定向测试并确认失败**

```bash
npx vitest run server/tests/user-runtime-registry.test.ts src/codex-web/tests/broker-presence.test.ts
```

Expected: FAIL，缺少在线账号分页协议或 registry 分支。

- [x] **Step 3: 实现最小 cursor 分页与直接 JSON-RPC 响应**

```ts
if (message.method === BROKER_PRESENCE_LIST_METHOD) {
  if (entry.user.osUser !== "root") return sendError(peer, message.id, -32003, "无权查看在线账号");
  return sendResult(peer, message.id, this.listOnlineUsers(message.params));
}
```

- [x] **Step 4: 运行定向测试并确认通过**

```bash
npx vitest run server/tests/user-runtime-registry.test.ts src/codex-web/tests/broker-presence.test.ts
```

Expected: PASS。

### Task 2: 前端分页 Popover

**Files:**
- Create: `src/components/layout/OnlineUsersPopover.tsx`
- Modify: `src/components/layout/UnifiedTopBar.tsx`
- Modify: `src/codex-web/AppServerProvider.tsx`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`
- Test: `src/codex-web/tests/broker-presence-wiring.test.ts`

**Interfaces:**
- Consumes: `AppServerActions.listOnlineUsers(params)`。
- Produces: 点击加载、250ms 搜索防抖、cursor 续页和 `Virtuoso` 虚拟渲染。

- [x] **Step 1: 写 action 与 UI 接线失败测试**

```ts
expect(provider).toContain('client.request(BROKER_PRESENCE_LIST_METHOD, params)');
expect(popover).toContain("endReached");
expect(popover).toContain("listOnlineUsers");
```

- [x] **Step 2: 运行前端定向测试并确认失败**

```bash
npx vitest run src/codex-web/tests/broker-presence-wiring.test.ts
```

Expected: FAIL，尚未接入分页 action 和 Popover。

- [x] **Step 3: 实现按需加载与虚拟列表**

```tsx
<Virtuoso
  data={items}
  endReached={() => void loadNextPage()}
  itemContent={(_, item) => <OnlineUserRow user={item} />}
/>
```

- [x] **Step 4: 运行前端定向测试并确认通过**

```bash
npx vitest run src/codex-web/tests/broker-presence-wiring.test.ts
```

Expected: PASS。

### Task 3: 文档与端到端验证

**Files:**
- Modify: `scripts/multi-user-runtime-broker-smoke.ts`
- Modify: `docs/handover/2026-07-29-multi-user-runtime-broker.md`
- Modify: `docs/exec-plans/active/2026-08-04-root-online-account-list.md`

**Interfaces:**
- Consumes: root 在线账号 Popover 和普通账号隐藏规则。
- Produces: Smoke Ledger 与完成 checklist。

- [x] **Step 1: 扩展 smoke 正反例**

```ts
await assertOnlineUserList(rootClient, ["root@example.com", "rrssnas@example.com"]);
await assertOnlineUserListHidden(regularClient);
```

- [x] **Step 2: 运行完整验证**

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
npm run build:cli
npm run test:smoke:multi-user
```

Expected: 单元测试、生产构建和真实 Chrome 多用户 smoke 全部通过。

- [x] **Step 3: 更新交接与 Smoke Ledger**

记录 root 分页列表、搜索、少量账号单页、普通账号拒绝和未使用真实 `CODEX_HOME`。

- [x] **Step 4: 请求归档确认**

确认后将本计划移动到 `docs/exec-plans/completed/2026-08-04-root-online-account-list.md`，不得删除。

## 状态总览

- 当前状态：`Release ready`，实现、全量测试、生产构建、真实 Chrome smoke 与真实 UID smoke 均已完成。
- 成功标准：root 可点击分页查看，普通账号无入口且直接请求被拒绝，10,000 账号不产生完整列表推送。

## 决策日志

- 2026-08-04：统一采用 cursor 分页，少量在线账号仍走同一接口并在一页结束。
- 2026-08-04：在线列表按邮箱和账号 ID 稳定排序，不按活动任务动态排序，避免分页期间项目漂移。

## Smoke Ledger

- 通过：root 点击后按需加载 3 个在线账号，服务端搜索 `root` 后只保留 root 账号。
- 通过：普通账号不显示入口，服务端对伪造请求返回 `-32003`。
- 通过：3 个在线账号一次返回，`nextCursor=null`，页脚显示“已加载 3 / 共 3 个结果”。
- 通过：桌面与 `390×844` 真实 Chrome 截图无截断或溢出。
- 证据：`/volume2/SSD/codex/Temp/codex-web-multi-user-browser-smoke-T8aQOh/result.json`。
- 通过：真实 root UID smoke 验证 broker `0:0`、普通 runtime 降权、capability 清零、跨用户读取拒绝与进程回收；证据为 `/volume2/SSD/codex/Temp/codex-web-multi-user-uid-smoke-fPndqA/result.json`，未使用真实 Codex Home。
