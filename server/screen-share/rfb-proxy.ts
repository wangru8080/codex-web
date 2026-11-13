import net from "node:net";
import type WebSocket from "ws";
import des from "des.js";

export function reverseBits(b: number): number {
  b = ((b & 0xf0) >> 4) | ((b & 0x0f) << 4);
  b = ((b & 0xcc) >> 2) | ((b & 0x33) << 2);
  b = ((b & 0xaa) >> 1) | ((b & 0x55) << 1);
  return b;
}

export function vncDesKey(password: string): Buffer {
  const key = Buffer.alloc(8, 0);
  const len = Math.min(password.length, 8);
  for (let i = 0; i < len; i++) {
    key[i] = reverseBits(password.charCodeAt(i));
  }
  return key;
}

export function encryptVncChallenge(challenge: Buffer, password: string): Buffer {
  if (challenge.length !== 16) {
    throw new Error(`VNC challenge must be 16 bytes, got ${challenge.length}`);
  }
  const key = vncDesKey(password);
  const cipher1 = (des as any).DES.create({ type: "encrypt", key });
  const block1 = Buffer.from(cipher1.update(challenge.subarray(0, 8)));
  const cipher2 = (des as any).DES.create({ type: "encrypt", key });
  const block2 = Buffer.from(cipher2.update(challenge.subarray(8, 16)));
  return Buffer.concat([block1, block2]);
}

export type FilterClientMessagesResult = {
  forward: Buffer;
  remaining: Buffer;
  droppedCutText: boolean;
};

export function filterClientMessages(buffer: Buffer): FilterClientMessagesResult {
  const forwardChunks: Buffer[] = [];
  let offset = 0;
  let droppedCutText = false;

  while (offset < buffer.length) {
    const type = buffer[offset];
    let msgLength = 0;

    switch (type) {
      case 0: // SetPixelFormat
        msgLength = 20;
        break;
      case 2: { // SetEncodings
        if (offset + 4 > buffer.length) {
          // Incomplete header
          return {
            forward: Buffer.concat(forwardChunks),
            remaining: buffer.subarray(offset),
            droppedCutText,
          };
        }
        const count = buffer.readUInt16BE(offset + 2);
        msgLength = 4 + count * 4;
        break;
      }
      case 3: // FramebufferUpdateRequest
        msgLength = 10;
        break;
      case 4: // KeyEvent
        msgLength = 8;
        break;
      case 5: // PointerEvent
        msgLength = 6;
        break;
      case 6: { // ClientCutText
        if (offset + 8 > buffer.length) {
          // Incomplete header
          return {
            forward: Buffer.concat(forwardChunks),
            remaining: buffer.subarray(offset),
            droppedCutText,
          };
        }
        // noVNC uses a negative signed length for extended clipboard messages.
        // Treat the magnitude as the payload size so the following pointer and
        // keyboard messages stay aligned instead of waiting for ~4 GiB of data.
        const textLen = buffer.readInt32BE(offset + 4);
        const textBytes = textLen < 0 ? -textLen : textLen;
        msgLength = 8 + textBytes;
        break;
      }
      default:
        // Unknown / extension message type: forward remaining as-is
        forwardChunks.push(buffer.subarray(offset));
        return {
          forward: Buffer.concat(forwardChunks),
          remaining: Buffer.alloc(0),
          droppedCutText,
        };
    }

    if (offset + msgLength > buffer.length) {
      // Incomplete message, wait for more data
      return {
        forward: Buffer.concat(forwardChunks),
        remaining: buffer.subarray(offset),
        droppedCutText,
      };
    }

    if (type === 6) {
      // Drop ClientCutText!
      droppedCutText = true;
    } else {
      forwardChunks.push(buffer.subarray(offset, offset + msgLength));
    }

    offset += msgLength;
  }

  return {
    forward: Buffer.concat(forwardChunks),
    remaining: Buffer.alloc(0),
    droppedCutText,
  };
}

export type RfbServerInitInfo = {
  width: number;
  height: number;
  name: string;
};

