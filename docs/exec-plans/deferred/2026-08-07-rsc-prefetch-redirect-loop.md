# RSC 预加载重定向循环执行计划

> **面向自动化执行者：** 实施时优先使用 `superpowers:subagent-driven-development`，或使用 `superpowers:executing-plans` 逐项执行；若当前环境没有这些技能，则严格按本计划的复现、测试、最小实现和复验顺序推进。所有步骤使用复选框跟踪。

**目标：** 定位并消除侧栏链接自动预加载产生的 `ERR_TOO_MANY_REDIRECTS`，同时保持登录门禁、普通页面导航和 app-server 连接行为不变。

**架构：** 先在隔离生产环境中记录 `_rsc` 请求的完整重定向链、Cookie 和响应头，区分认证代理循环、Next 路由重定向和无价值预加载三类来源。只有证据指向认证代理时才修改 `src/proxy.ts`；若页面点击导航正常且只有侧栏预加载失败，则在产生请求的 `Link` 上关闭预加载，不改认证语义。

**技术栈：** Next.js 16、React 19、TypeScript、Vitest、Playwright、Next `Link`、Next `proxy`、Codex app-server。

## 全局约束

- 不修改 `/home/rrssnas/code/codex`。
- 不新增依赖，不修改锁文件。
- 验证使用 `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`。
- 不使用真实账号会话，不触发模型 Turn。
- 不把 `ERR_TOO_MANY_REDIRECTS` 归因于 app-server；该请求发生在 Next 页面/RSC 层。
- 不因 console 降噪而放宽 Web 登录门禁。
- 仅在完整响应链证明根因后选择修复分支；两个候选分支不得同时实施。
- 普通点击导航、未登录跳转、已登录放行和 API 401 都必须保留反例测试。

---

## 已知现场

- 2026-08-07 的隔离生产浏览器验证中，图片预览、最终回复图片和 app-server recovery 均通过。
- 浏览器 console 另外记录到以下预加载请求失败：
  - `/settings?_rsc=<token>`
  - `/plugins?_rsc=<token>`
  - 多个旧 `/chat/<thread-id>?_rsc=<token>`
- 浏览器错误为 `net::ERR_TOO_MANY_REDIRECTS`；当前没有证据表明用户点击这些链接也会失败。
- `src/proxy.ts` 会对未认证页面请求返回 `307 /login?next=...`，对已认证 `/login` 返回 `307 /chat`。
- `src/components/settings/SettingsSidebar.tsx` 和 `src/app/settings/layout.tsx` 已对设置子路由使用 `prefetch={false}`；`SessionListItem.tsx`、`ChatListPanel.tsx` 和 `NavRail.tsx` 仍存在默认预加载链接。

## 文件范围

- 读取：`src/proxy.ts`、`server/web-auth.ts`、相关页面重定向入口。
- 修改候选 A：`src/proxy.ts`，仅当响应链证明代理错误处理 RSC 请求。
- 修改候选 B：`src/components/layout/SessionListItem.tsx`、`src/components/layout/ChatListPanel.tsx`、`src/components/layout/NavRail.tsx`，仅当失败只来自无价值预加载。
- 测试：`src/codex-web/tests/web-auth-route-wiring.test.ts`、`src/codex-web/tests/proxy.test.ts`。
- 新建测试候选：`src/codex-web/tests/rsc-prefetch-wiring.test.ts`，集中约束侧栏预加载策略。
- 新建 smoke 候选：`scripts/rsc-prefetch-redirect-smoke.ts`，记录真实生产响应链和浏览器 console。

---

### 任务 1：建立可重复的生产响应链证据

**文件：**

- 新建：`scripts/rsc-prefetch-redirect-smoke.ts`
- 读取：`src/proxy.ts`
- 读取：`server/web-auth.ts`

**接口：**

