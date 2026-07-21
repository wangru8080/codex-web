const now = new Date("2026-07-06T10:00:00.000Z");

function minutesAgo(minutes: number): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

const demoSession = {
  id: "demo-session",
  title: "检查 CodexWeb 浏览器端",
  created_at: minutesAgo(72),
  updated_at: minutesAgo(8),
  model: "gpt-5.5",
  system_prompt: "",
  working_directory: "/Users/wr/Documents/codex/Chat/data/CodexWeb",
  sdk_session_id: "",
  codex_thread_id: "thread-demo",
  project_name: "CodexWeb",
  source: "user",
  origin: "codepilot",
  status: "active",
  mode: "code",
  needs_approval: false,
  provider_name: "Codex",
  provider_id: "codex_account",
  runtime_pin: "codex_runtime",
  sdk_cwd: "/Users/wr/Documents/codex/Chat/data/CodexWeb",
  runtime_status: "ready",
  runtime_updated_at: minutesAgo(8),
  runtime_error: "",
  permission_profile: "default"
};

const sessions = [
  demoSession,
  {
    ...demoSession,
    id: "context-session",
    title: "澄清上下文压缩",
    updated_at: minutesAgo(64)
  },
  {
    ...demoSession,
    id: "skills-session",
    title: "查看技能",
    updated_at: minutesAgo(60 * 24 * 3),
    working_directory: "/Users/wr/Documents/codex/Chat/data/Skills",
    project_name: "Skills"
  },
  {
    ...demoSession,
    id: "app-server-session",
    title: "详细介绍 codex app-server",
    updated_at: minutesAgo(60 * 24 * 3 + 30)
  },
  {
    ...demoSession,
    id: "docker-session",
    title: "开发docker，需要上传到hub上吗",
    updated_at: minutesAgo(60 * 24 * 5)
  }
];

const assistantBlocks = [
  {
    type: "codex_process_text",
    text: "我会先确认当前 CodexWeb 的浏览器端入口和真实布局组件，不重新设计 UI。"
  },
  {
    type: "tool_use",
    id: "tool-1",
    name: "读取项目结构",
    input: { cmd: "find src/app src/components -maxdepth 2 -type f" }
  },
  {
    type: "tool_result",
    tool_use_id: "tool-1",
    content: "已读取真实 AppShell、ChatListPanel、ChatView、MessageItem 和 settings 组件。"
  },
  {
    type: "codex_process_text",
    text: "确认后端入口集中在 /api 下，前端 1:1 展示版可以通过 mock API 保留原始 fetch 调用。"
  },
  {
    type: "tool_use",
    id: "tool-2",
    name: "写入 mock API",
    input: { file: "src/proxy.ts" }
  },
  {
    type: "tool_result",
    tool_use_id: "tool-2",
    content: "已拦截会话、消息、设置、模型、workspace、通知等展示所需接口。"
  },
  {
    type: "codex_summary",
    elapsed_ms: 372000,
    process_count: 2
  },
  {
    type: "text",
    text: "这份副本保留 CodexWeb 当前真实前端界面：左侧项目/会话栏、顶部栏、聊天消息、工具 cell、已处理时间和输入框都来自原项目组件。后端能力全部由 mock API 提供，因此只用于浏览器 UI 展示。"
  }
];

const messages = [
  {
    id: "msg-user-1",
    session_id: "demo-session",
    role: "user",
    content: JSON.stringify([
      {
        type: "text",
        text: "请把前端代码剥离出来，但界面必须和 CodexWeb 当前前端一模一样。"
      }
    ]),
    created_at: minutesAgo(12),
    token_usage: null,
    _rowid: 1
  },
  {
    id: "msg-assistant-1",
    session_id: "demo-session",
    role: "assistant",
    content: JSON.stringify(assistantBlocks),
    created_at: minutesAgo(8),
    token_usage: JSON.stringify({
      input_tokens: 16840,
      output_tokens: 2480,
      cache_read_input_tokens: 9200,
      cost_usd: 0.042
    }),
    _rowid: 2
  }
];

const settings = {
  language: "zh",
  theme_mode: "system",
  theme_family: "default",
  agent_runtime: "codex_runtime",
  default_panel: "file_tree",
  setup_completed: "true",
  onboarding_dismissed: "true",
  feature_announcement_dismissed: "true",
  codex_only: "true"
};

const providerModelGroups = [
  {
    provider_id: "codex_account",
    provider_name: "Codex",
    provider_type: "codex",
    protocol: "codex",
    runtime: "codex_runtime",
    models: [
      {
        value: "gpt-5.5",
        label: "GPT-5.5",
        upstreamModelId: "gpt-5.5",
        supportedRuntimes: ["codex_runtime"],
        enabled: 1,
        context_window: 200000
      }
    ]
  }
];

const dashboardConfig = {
  version: 1,
  settings: {
    autoRefreshOnOpen: false
  },
  widgets: []
};

const projectRoot = demoSession.working_directory;
const virtualRoot = `${projectRoot}/virtual-codex-web`;

