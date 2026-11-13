import { describe, expect, it } from "vitest";
import { resolveScreenShareConfig } from "../screen-share/config";

describe("screen-share config", () => {
  it("defaults to disabled when env not set", () => {
    const config = resolveScreenShareConfig({}, {});
    expect(config.enabled).toBe(false);
    expect(config.wsPath).toBe("/screen-share/ws");
    expect(config.display).toBeUndefined();
  });

  it("enables when CODEX_WEB_SCREEN_SHARE=1", () => {
    const config = resolveScreenShareConfig({}, { CODEX_WEB_SCREEN_SHARE: "1", DISPLAY: ":1" });
    expect(config.enabled).toBe(true);
    expect(config.display).toBe(":1");
  });

  it("allows options to override env", () => {
    const config = resolveScreenShareConfig(
      { enabled: false, display: ":99" },
      { CODEX_WEB_SCREEN_SHARE: "1", DISPLAY: ":0" },
    );
    expect(config.enabled).toBe(false);
    expect(config.display).toBe(":99");
  });

  it("forces disabled in broker mode (Decision 3)", () => {
    const config = resolveScreenShareConfig(
      { enabled: true },
      { CODEX_WEB_SCREEN_SHARE: "1", CODEX_WEB_RUNTIME_BROKER_SOCKET: "/run/broker.sock" },
    );
    expect(config.enabled).toBe(false);
  });
});