- 输入：`BASE_URL`，默认 `http://127.0.0.1:3021`；隔离 Web 登录凭据；固定测试 Thread ID。
- 输出：每个请求的 URL、status、`location`、是否携带会话 Cookie、重定向次数和最终 URL；不得输出 Cookie 值。

- [ ] **步骤 1：先用真实生产服务复现普通请求与 RSC 请求差异**

运行：

```bash
export NODE_HOME=/volume2/SSD/node-v24.14.0
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
export PORT=3021
npm run build
npm run start
```

预期：服务显示隔离 `CODEX_HOME` 和 app-server PID；普通 `/chat` 可打开。

- [ ] **步骤 2：实现只记录元数据的重定向探针**

脚本必须分别请求 `/settings`、`/plugins`、有效 `/chat/<id>` 和不存在的 `/chat/<id>`，每个路径各执行普通请求与带 `RSC: 1`、`Next-Router-Prefetch: 1`、`?_rsc=probe` 的请求。请求使用 `redirect: "manual"`，最多跟随 10 跳；每跳只保存：

```ts
type RedirectHop = {
  url: string;
  status: number;
  location: string | null;
  sentSessionCookie: boolean;
};
```

遇到重复 URL 时立即失败，并输出重复链，不继续请求。

- [ ] **步骤 3：记录登录前后对照**

运行：

```bash
export BASE_URL=http://127.0.0.1:3021
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npx tsx scripts/rsc-prefetch-redirect-smoke.ts
```

预期：报告明确指出循环首次发生在哪个 URL、哪一跳丢失或保留 Cookie，以及普通导航是否同样循环。

- [ ] **步骤 4：建立修复分支门槛**

判定规则：

1. 已认证 `_rsc` 请求进入 `/login -> /chat -> /login` 或相同代理循环：进入候选 A。
2. 普通点击导航为 200/单次 307，只有自动预加载触发循环：进入候选 B。
3. 循环发生在页面自身 `redirect()`，且与侧栏 Link 无关：停止本计划，另建对应页面路由计划。

---

### 任务 2A：仅在代理证据成立时修复 RSC 登录门禁

**文件：**

- 修改：`src/codex-web/tests/web-auth-route-wiring.test.ts`
- 修改：`src/proxy.ts`

**接口：**

- 消费：任务 1 的完整重定向链。
- 产出：RSC 请求使用与普通页面一致的认证结论，但不会形成重复 URL 重定向。

- [ ] **步骤 1：编写失败测试，固定已认证 RSC 放行行为**

在 `web-auth-route-wiring.test.ts` 中增加：

```ts
it("有效 Cookie 放行 RSC 预加载请求", async () => {
  const token = createSessionToken(readWebAuthConfig(authEnv));
  const request = new NextRequest("http://localhost:3000/settings?_rsc=probe", {
    headers: {
      cookie: `${WEB_AUTH_COOKIE}=${token}`,
      RSC: "1",
      "Next-Router-Prefetch": "1",
    },
  });
  expect((await proxy(request)).status).toBe(200);
});
```

- [ ] **步骤 2：编写失败测试，固定未认证 RSC 不得在相同 URL 间循环**

测试应断言首次响应只有一个明确目标，并且 `location` 不等于请求 URL；不得把未认证请求直接放行：

```ts
it("未登录 RSC 请求仍受门禁保护且不自重定向", async () => {
  const request = new NextRequest("http://localhost:3000/plugins?_rsc=probe", {
    headers: { RSC: "1", "Next-Router-Prefetch": "1" },
  });
  const response = await proxy(request);
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    "http://localhost:3000/login?next=%2Fplugins%3F_rsc%3Dprobe",
  );
  expect(response.headers.get("location")).not.toBe(request.url);
});
```

- [ ] **步骤 3：运行测试确认失败原因与任务 1 一致**

运行：

```bash
npm run test -- --run src/codex-web/tests/web-auth-route-wiring.test.ts
```

预期：失败点必须与任务 1 的代理响应链一致；若测试直接通过，不得修改 `src/proxy.ts`，改走任务 2B。

