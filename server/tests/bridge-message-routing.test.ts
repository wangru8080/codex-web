import { describe, expect, it } from "vitest";

import {
  appServerMessageDelivery,
  BridgeServerRequestRouter,
  isBridgeSyncNotification,
} from "../bridge-message-routing";

describe("appServerMessageDelivery", () => {
  it("广播 notification，但只向所有者返回普通 response", () => {
    expect(appServerMessageDelivery({ method: "turn/started", params: { turn: { id: "turn-1" } } })).toBe("broadcast");
    expect(appServerMessageDelivery({ id: 7, result: { ok: true } })).toBe("owner");
  });

  it("向所有窗口广播目标更新与清除 notification", () => {
    expect(appServerMessageDelivery({
      method: "thread/goal/updated",
      params: { threadId: "thread-1", goal: { threadId: "thread-1", status: "active" } },
    })).toBe("broadcast");
    expect(appServerMessageDelivery({
      method: "thread/goal/cleared",
      params: { threadId: "thread-1" },
    })).toBe("broadcast");
  });

  it("把带 id 的 app-server request 识别为需要公共路由的请求", () => {
    expect(appServerMessageDelivery({
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: { command: "pwd" },
    })).toBe("server-request");
  });
});

describe("isBridgeSyncNotification", () => {
  it("只识别白名单内无 id 的同步事件", () => {
    expect(isBridgeSyncNotification({
      method: "bridge/sync/userMessage",
      params: { threadId: "thread-1" },
    })).toBe(true);
    expect(isBridgeSyncNotification({
      method: "bridge/sync/threadRollback",
      params: { threadId: "thread-1", numTurns: 1, eventId: "rollback-1" },
    })).toBe(true);
    expect(isBridgeSyncNotification({ id: 1, method: "bridge/sync/userMessage" })).toBe(false);
    expect(isBridgeSyncNotification({ method: "turn/started" })).toBe(false);
  });
});

describe("BridgeServerRequestRouter", () => {
  it("保留原始所有者和 id，且公共 id 只能消费一次", () => {
    const owner = { name: "client-a" };
    const router = new BridgeServerRequestRouter<typeof owner>();
    const publicId = router.register(owner, 42);

    expect(publicId).toMatch(/^bridge-server-request:/);
    expect(router.take(publicId)).toEqual({ owner, originalId: 42 });
    expect(router.take(publicId)).toBeNull();
  });

  it("清理指定所有者尚未响应的请求", () => {
    const ownerA = { name: "client-a" };
    const ownerB = { name: "client-b" };
    const router = new BridgeServerRequestRouter<typeof ownerA>();
    const requestA = router.register(ownerA, "approval-a");
    const requestB = router.register(ownerB, "approval-b");

    router.deleteOwner(ownerA);

    expect(router.take(requestA)).toBeNull();
    expect(router.take(requestB)).toEqual({ owner: ownerB, originalId: "approval-b" });
  });
});
