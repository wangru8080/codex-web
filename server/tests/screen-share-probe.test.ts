import { describe, expect, it } from "vitest";
import { probeScreenShareCapability } from "../screen-share/probe";
import type { ScreenShareConfig } from "../screen-share/types";

describe("screen-share probe", () => {
  const baseConfig: ScreenShareConfig = {
    enabled: true,
    wsPath: "/screen-share/ws",
  };

  it("returns disabled when config.enabled is false", () => {
    const res = probeScreenShareCapability({ ...baseConfig, enabled: false }, { platform: "linux" });
    expect(res).toEqual({ status: "disabled" });
  });

  it("returns unsupported on non-linux platforms", () => {
    const res = probeScreenShareCapability(baseConfig, { platform: "darwin" });
    expect(res.status).toBe("unsupported");
    if (res.status === "unsupported") {
      expect(res.reason).toContain('Platform "darwin" is not supported');
    }
  });

  it("returns unsupported when DISPLAY is missing and Wayland detected", () => {
    const res = probeScreenShareCapability(baseConfig, {
      platform: "linux",
      env: { XDG_SESSION_TYPE: "wayland" },
    });
    expect(res).toEqual({
      status: "unsupported",
      reason: "Wayland session detected without X11 DISPLAY",
    });
  });

  it("returns unsupported when DISPLAY is missing on X11", () => {
    const res = probeScreenShareCapability(baseConfig, {
      platform: "linux",
      env: {},
    });
    expect(res).toEqual({
      status: "unsupported",
      reason: "No X11 DISPLAY found in environment",
    });
  });

  it("returns unsupported when x11vnc is not found on PATH", () => {
    const res = probeScreenShareCapability(baseConfig, {
      platform: "linux",
      env: { DISPLAY: ":0", PATH: "/usr/bin" },
      fileExistsAndExecutable: () => false,
    });
    expect(res).toEqual({
      status: "unsupported",
      reason: "x11vnc binary not found on PATH",
    });
  });

  it("returns available when on Linux, DISPLAY present and x11vnc exists", () => {
    const res = probeScreenShareCapability(baseConfig, {
      platform: "linux",
      env: { DISPLAY: ":0", PATH: "/usr/bin" },
      fileExistsAndExecutable: (p) => p === "/usr/bin/x11vnc",
    });
    expect(res).toEqual({
      status: "available",
      display: ":0",
      wsPath: "/screen-share/ws",
    });
  });

  it("respects explicit config.x11vncPath", () => {
    const res = probeScreenShareCapability(
      { ...baseConfig, x11vncPath: "/opt/bin/x11vnc" },
      {
        platform: "linux",
        env: { DISPLAY: ":42" },
        fileExistsAndExecutable: (p) => p === "/opt/bin/x11vnc",
      },
    );
    expect(res).toEqual({
      status: "available",
      display: ":42",
      wsPath: "/screen-share/ws",
    });
  });
});
