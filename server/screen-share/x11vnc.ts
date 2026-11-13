import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export type X11VncArgvOptions = {
  port: number;
  passwordFilePath: string;
  display: string;
};

export function buildX11VncArgv(options: X11VncArgvOptions): string[] {
  return [
    "-localhost",
    "-rfbport",
    String(options.port),
    "-once",
    "-passwdfile",
    `rm:${options.passwordFilePath}`,
    "-noclipboard",
    "-nosetclipboard",
    "-nossl",
    "-noxdamage",
    "-display",
    options.display,
  ];
}

export function generateVncPassword(): string {
  // RFB standard VNC-auth password is at most 8 ASCII bytes
  return crypto.randomBytes(6).toString("base64url").slice(0, 8);
}

export async function findFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("Unable to obtain free loopback port")));
        return;
      }
      const port = addr.port;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

export type LaunchX11VncOptions = {
  binaryPath: string;
  display: string;
  port?: number;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  startupTimeoutMs?: number;
  spawnFn?: typeof spawn;
};

export type X11VncProcess = {
  readonly pid: number | undefined;
  readonly port: number;
  readonly password: string;
  readonly display: string;
  getStderrSummary: () => string;
  kill: () => Promise<void>;
  onExit: (callback: (code: number | null, signal: NodeJS.Signals | null) => void) => void;
};

const MAX_OUTPUT_BUFFER = 4096;

export async function launchX11Vnc(options: LaunchX11VncOptions): Promise<X11VncProcess> {
  const port = options.port ?? (await findFreePort());
  const password = generateVncPassword();
  const timeoutMs = options.startupTimeoutMs ?? 5000;
  const spawnProcess = options.spawnFn ?? spawn;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-x11vnc-"));
  await fs.chmod(tempDir, 0o700);
  const passwordFilePath = path.join(tempDir, "passwd");
  await fs.writeFile(passwordFilePath, password, { mode: 0o600 });

  const argv = buildX11VncArgv({
    port,
    passwordFilePath,
    display: options.display,
  });

  const baseEnv = options.env ?? process.env;
  const nodeEnv = (baseEnv.NODE_ENV as 'development' | 'production' | 'test') ?? 'production';
  const minimalEnv: NodeJS.ProcessEnv = {
    DISPLAY: options.display,
    XAUTHORITY: baseEnv.XAUTHORITY,
    PATH: baseEnv.PATH,
    HOME: baseEnv.HOME,
    NODE_ENV: nodeEnv,
  };

  const child: ChildProcess = spawnProcess(options.binaryPath, argv, {
    detached: true,
    shell: false,
    env: minimalEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let outputBuffer = "";
  const appendOutput = (chunk: Buffer | string) => {
    outputBuffer += chunk.toString();
    if (outputBuffer.length > MAX_OUTPUT_BUFFER) {
      outputBuffer = outputBuffer.slice(outputBuffer.length - MAX_OUTPUT_BUFFER);
    }
  };

  child.stdout?.on("data", appendOutput);
  child.stderr?.on("data", appendOutput);

  const cleanTemp = async () => {
    try {
      if (fsSync.existsSync(passwordFilePath)) await fs.unlink(passwordFilePath).catch(() => {});
      if (fsSync.existsSync(tempDir)) await fs.rmdir(tempDir).catch(() => {});
    } catch {
      // ignore cleanup errors
    }
  };

  return new Promise<X11VncProcess>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const cleanupEarlyListeners = () => {
      if (timer) clearTimeout(timer);
      child.removeListener("error", onError);
      child.removeListener("exit", onEarlyExit);
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanupEarlyListeners();
      void cleanTemp();
      reject(new Error(`Failed to spawn x11vnc: ${err.message}`));
    };

    const onEarlyExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      cleanupEarlyListeners();
      void cleanTemp();
      const summary = outputBuffer.trim() || `Exit code ${code ?? signal ?? "unknown"}`;
      reject(new Error(`x11vnc exited prematurely: ${summary}`));
    };

    child.once("error", onError);
    child.once("exit", onEarlyExit);

    // Poll for port readiness
    const checkPortReady = () => {
      if (settled) return;
      const sock = new net.Socket();
      sock.once("connect", () => {
        sock.destroy();
        if (settled) return;
        settled = true;
        cleanupEarlyListeners();
        void cleanTemp();

        let killed = false;
        const exitCallbacks = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();

        child.on("exit", (code, signal) => {
          for (const cb of exitCallbacks) {
            cb(code, signal);
          }
        });

        const proc: X11VncProcess = {
          pid: child.pid,
          port,
          password,
          display: options.display,
          getStderrSummary: () => outputBuffer.trim(),
          onExit: (cb) => {
            exitCallbacks.add(cb);
          },
          kill: async () => {
            if (killed) return;
            killed = true;
            void cleanTemp();
            if (child.pid && !child.killed) {
              try {
                // Kill process group
                process.kill(-child.pid, "SIGTERM");
              } catch {
                try {
                  child.kill("SIGTERM");
                } catch {
                  // process might already be gone
                }
              }

              // SIGKILL fallback after 3s
              await new Promise<void>((done) => {
                const exitHandler = () => {
                  clearTimeout(sigkillTimer);
                  done();
                };
                child.once("exit", exitHandler);
                const sigkillTimer = setTimeout(() => {
                  try {
                    if (child.pid && !child.killed) {
                      process.kill(-child.pid, "SIGKILL");
                    }
                  } catch {
                    // ignore
                  }
                  done();
                }, 3000);
              });
            }
          },
        };

        resolve(proc);
      });

      sock.once("error", () => {
        sock.destroy();
        if (!settled) {
          setTimeout(checkPortReady, 100);
        }
      });

      sock.connect(port, "127.0.0.1");
    };

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanupEarlyListeners();
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // ignore
      }
      void cleanTemp();
      reject(new Error(`Timed out waiting for x11vnc to start on port ${port}: ${outputBuffer.trim()}`));
    }, timeoutMs);

    setTimeout(checkPortReady, 100);
  });
}