export type RfbProxyOptions = {
  vncHost: string;
  vncPort: number;
  vncPassword: string;
  ws: WebSocket;
  onServerInit?: (info: RfbServerInitInfo) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
};

export type RfbProxySession = {
  close: (code?: number, reason?: string) => void;
};

export function createRfbProxy(options: RfbProxyOptions): RfbProxySession {
  const { vncHost, vncPort, vncPassword, ws } = options;
  let closed = false;
  let vncSocket: net.Socket | null = new net.Socket();

  let clientBuffer = Buffer.alloc(0);
  let vncBuffer = Buffer.alloc(0);

  const cleanup = (wsCode?: number, wsReason?: string) => {
    if (closed) return;
    closed = true;
    if (vncSocket) {
      vncSocket.destroy();
      vncSocket = null;
    }
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
      if (wsCode) {
        ws.close(wsCode, wsReason);
      } else {
        ws.close();
      }
    }
    options.onClose?.();
  };

  const fail = (err: Error) => {
    options.onError?.(err);
    cleanup();
  };

  vncSocket.on("error", (err) => {
    fail(new Error(`VNC TCP connection error: ${err.message}`));
  });

  vncSocket.on("close", () => {
    cleanup();
  });

  ws.on("close", () => {
    cleanup();
  });

  ws.on("error", (err) => {
    fail(new Error(`Screen-share WebSocket error: ${err.message}`));
  });

  // Flow control: backpressure
  const checkBackpressure = () => {
    if (!vncSocket || closed) return;
    if (ws.bufferedAmount > 128 * 1024) {
      vncSocket.pause();
    } else {
      vncSocket.resume();
    }
  };

  // State machine for handshakes
  type UpstreamState = "version" | "security-types" | "challenge" | "security-result" | "ready";
  type DownstreamState = "send-version" | "recv-version" | "send-security" | "recv-security" | "send-result" | "recv-client-init" | "ready";

  let upstreamState: UpstreamState = "version";
  let downstreamState: DownstreamState = "send-version";
  let serverInitForwarded = false;

  const readVncBytes = (len: number): Buffer | null => {
    if (vncBuffer.length < len) return null;
    const chunk = vncBuffer.subarray(0, len);
    vncBuffer = vncBuffer.subarray(len);
    return chunk;
  };

  const processUpstream = () => {
    while (!closed && upstreamState !== "ready") {
      if (upstreamState === "version") {
        const chunk = readVncBytes(12);
        if (!chunk) return;
        const ver = chunk.toString("ascii");
        if (!ver.startsWith("RFB 003.")) {
          return fail(new Error(`Unsupported VNC server version: ${ver}`));
        }
        // Respond with RFB 003.008\n
        vncSocket?.write("RFB 003.008\n");
        upstreamState = "security-types";
      } else if (upstreamState === "security-types") {
        if (vncBuffer.length < 1) return;
        const count = vncBuffer[0];
        if (vncBuffer.length < 1 + count) return;
        readVncBytes(1); // count
        const types = readVncBytes(count)!;
        let supportsVncAuth = false;
        for (let i = 0; i < types.length; i++) {
          if (types[i] === 2) supportsVncAuth = true;
        }
        if (!supportsVncAuth) {
          return fail(new Error(`VNC server did not offer VNC authentication (type 2)`));
        }
        // Select type 2 (VNC auth)
        vncSocket?.write(Buffer.from([2]));
        upstreamState = "challenge";
      } else if (upstreamState === "challenge") {
        const challenge = readVncBytes(16);
        if (!challenge) return;
        const response = encryptVncChallenge(challenge, vncPassword);
        vncSocket?.write(response);
        upstreamState = "security-result";
      } else if (upstreamState === "security-result") {
        const resultBuf = readVncBytes(4);
        if (!resultBuf) return;
        const code = resultBuf.readUInt32BE(0);
        if (code !== 0) {
          return fail(new Error(`VNC authentication failed with code ${code}`));
        }
        upstreamState = "ready";
        startDownstreamHandshake();
      }
    }

    // If both ready and ServerInit not yet parsed
    if (upstreamState === "ready" && !serverInitForwarded && vncBuffer.length >= 24) {
      // Check if we have complete ServerInit
      const nameLength = vncBuffer.readUInt32BE(20);
      const totalLen = 24 + nameLength;
      if (vncBuffer.length >= totalLen) {
        const serverInitBuf = readVncBytes(totalLen)!;
        const width = serverInitBuf.readUInt16BE(0);
        const height = serverInitBuf.readUInt16BE(2);
        const name = serverInitBuf.subarray(24, 24 + nameLength).toString("utf8");
        serverInitForwarded = true;

        options.onServerInit?.({ width, height, name });

        // Forward ServerInit to browser WebSocket
        if (ws.readyState === ws.OPEN) {
          ws.send(serverInitBuf, { binary: true });
        }
      }
    }

    // If completely initialized, pipe all remaining and new upstream bytes to browser
    if (serverInitForwarded && vncBuffer.length > 0 && ws.readyState === ws.OPEN) {
      const chunk = vncBuffer;
      vncBuffer = Buffer.alloc(0);
      ws.send(chunk, { binary: true });
      checkBackpressure();
    }
  };

  const startDownstreamHandshake = () => {
    if (closed || downstreamState !== "send-version") return;
    if (ws.readyState !== ws.OPEN) {
      ws.once("open", startDownstreamHandshake);
      return;
    }
    // 1. Send RFB 003.008\n to browser
    ws.send(Buffer.from("RFB 003.008\n"), { binary: true });
    downstreamState = "recv-version";
  };

  const readClientBytes = (len: number): Buffer | null => {
    if (clientBuffer.length < len) return null;
    const chunk = clientBuffer.subarray(0, len);
    clientBuffer = clientBuffer.subarray(len);
    return chunk;
  };

  const processDownstream = () => {
    while (!closed && downstreamState !== "ready") {
      if (downstreamState === "recv-version") {
        const chunk = readClientBytes(12);
        if (!chunk) return;
        const ver = chunk.toString("ascii");
        if (!ver.startsWith("RFB 003.")) {
          return fail(new Error(`Unsupported client RFB version: ${ver}`));
        }
        // Send security types: 1 type -> type 1 (None)
        ws.send(Buffer.from([1, 1]), { binary: true });
        downstreamState = "recv-security";
      } else if (downstreamState === "recv-security") {
        const chunk = readClientBytes(1);
        if (!chunk) return;
        if (chunk[0] !== 1) {
          return fail(new Error(`Client selected unsupported security type: ${chunk[0]}`));
        }
        // Send SecurityResult: 00 00 00 00 (OK)
        ws.send(Buffer.from([0, 0, 0, 0]), { binary: true });
        downstreamState = "recv-client-init";
      } else if (downstreamState === "recv-client-init") {
        const chunk = readClientBytes(1);
        if (!chunk) return;
        // Forward sharedFlag to vncSocket
        vncSocket?.write(chunk);
        downstreamState = "ready";
      }
    }

    // When fully ready, process client messages with ClientCutText filtering
    if (downstreamState === "ready" && clientBuffer.length > 0) {
      const { forward, remaining } = filterClientMessages(clientBuffer);
      clientBuffer = Buffer.from(remaining);
      if (forward.length > 0 && vncSocket && !closed) {
        vncSocket.write(forward);
      }
    }
  };

  vncSocket.on("data", (data) => {
    vncBuffer = Buffer.concat([vncBuffer, data]);
    processUpstream();
  });

  vncSocket.on("drain", () => {
    // TCP buffer drained
    if (ws.readyState === ws.OPEN) {
      // resume if paused
    }
  });

  ws.on("message", (data: WebSocket.RawData) => {
    const buf = Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data as ArrayBuffer);
    clientBuffer = Buffer.concat([clientBuffer, buf]);
    processDownstream();
  });

  // Connect to x11vnc
  vncSocket.connect(vncPort, vncHost, () => {
    // Upstream connected, wait for x11vnc's RFB version banner
  });

  return {
    close: cleanup,
  };
}
