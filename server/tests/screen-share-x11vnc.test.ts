import { EventEmitter } from "node:events";
import net from "node:net";
import { describe, expect, it } from "vitest";
import {
  buildX11VncArgv,
  findFreePort,
  generateVncPassword,
  launchX11Vnc,
} from "../screen-share/x11vnc";

describe("screen-share x11vnc", () => {
  it("builds fixed argv with expected flags", () => {
    const argv = buildX11VncArgv({
      port: 5905,
      passwordFilePath: "/tmp/passwd",
      display: ":0",
    });

    expect(argv).toEqual([
      "-localhost",
      "-rfbport",
      "5905",
      "-once",
      "-passwdfile",
      "rm:/tmp/passwd",
      "-noclipboard",
      "-nosetclipboard",
      "-nossl",
      "-noxdamage",
      "-display",
      ":0",
    ]);
  });

  it("generates an 8-character VNC password", () => {
    const pw = generateVncPassword();
    expect(pw).toHaveLength(8);
    expect(typeof pw).toBe("string");
  });

  it("finds a free port", async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(1024);
    expect(port).toBeLessThan(65536);
  });

  it("handles premature exit with stderr summary", async () => {
    const mockSpawn = () => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = 99999;
      setTimeout(() => {
        child.stderr.emit("data", Buffer.from("Fatal: could not open display :99\n"));
        child.emit("exit", 1, null);
      }, 50);
      return child;
    };

    await expect(
      launchX11Vnc({
        binaryPath: "/bin/false",
        display: ":99",
        spawnFn: mockSpawn as any,
        startupTimeoutMs: 1000,
      }),
    ).rejects.toThrow("could not open display :99");
  });

  it("detects port listener and manages lifecycle", async () => {
    const dummyServer = net.createServer();
    const port = await new Promise<number>((resolve) => {
      dummyServer.listen(0, "127.0.0.1", () => {
        const addr = dummyServer.address() as net.AddressInfo;
        resolve(addr.port);
      });
    });

    const mockSpawn = () => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = 88888;
      child.kill = (sig: string) => {
        child.emit("exit", 0, sig);
        return true;
      };
      return child;
    };

    const proc = await launchX11Vnc({
      binaryPath: "/bin/true",
      display: ":0",
      port,
      spawnFn: mockSpawn as any,
      startupTimeoutMs: 1000,
    });

    expect(proc.port).toBe(port);
    expect(proc.display).toBe(":0");
    expect(proc.password).toHaveLength(8);

    await proc.kill();
    dummyServer.close();
  });
});
