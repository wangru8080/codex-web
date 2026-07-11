import { describe, expect, it } from "vitest";
import { createNewChatHref, readNewChatKey } from "./new-chat-url";

describe("new-chat-url", () => {
  it("generates a unique new chat route key", () => {
    expect(createNewChatHref(12345)).toBe("/chat?new=12345");
  });

  it("reads the new chat route key", () => {
    const params = new URLSearchParams("new=67890");

    expect(readNewChatKey(params)).toBe("67890");
  });

  it("returns empty string when the key is absent", () => {
    const params = new URLSearchParams("prefill=hello");

    expect(readNewChatKey(params)).toBe("");
  });
});
