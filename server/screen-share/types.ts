export type ScreenShareConfig = {
  enabled: boolean;
  display?: string;
  x11vncPath?: string;
  wsPath: string;
};

export type ScreenShareCapability =
  | { status: "disabled" }
  | { status: "unsupported"; reason: string }
  | { status: "available"; display: string; wsPath: string };

export type ScreenShareAuditEvent =
  | { type: "start"; remoteAddress?: string; port: number }
  | { type: "stop"; remoteAddress?: string; reason: string; durationMs: number }
  | { type: "takeover"; remoteAddress?: string }
  | { type: "rejected"; remoteAddress?: string; reason: string };

export type ScreenShareAuditLogger = (event: ScreenShareAuditEvent) => void;