const virtualFiles: Record<string, string> = {
  [`${virtualRoot}/README.md`]: `# CodexWeb 前端 1:1 预览

这个目录是前端展示版的虚拟项目文件树。

- 左侧：项目与历史会话列表
- 中间：聊天消息、工具 cell、处理时间
- 右侧：文件树与文件预览
`,
  [`${virtualRoot}/package.json`]: `{
  "name": "codepilot-frontend-preview",
  "private": true,
  "scripts": {
    "dev": "next dev --webpack",
    "build": "next build --webpack"
  }
}
`,
  [`${virtualRoot}/src/app/chat/page.tsx`]: `export default function ChatPage() {
  return <main>CodexWeb 聊天页预览</main>;
}
`,
  [`${virtualRoot}/src/app/settings/codex/page.tsx`]: `export default function CodexSettingsPage() {
  return <main>Codex 设置页预览</main>;
}
`,
  [`${virtualRoot}/src/components/chat/MessageItem.tsx`]: `export function MessageItem() {
  return <article>消息、工具调用和最终回答展示</article>;
}
`,
  [`${virtualRoot}/src/components/layout/ChatListPanel.tsx`]: `export function ChatListPanel() {
  return <aside>项目下的历史任务列表</aside>;
}
`,
  [`${virtualRoot}/src/frontend-preview/mock-api.ts`]: `export function mockApiResponse() {
  return Response.json({ mode: "frontend-preview" });
}
`,
  [`${virtualRoot}/themes/default.json`]: `{
  "name": "CodexWeb Default",
  "description": "前端预览使用的默认主题"
}
`
};

