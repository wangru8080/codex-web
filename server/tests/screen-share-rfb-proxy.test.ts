import EventEmitter from "node:events";
import net from "node:net";
import { describe, expect, it } from "vitest";
import {
  createRfbProxy,
  encryptVncChallenge,
  filterClientMessages,
  reverseBits,
  vncDesKey,
} from "../screen-share/rfb-proxy";

describe("screen-share rfb-proxy", () => {
  it("reverses bits correctly", () => {
    expect(reverseBits(0x01)).toBe(0x80);
    expect(reverseBits(0x80)).toBe(0x01);
    expect(reverseBits(0xaa)).toBe(0x55);
    expect(reverseBits(0x00)).toBe(0x00);
    expect(reverseBits(0xff)).toBe(0xff);
  });

  it("creates an 8-byte bit-reversed VNC DES key", () => {
    const key = vncDesKey("password");
    expect(key).toHaveLength(8);
    // 'p' is 0x70 = 01110000 -> reversed is 00001110 = 0x0E
    expect(key[0]).toBe(0x0e);
  });

  it("encrypts 16-byte challenge with DES ECB", () => {
    const challenge = Buffer.alloc(16, 0x11);
    const encrypted = encryptVncChallenge(challenge, "vncpass1");
    expect(encrypted).toHaveLength(16);
    expect(encrypted).not.toEqual(challenge);
  });

  it("filters out ClientCutText messages while passing others through", () => {
    // 1. PointerEvent (type 5, 6 bytes)
    const pointerMsg = Buffer.from([5, 1, 0, 100, 0, 200]);
    // 2. ClientCutText (type 6, 8 + 4 bytes text "test")
    const cutTextMsg = Buffer.alloc(12);
    cutTextMsg[0] = 6;
    cutTextMsg.writeUInt32BE(4, 4);
    cutTextMsg.write("test", 8);
    // 3. KeyEvent (type 4, 8 bytes)
    const keyMsg = Buffer.from([4, 1, 0, 0, 0, 0, 0, 65]);

    const combined = Buffer.concat([pointerMsg, cutTextMsg, keyMsg]);
    const { forward, remaining, droppedCutText } = filterClientMessages(combined);

    expect(remaining).toHaveLength(0);
    expect(droppedCutText).toBe(true);
    expect(forward).toEqual(Buffer.concat([pointerMsg, keyMsg]));
  });

  it("drops noVNC extended clipboard messages without blocking later input", () => {
    // noVNC advertises extended clipboard capabilities with a signed negative
    // length (-8) and eight bytes of capability flags.
    const extendedCutText = Buffer.from("06000000fffffff81f00000100000000", "hex");
    const pointerMsg = Buffer.from([5, 1, 0, 120, 0, 90]);
    const keyMsg = Buffer.from([4, 1, 0, 0, 0, 0, 0, 65]);

    const { forward, remaining, droppedCutText } = filterClientMessages(
      Buffer.concat([extendedCutText, pointerMsg, keyMsg]),
    );

    expect(remaining).toHaveLength(0);
    expect(droppedCutText).toBe(true);
    expect(forward).toEqual(Buffer.concat([pointerMsg, keyMsg]));
  });

  it("reassembles fragmented extended clipboard messages before parsing input", () => {
    const extendedCutText = Buffer.from("06000000fffffff81f00000100000000", "hex");
    const pointerMsg = Buffer.from([5, 1, 0, 120, 0, 90]);
    const firstFragment = extendedCutText.subarray(0, 9);
    const secondFragment = extendedCutText.subarray(9);

    const first = filterClientMessages(firstFragment);
    expect(first.forward).toHaveLength(0);
    expect(first.remaining).toEqual(firstFragment);
    expect(first.droppedCutText).toBe(false);

    const second = filterClientMessages(
      Buffer.concat([first.remaining, secondFragment, pointerMsg]),
    );
    expect(second.remaining).toHaveLength(0);
    expect(second.droppedCutText).toBe(true);
    expect(second.forward).toEqual(pointerMsg);
  });

  it("buffers partial messages in remaining until more bytes arrive", () => {
    const cutTextMsg = Buffer.alloc(12);
    cutTextMsg[0] = 6;
    cutTextMsg.writeUInt32BE(4, 4);
    cutTextMsg.write("test", 8);

    // Give only first 6 bytes of 12
    const partial = cutTextMsg.subarray(0, 6);
    const res = filterClientMessages(partial);
    expect(res.forward).toHaveLength(0);
    expect(res.remaining).toEqual(partial);
    expect(res.droppedCutText).toBe(false);
  });

  it("performs full handshake between mock VNC server and mock WebSocket", async () => {
    const password = "testpass";
    let mockVncSocket: net.Socket | null = null;

    // Start mock VNC server
    const server = net.createServer((socket) => {
      mockVncSocket = socket;
      // Step 1: Send VNC version banner
      socket.write("RFB 003.008\n");

      let stage = "version";
      let buf = Buffer.alloc(0);

      socket.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (stage === "version" && buf.length >= 12) {
          buf = buf.subarray(12);
          stage = "security";
          // Step 2: Send security types (1 type: type 2 VNC auth)
          socket.write(Buffer.from([1, 2]));
        } else if (stage === "security" && buf.length >= 1) {
          const selected = buf[0];
          buf = buf.subarray(1);
          expect(selected).toBe(2);
          stage = "challenge";
          // Step 3: Send 16-byte challenge
          socket.write(Buffer.alloc(16, 0xaa));
        } else if (stage === "challenge" && buf.length >= 16) {
          const resp = buf.subarray(0, 16);
          buf = buf.subarray(16);
          const expected = encryptVncChallenge(Buffer.alloc(16, 0xaa), password);
          expect(resp).toEqual(expected);
          stage = "result";
          // Step 4: Send SecurityResult OK (0)
          socket.write(Buffer.from([0, 0, 0, 0]));
          stage = "client-init";
        } else if (stage === "client-init" && buf.length >= 1) {
          const shared = buf[0];
          buf = buf.subarray(1);
          expect(shared).toBe(1);
          stage = "server-init";
          // Step 5: Send ServerInit (1280x720, name "TestDesktop")
          const name = "TestDesktop";
          const initBuf = Buffer.alloc(24 + name.length);
          initBuf.writeUInt16BE(1280, 0); // width
          initBuf.writeUInt16BE(720, 2); // height
          initBuf.writeUInt32BE(name.length, 20);
          initBuf.write(name, 24);
          socket.write(initBuf);
          stage = "ready";
        }
      });
    });

    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as net.AddressInfo;
        resolve(addr.port);
      });
    });

    // Mock WebSocket client
    const mockWs = new EventEmitter() as any;
    mockWs.readyState = 1; // OPEN
    mockWs.OPEN = 1;
    mockWs.CONNECTING = 0;
    mockWs.bufferedAmount = 0;
    const sentToWs: Buffer[] = [];
    mockWs.send = (data: Buffer) => {
      sentToWs.push(data);
    };
    mockWs.close = () => {
      mockWs.emit("close");
    };

    let serverInitInfo: { width: number; height: number; name: string } | null = null;

    const proxy = createRfbProxy({
      vncHost: "127.0.0.1",
      vncPort: port,
      vncPassword: password,
      ws: mockWs,
      onServerInit: (info) => {
        serverInitInfo = info;
      },
    });

    // Simulate browser WebSocket interacting with proxy:
    // Wait for proxy to send RFB 003.008\n
    await new Promise((r) => setTimeout(r, 100));
    expect(sentToWs[0].toString()).toContain("RFB 003.008");

    // Browser sends its version
    mockWs.emit("message", Buffer.from("RFB 003.008\n"));
    await new Promise((r) => setTimeout(r, 50));

    // Proxy sends security types: [1, 1] (None)
    expect(sentToWs[1]).toEqual(Buffer.from([1, 1]));

    // Browser selects type 1 (None)
    mockWs.emit("message", Buffer.from([1]));
    await new Promise((r) => setTimeout(r, 50));

    // Proxy sends SecurityResult OK: [0, 0, 0, 0]
    expect(sentToWs[2]).toEqual(Buffer.from([0, 0, 0, 0]));

    // Browser sends ClientInit: [1] (shared)
    mockWs.emit("message", Buffer.from([1]));
    await new Promise((r) => setTimeout(r, 100));

    // Verify proxy emitted ServerInit info
    expect(serverInitInfo).toEqual({
      width: 1280,
      height: 720,
      name: "TestDesktop",
    });

    // Now send a PointerEvent and a ClientCutText over mockWs
    const pointerEvent = Buffer.from([5, 1, 0, 50, 0, 60]);
    const cutTextMsg = Buffer.alloc(12);
    cutTextMsg[0] = 6;
    cutTextMsg.writeUInt32BE(4, 4);
    cutTextMsg.write("hack", 8);

    mockWs.emit("message", Buffer.concat([pointerEvent, cutTextMsg]));
    await new Promise((r) => setTimeout(r, 100));

    proxy.close();
    server.close();
  });
});
