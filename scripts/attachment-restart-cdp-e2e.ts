import { readFile } from "node:fs/promises";

async function main(): Promise<void> {
  const cdpBaseUrl = process.env.CODEX_WEB_CDP_URL ?? "http://192.168.3.12:45737";
  const appBaseUrl = requiredEnv("CODEX_WEB_E2E_URL").replace(/\/$/, "");
  const expectedAttachment = process.env.CODEX_WEB_E2E_EXPECT ?? "image";
  if (expectedAttachment !== "image" && expectedAttachment !== "file") {
    throw new Error("CODEX_WEB_E2E_EXPECT 只能是 image 或 file");
  }
  const phase = process.argv[2];

  if (phase !== "send" && phase !== "verify") {
    throw new Error("用法: tsx scripts/attachment-restart-cdp-e2e.ts <send|verify>");
  }

  const initialUrl = phase === "send"
    ? `${appBaseUrl}/chat`
    : requiredEnv("CODEX_WEB_E2E_THREAD_URL");
  const target = await createTarget("about:blank", cdpBaseUrl);
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);

  try {
    await cdp.call("Page.enable");
    await cdp.call("Runtime.enable");
    await cdp.call("Page.navigate", { url: initialUrl });
    await waitFor(cdp, `location.href.startsWith(${JSON.stringify(appBaseUrl)})`);
    await waitFor(cdp, "document.readyState === 'complete'");

    if (phase === "send") {
    const fixture = requiredEnv("CODEX_WEB_E2E_FIXTURE");
    const workingDirectory = process.env.CODEX_WEB_E2E_CWD ?? process.cwd();
    const marker = `attachment-restart-${Date.now()}`;
    const analysisPrompt = process.env.CODEX_WEB_E2E_PROMPT?.trim();
    const userPrompt = analysisPrompt ? `${marker}\n\n${analysisPrompt}` : marker;
    const expectedAnswer = process.env.CODEX_WEB_E2E_EXPECTED_ANSWER?.trim();

    await waitFor(cdp, "document.querySelector('textarea') !== null");
    await evaluate(cdp, `
      localStorage.setItem('codepilot:last-working-directory', ${JSON.stringify(workingDirectory)});
      window.dispatchEvent(new CustomEvent('project-directory-changed', {
        detail: { path: ${JSON.stringify(workingDirectory)} }
      }));
    `);
    await setFileInput(cdp, fixture);
    const sourceFixtureName = fixture.split(/[\\/]/).pop() ?? fixture;
    const fixtureName = sourceFixtureName.endsWith(".base64")
      ? sourceFixtureName.slice(0, -".base64".length)
      : sourceFixtureName;
    await waitFor(cdp, `document.body.innerText.includes(${JSON.stringify(fixtureName)})`);
    await evaluate(cdp, `
      (() => {
        const textarea = document.querySelector('textarea');
        if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('未找到消息输入框');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(textarea, ${JSON.stringify(userPrompt)});
        textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      })()
    `);
    await waitFor(cdp, `document.querySelector('textarea')?.value === ${JSON.stringify(userPrompt)}`);
    await waitFor(
      cdp,
      "document.querySelector('textarea')?.closest('form')?.querySelector('button[type=submit]')?.disabled === false",
      30_000,
    );
    await evaluate(cdp, `
      (() => {
        const form = document.querySelector('textarea')?.closest('form');
        const submit = form?.querySelector('button[type=submit]');
        if (!(submit instanceof HTMLButtonElement)) throw new Error('未找到发送按钮');
        if (submit.disabled) throw new Error('发送按钮当前不可用');
        submit.click();
      })()
    `);
    await waitFor(cdp, `document.body.innerText.includes(${JSON.stringify(marker)})`, 30_000);
    if (expectedAnswer) {
      await waitFor(cdp, `document.body.innerText.includes(${JSON.stringify(expectedAnswer)})`, 120_000);
    }
    await waitFor(
      cdp,
      `Array.from(document.querySelectorAll('a[href^="/chat/"]')).some((link) => link.textContent?.includes(${JSON.stringify(marker)}))`,
      30_000,
    );
    const threadUrl = await evaluate<string>(cdp, `
      (() => {
        const links = Array.from(document.querySelectorAll('a[href^="/chat/"]'));
        const href = links.find((link) => link.textContent?.includes(${JSON.stringify(marker)}))?.getAttribute('href');
        if (!href) throw new Error('未找到线程链接');
        return new URL(href, location.origin).href;
      })()
    `);
    console.log(JSON.stringify({
      marker,
      threadUrl,
      fixture,
      fixtureName,
      expectedAttachment,
      expectedAnswer: expectedAnswer || null,
    }));
    } else {
    const marker = requiredEnv("CODEX_WEB_E2E_MARKER");
    const fixtureName = requiredEnv("CODEX_WEB_E2E_FIXTURE_NAME");
    const expectedAnswer = process.env.CODEX_WEB_E2E_EXPECTED_ANSWER?.trim();
    await waitFor(cdp, `document.body.innerText.includes(${JSON.stringify(marker)})`, 30_000);
    await waitFor(cdp, `document.body.innerText.includes(${JSON.stringify(fixtureName)})`, 30_000);
    if (expectedAnswer) {
      await waitFor(cdp, `document.body.innerText.includes(${JSON.stringify(expectedAnswer)})`, 30_000);
    }
    const imageCount = expectedAttachment === "image"
      ? await waitForImage(cdp)
      : 0;
    console.log(JSON.stringify({
      marker,
      threadUrl: initialUrl,
      fixtureName,
      expectedAttachment,
      expectedAnswer: expectedAnswer || null,
      imageCount,
    }));
    }
  } catch (error) {
    const bodyText = await evaluate<string>(cdp, "document.body.innerText").catch(() => "");
    console.error(bodyText.slice(-4000));
    throw error;
  } finally {
    cdp.close();
    await fetch(`${cdpBaseUrl}/json/close/${target.id}`).catch(() => undefined);
  }
}