const virtualTree = [
  {
    name: "virtual-codex-web",
    path: virtualRoot,
    type: "directory",
    children: [
      {
        name: "README.md",
        path: `${virtualRoot}/README.md`,
        type: "file",
        extension: "md",
        size: virtualFiles[`${virtualRoot}/README.md`].length
      },
      {
        name: "package.json",
        path: `${virtualRoot}/package.json`,
        type: "file",
        extension: "json",
        size: virtualFiles[`${virtualRoot}/package.json`].length
      },
      {
        name: "src",
        path: `${virtualRoot}/src`,
        type: "directory",
        children: [
          {
            name: "app",
            path: `${virtualRoot}/src/app`,
            type: "directory",
            children: [
              {
                name: "chat",
                path: `${virtualRoot}/src/app/chat`,
                type: "directory",
                children: [
                  {
                    name: "page.tsx",
                    path: `${virtualRoot}/src/app/chat/page.tsx`,
                    type: "file",
                    extension: "tsx",
                    size: virtualFiles[`${virtualRoot}/src/app/chat/page.tsx`].length
                  }
                ]
              },
              {
                name: "settings",
                path: `${virtualRoot}/src/app/settings`,
                type: "directory",
                children: [
                  {
                    name: "codex",
                    path: `${virtualRoot}/src/app/settings/codex`,
                    type: "directory",
                    children: [
                      {
                        name: "page.tsx",
                        path: `${virtualRoot}/src/app/settings/codex/page.tsx`,
                        type: "file",
                        extension: "tsx",
                        size: virtualFiles[`${virtualRoot}/src/app/settings/codex/page.tsx`].length
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            name: "components",
            path: `${virtualRoot}/src/components`,
            type: "directory",
            children: [
              {
                name: "chat",
                path: `${virtualRoot}/src/components/chat`,
                type: "directory",
                children: [
                  {
                    name: "MessageItem.tsx",
                    path: `${virtualRoot}/src/components/chat/MessageItem.tsx`,
                    type: "file",
                    extension: "tsx",
                    size: virtualFiles[`${virtualRoot}/src/components/chat/MessageItem.tsx`].length
                  }
                ]
              },
              {
                name: "layout",
                path: `${virtualRoot}/src/components/layout`,
                type: "directory",
                children: [
                  {
                    name: "ChatListPanel.tsx",
                    path: `${virtualRoot}/src/components/layout/ChatListPanel.tsx`,
                    type: "file",
                    extension: "tsx",
                    size: virtualFiles[`${virtualRoot}/src/components/layout/ChatListPanel.tsx`].length
                  }
                ]
              }
            ]
          },
          {
            name: "frontend-preview",
            path: `${virtualRoot}/src/frontend-preview`,
            type: "directory",
            children: [
              {
                name: "mock-api.ts",
                path: `${virtualRoot}/src/frontend-preview/mock-api.ts`,
                type: "file",
                extension: "ts",
                size: virtualFiles[`${virtualRoot}/src/frontend-preview/mock-api.ts`].length
              }
            ]
          }
        ]
      },
      {
        name: "themes",
        path: `${virtualRoot}/themes`,
        type: "directory",
        children: [
          {
            name: "default.json",
            path: `${virtualRoot}/themes/default.json`,
            type: "file",
            extension: "json",
            size: virtualFiles[`${virtualRoot}/themes/default.json`].length
          }
        ]
      }
    ]
  }
] as const;

function previewLanguage(filePath: string): string {
  const extension = filePath.split(".").pop()?.toLowerCase();
  if (extension === "md") return "markdown";
  if (extension === "json") return "json";
  if (extension === "tsx" || extension === "ts") return "typescript";
  return "text";
}

function virtualPreview(filePath: string) {
  const content = virtualFiles[filePath];
  if (!content) return null;
  const bytes = new TextEncoder().encode(content).length;
  return {
    path: filePath,
    content,
    language: previewLanguage(filePath),
    line_count: content.split(/\r\n|\r|\n/).length,
    line_count_exact: true,
    truncated: false,
    bytes_read: bytes,
    bytes_total: bytes
  };
}

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, {
    status: init?.status ?? 200,
    headers: {
      "cache-control": "no-store",
      ...(init?.headers ?? {})
    }
  });
}

export function mockApiResponse(request: Request): Response | null {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (!pathname.startsWith("/api/")) return null;

  if (pathname === "/api/chat/sessions") {
    if (request.method === "POST") return json({ session: demoSession });
    return json({ sessions });
  }

  if (pathname === "/api/codex/sessions") {
    return json({ sessions: [] });
  }

  if (pathname === "/api/chat/sessions/demo-session") {
    return json({ session: demoSession });
  }

  if (pathname === "/api/chat/sessions/demo-session/messages") {
    return json({ messages, hasMore: false, taskRuns: {} });
  }

  if (pathname === "/api/settings/workspace") {
    return json({
      enabled: false,
      workspacePath: "",
      settings: { assistant_workspace_enabled: "false" }
    });
  }

  if (pathname === "/api/setup") {
    return json({
      completed: true,
      defaultProject: demoSession.working_directory,
      settings
    });
  }

  if (pathname === "/api/setup/recent-projects") {
    return json({
      projects: [demoSession.working_directory]
    });
  }

  if (pathname === "/api/workspace/summary") {
    return json({
      configured: false,
      name: "CodexWeb",
      memoryCount: 0,
      lastHeartbeatDate: "",
      buddy: { emoji: "C", buddyName: "CodexWeb" }
    });
  }

  if (pathname === "/api/workspace/quick-actions") {
    return json({ actions: [] });
  }

  if (pathname === "/api/tasks/notify") {
    return json({ notifications: [] });
  }

  if (pathname === "/api/tasks/notify/ack") {
    return json({ success: true });
  }

  if (pathname === "/api/dashboard") {
    return json(dashboardConfig);
  }

  if (pathname === "/api/dashboard/refresh") {
    return json({ config: dashboardConfig });
  }

  if (pathname === "/api/app/updates") {
    return json({
      updateAvailable: false,
      latestVersion: "0.1.0",
      currentVersion: "0.1.0",
      releaseName: "",
      releaseNotes: "",
      releaseUrl: "",
      publishedAt: ""
    });
  }

  if (pathname === "/api/codex/models") {
    return json({ group: providerModelGroups[0] });
  }

  if (pathname === "/api/providers/models") {
    return json({ providers: providerModelGroups, groups: providerModelGroups });
  }

  if (pathname === "/api/providers/options") {
    return json({
      options: {
        thinking_mode: "adaptive",
        context_1m: false
      }
    });
  }

  if (pathname === "/api/codex/account") {
    return json({
      loggedIn: true,
      authMethod: "mock",
      accountEmail: "mock@codepilot.local",
      planType: "preview"
    });
  }

  if (pathname === "/api/codex/status") {
    return json({
      available: true,
      reason: null,
      mode: "mock"
    });
  }

  if (pathname === "/api/codex/rate-limits") {
    return json({ windows: [] });
  }

  if (pathname === "/api/files") {
    return json({
      tree: virtualTree,
      root: url.searchParams.get("dir") || projectRoot
    });
  }

  if (pathname === "/api/files/preview") {
    const filePath = url.searchParams.get("path") || "";
    const preview = virtualPreview(filePath);
    if (!preview) {
      return json({ error: "虚拟预览文件不存在" }, { status: 404 });
    }
    return json({ preview });
  }

  if (pathname === "/api/files/browse") {
    return json({
      path: url.searchParams.get("dir") || demoSession.working_directory,
      entries: []
    });
  }

  if (pathname === "/api/git/status") {
    return json({
      branch: "main",
      changedFiles: [],
      ahead: 0,
      behind: 0,
      clean: true,
      cwd: url.searchParams.get("cwd") || demoSession.working_directory
    });
  }

  if (pathname === "/api/git/branches") {
    return json({ branches: ["main"], current: "main" });
  }

  if (pathname === "/api/git/log") {
    return json({ commits: [] });
  }

  if (pathname === "/api/chat/messages") {
    return json({ success: true });
  }

  if (pathname === "/api/chat/mode") {
    return json({ success: true });
  }

  if (pathname === "/api/chat/permission") {
    return json({ success: true });
  }

  if (pathname === "/api/chat") {
    return new Response("data: {\"type\":\"done\"}\n\n", {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store"
      }
    });
  }

  return json({ success: true, items: [], results: [], data: null });
}