- [ ] **步骤 4：实施最小代理修复**

只修正任务 1 已证明错误的 header、Cookie 或 URL 处理。不新增独立认证状态，不跳过 `authenticateWebRequest()`，不把 `/settings`、`/plugins` 或 `/chat/*` 加入公开路径。

- [ ] **步骤 5：运行代理和认证测试**

```bash
npm run test -- --run src/codex-web/tests/web-auth-route-wiring.test.ts src/codex-web/tests/proxy.test.ts
```

预期：已登录页面/RSC 均放行；未登录页面单次跳转登录；未登录 API 返回 401；登录页已认证时单次跳转 `/chat`。

---

### 任务 2B：仅在预加载证据成立时关闭无价值侧栏预加载

**文件：**

- 新建：`src/codex-web/tests/rsc-prefetch-wiring.test.ts`
- 修改：`src/components/layout/SessionListItem.tsx`
- 修改：`src/components/layout/ChatListPanel.tsx`
- 修改：`src/components/layout/NavRail.tsx`

**接口：**

- 消费：任务 1 证明普通点击成功、自动预加载失败的结论。
- 产出：侧栏旧会话、功能页和设置链接不在空闲期发送 `_rsc` 请求；用户点击后仍由 Next 客户端导航。

- [ ] **步骤 1：编写失败的源码接线测试**