async function createTarget(url: string, cdpBaseUrl: string): Promise<{ id: string; webSocketDebuggerUrl: string }> {
  const response = await fetch(`${cdpBaseUrl}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`创建 CDP target 失败: ${response.status}`);
  return response.json() as Promise<{ id: string; webSocketDebuggerUrl: string }>;
}

async function setFileInput(cdp: CdpClient, filePath: string): Promise<void> {
  const fileContents = await readFile(filePath);
  const isBase64Fixture = filePath.endsWith(".base64");
  const dataBase64 = isBase64Fixture ? fileContents.toString("utf8").trim() : fileContents.toString("base64");
  const sourceName = filePath.split(/[\\/]/).pop() ?? "attachment.png";
  const fileName = isBase64Fixture ? sourceName.slice(0, -".base64".length) : sourceName;
  const mediaType = mediaTypeForFileName(fileName);
  await evaluate(cdp, `
    (() => {
      const input = document.querySelector('input[type=file]');
      if (!(input instanceof HTMLInputElement)) throw new Error('未找到附件文件输入框');
      const binary = atob(${JSON.stringify(dataBase64)});
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], ${JSON.stringify(fileName)}, { type: ${JSON.stringify(mediaType)} }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()
  `);
}

async function waitForImage(cdp: CdpClient): Promise<number> {
  await waitFor(cdp, "document.querySelectorAll('img[src^=\"data:image/\"]').length > 0", 30_000);
  return evaluate<number>(cdp, "document.querySelectorAll('img[src^=\"data:image/\"]').length");
}

function mediaTypeForFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "image/png";
}

async function waitFor(cdp: CdpClient, expression: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate<boolean>(cdp, `Boolean(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`等待页面条件超时: ${expression}`);
}

async function evaluate<T>(cdp: CdpClient, expression: string): Promise<T> {
  const response = await cdp.call<{
    result: { value?: T; description?: string };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result.value as T;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP WebSocket 连接失败")), { once: true });
    });
    return new CdpClient(socket);
  }

  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.socket.send(JSON.stringify(params === undefined ? { id, method } : { id, method, params }));
    });
  }

  close(): void {
    this.socket.close();
  }
}

await main();
