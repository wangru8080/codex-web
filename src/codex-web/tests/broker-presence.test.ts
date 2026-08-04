import { describe, expect, it } from "vitest";

import {
  BROKER_PRESENCE_LIST_METHOD,
  BROKER_PRESENCE_METHOD,
  brokerPresenceNotification,
  parseBrokerPresenceListParams,
  readBrokerPresence,
} from "../broker-presence";

describe("runtime broker 在线人数通知", () => {
  it("构造并解析有效人数", () => {
    const notification = brokerPresenceNotification(3);

    expect(notification).toEqual({
      method: BROKER_PRESENCE_METHOD,
      params: { onlineUsers: 3 },
    });
    expect(readBrokerPresence(notification)).toBe(3);
  });

  it("忽略无关通知和非法人数", () => {
    expect(readBrokerPresence({ method: "turn/started", params: {} })).toBeNull();
    expect(readBrokerPresence({
      method: BROKER_PRESENCE_METHOD,
      params: { onlineUsers: -1 },
    })).toBeNull();
    expect(readBrokerPresence({
      method: BROKER_PRESENCE_METHOD,
      params: { onlineUsers: 1.5 },
    })).toBeNull();
  });

  it("解析在线账号分页参数并限制每页数量", () => {
    expect(parseBrokerPresenceListParams(undefined)).toEqual({
      query: "",
      limit: 50,
      cursor: null,
    });
    expect(parseBrokerPresenceListParams({
      query: "  ROOT  ",
      limit: 100,
      cursor: "cursor-1",
    })).toEqual({ query: "root", limit: 100, cursor: "cursor-1" });
    expect(BROKER_PRESENCE_LIST_METHOD).toBe("bridge/presence/list");
    expect(() => parseBrokerPresenceListParams({ limit: 101 })).toThrow("limit");
    expect(() => parseBrokerPresenceListParams({ cursor: 1 })).toThrow("cursor");
  });
});