新测试读取三个组件源码，并断言产生现场请求的 Link 明确设置 `prefetch={false}`：

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("侧栏 RSC 预加载策略", () => {
  it("旧会话链接不自动预加载", () => {
    const source = read("src/components/layout/SessionListItem.tsx");
    expect(source).toMatch(/href=\{`\/chat\/\$\{session\.id\}`\}[\s\S]*?prefetch=\{false\}/);
  });

  it("功能页和设置链接不自动预加载", () => {
    for (const path of [
      "src/components/layout/ChatListPanel.tsx",
      "src/components/layout/NavRail.tsx",
    ]) {
      expect(read(path)).toContain("prefetch={false}");
    }
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
npm run test -- --run src/codex-web/tests/rsc-prefetch-wiring.test.ts
```

预期：旧会话、功能页或设置 Link 缺少 `prefetch={false}`。

- [ ] **步骤 3：实施最小 Link 修改**

只在任务 1 观察到会产生循环请求的 Link 上添加：

```tsx
<Link href={targetHref} prefetch={false}>
  {children}
</Link>
```

不得改为普通 `<a>`，不得修改 href，不得为按钮增加手写 `router.push()`。

- [ ] **步骤 4：运行 targeted tests**

```bash
npm run test -- --run src/codex-web/tests/rsc-prefetch-wiring.test.ts src/codex-web/tests/web-auth-route-wiring.test.ts
```

预期：侧栏预加载约束通过，认证行为测试无回归。

---

### 任务 3：执行浏览器正反例 smoke

**文件：**

- 修改：`scripts/rsc-prefetch-redirect-smoke.ts`

**接口：**

- 输入：修复后的生产服务。
- 输出：普通导航、空闲预加载、登录门禁三组断言结果。

- [ ] **步骤 1：重新构建并启动隔离生产服务**

```bash
export NODE_HOME=/volume2/SSD/node-v24.14.0
export PATH=$NODE_HOME/bin:$PATH
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
export PORT=3021
npm run build
npm run start
```

- [ ] **步骤 2：验证空闲侧栏反例**

登录后停留 `/chat` 10 秒，不点击侧栏。浏览器 Network 必须满足：

- 没有 `/settings?_rsc=...`、`/plugins?_rsc=...` 或旧 `/chat/<id>?_rsc=...` 的重复重定向；
- console 没有 `ERR_TOO_MANY_REDIRECTS`；
- `/api/codex/bridge-url` 为 200，WebSocket 保持连接。

- [ ] **步骤 3：验证真实点击正例**

依次点击设置、插件和一个旧会话。每次必须在 10 秒内到达目标 pathname，页面没有登录循环；旧会话仍从 app-server 恢复。

- [ ] **步骤 4：验证认证反例**

清除测试会话 Cookie 后直接访问 `/settings`，必须单次跳转 `/login?next=...`；未登录请求 `/api/codex/bridge-url` 必须返回 401，不得通过关闭预加载绕过门禁。

- [ ] **步骤 5：验证不存在的旧会话**

点击或访问不存在的 `/chat/<id>` 不得形成重定向循环；允许应用显示“会话不存在”或返回既有错误收口。

---

### 任务 4：完整回归与计划归档

**文件：**

- 修改：`docs/exec-plans/deferred/2026-08-07-rsc-prefetch-redirect-loop.md`
- 完成后移动候选：`docs/exec-plans/completed/2026-08-07-rsc-prefetch-redirect-loop.md`

- [ ] **步骤 1：运行完整测试**

```bash
export CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home
npm run test
npm run build
npm run test:smoke
```

预期：所有命令通过；不得以 targeted tests 代替完整回归。

- [ ] **步骤 2：更新 Smoke Ledger**

记录普通导航、空闲预加载、未登录门禁、已登录 RSC、无效旧会话和 app-server 连接六项结果，并附具体 status/redirect chain，不只写“console clean”。

- [ ] **步骤 3：检查文档和工作区**

```bash
find docs -maxdepth 3 -type f | sort
rg -n "ERR_TOO_MANY_REDIRECTS|_rsc|prefetch" docs/exec-plans src scripts
git diff --check
git status --short
```

预期：没有临时日志、Cookie、截图或测试凭据进入 Git；用户原有修改保持不变。

- [ ] **步骤 4：经用户确认后移动计划并提交**

只有用户明确确认移动和提交后，才把本计划从 `deferred` 移至 `completed` 并创建中文 Git 提交；不得自动 push。

## 成功标准

- 任务 1 保存了可重复的完整重定向链证据，并据此只选择候选 A 或候选 B。
- 登录后的空闲 `/chat` 页面不再产生相关 `ERR_TOO_MANY_REDIRECTS`。
- 设置、插件和旧会话的真实点击导航仍正常。
- 未登录页面仍跳转登录，未登录 API 仍返回 401。
- app-server bridge 和图片 Blob 加载不受影响。
- targeted tests、完整测试、生产构建和 smoke 均实际运行并通过。

## Smoke Ledger

| 场景 | 当前结果 | 目标结果 |
|---|---|---|
| 登录后空闲 `/chat` | 观察到设置、插件和旧会话 `_rsc` 请求重定向过多 | 10 秒内无重复重定向、无对应 console 错误 |
| 设置/插件点击 | 尚未作为本问题独立测量 | 10 秒内到达目标 pathname |
| 有效旧会话点击 | 会话页面此前可打开，预加载有噪声 | 点击恢复成功，空闲期无循环预加载 |
| 无效旧会话 | 尚未独立测量 | 进入既有错误收口，不形成循环 |
| 未登录页面 | 代理设计为单次 307 到登录页 | 保持单次 307 |
| 未登录 API | 代理设计为 401 JSON | 保持 401 JSON |
| app-server | recovery smoke 已通过 | 修复后仍通过，WebSocket 不断开 |

## 决策日志

- 2026-08-07：该问题记录为 Next RSC/页面导航层的延后事项，不归入图片 Blob 或 app-server crash recovery。
- 2026-08-07：现有证据只有浏览器 console 和请求 URL，不足以直接修改认证代理；实施必须先捕获完整响应链。
- 2026-08-07：设置子路由已使用 `prefetch={false}`，但入口 `/settings`、插件和会话链接仍可能由其他侧栏组件预加载；任务 1 必须按具体发起元素归因。
- 2026-08-07：若普通点击正常而只有空闲预加载失败，首选关闭这些侧栏 Link 的预加载，避免扩大认证边界。
