'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  SpinnerGap,
  CaretRight,
} from "@phosphor-icons/react";
import { CodexWebIcon, type CodexWebIconName } from "@/components/ui/semantic-icon";
import { cn } from '@/lib/utils';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { Streamdown } from 'streamdown';
import { useStreamdownPlugins } from '@/components/ai-elements/streamdown-plugins';
import type { MediaBlock } from '@/types';

const TOOL_OUTPUT_MAX_LINES = 5;
const TOOL_COMMAND_CONTINUATION_MAX_LINES = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolAction {
  id?: string;
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
  media?: MediaBlock[];
}

interface ToolActionsGroupProps {
  tools: ToolAction[];
  isStreaming?: boolean;
  streamingToolOutput?: string;
  defaultExpanded?: boolean;
  /** When true, skip the collapsible header and render the tool list directly */
  flat?: boolean;
  /** Thinking/reasoning content — rendered as the first expandable item inside the group */
  thinkingContent?: string;
  elapsedMs?: number;
  processCount?: number;
}

interface ProcessCollapseGroupProps {
  children: React.ReactNode;
  defaultExpanded?: boolean;
  active?: boolean;
  summary?: React.ReactNode;
  elapsedMs?: number;
  processCount?: number;
}

// ---------------------------------------------------------------------------
// Tool Registry — extensible per-type rendering
// ---------------------------------------------------------------------------

interface ToolRendererDef {
  match: (name: string) => boolean;
  iconName: CodexWebIconName;
  label: string;
  getSummary: (input: unknown, name?: string) => string;
}

function extractFilename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function getFilePath(input: unknown): string {
  const inp = input as Record<string, unknown> | undefined;
  if (!inp) return '';
  return (inp.file_path || inp.path || inp.filePath || '') as string;
}

function inputRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined;
}

function stringField(input: unknown, fields: string[]): string {
  const record = inputRecord(input);
  if (!record) return '';
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function commandText(input: unknown): string {
  return stringField(input, ['command', 'cmd', 'script']);
}

function summarizeToolInput(input: unknown, name: string): string {
  if (!input || typeof input !== 'object') return name;
  try {
    const text = JSON.stringify(input);
    return text.length > 140 ? `${text.slice(0, 137)}...` : text;
  } catch {
    return name;
  }
}

function toolKind(name: string): 'terminal' | 'search' | 'read' | 'write' | 'tool' {
  const lower = name.toLowerCase();
  if (['bash', 'execute', 'run', 'shell', 'execute_command', 'exec_command'].includes(lower)) return 'terminal';
  if (['search', 'glob', 'grep', 'find_files', 'search_files', 'websearch', 'web_search'].includes(lower)) return 'search';
  if (['read', 'readfile', 'read_file'].includes(lower)) return 'read';
  if (['write', 'edit', 'writefile', 'write_file', 'create_file', 'createfile', 'notebookedit', 'notebook_edit'].includes(lower)) return 'write';
  return 'tool';
}

function toolTitle(tool: ToolAction, status: ToolStatus): string {
  const kind = toolKind(tool.name);
  if (kind === 'terminal') {
    if (status === 'running') return '正在运行';
    return status === 'error' ? '运行失败' : '已运行';
  }
  if (kind === 'search') return status === 'running' ? '正在搜索' : '已搜索';
  if (kind === 'read') return status === 'running' ? '正在读取' : '已读取';
  if (kind === 'write') return status === 'running' ? '正在编辑' : '已编辑';
  return status === 'running' ? '正在调用' : '已调用';
}

function toolDetail(tool: ToolAction, renderer: ToolRendererDef): string {
  if (toolKind(tool.name) === 'terminal') {
    return commandText(tool.input) || renderer.getSummary(tool.input, tool.name);
  }
  if (toolKind(tool.name) === 'tool') {
    return `${tool.name} ${summarizeToolInput(tool.input, tool.name)}`.trim();
  }
  return renderer.getSummary(tool.input, tool.name);
}

function splitNonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.length > 0);
}

function truncatedOutputLines(output: string, running: boolean): Array<{ text: string; omitted?: number }> {
  const lines = splitNonEmptyLines(output);
  if (lines.length <= TOOL_OUTPUT_MAX_LINES) {
    return lines.map((text) => ({ text }));
  }
  if (running) {
    const omitted = lines.length - TOOL_OUTPUT_MAX_LINES;
    return [
      { text: `… +${omitted} lines`, omitted },
      ...lines.slice(-TOOL_OUTPUT_MAX_LINES).map((text) => ({ text })),
    ];
  }
  const head = Math.max(1, Math.floor((TOOL_OUTPUT_MAX_LINES - 1) / 2));
  const tail = Math.max(1, TOOL_OUTPUT_MAX_LINES - 1 - head);
  const omitted = lines.length - head - tail;
  return [
    ...lines.slice(0, head).map((text) => ({ text })),
    { text: `… +${omitted} lines`, omitted },
    ...lines.slice(-tail).map((text) => ({ text })),
  ];
}

const TOOL_REGISTRY: ToolRendererDef[] = [
  {
    match: (n) => ['bash', 'execute', 'run', 'shell', 'execute_command', 'exec_command'].includes(n.toLowerCase()),
    iconName: 'terminal',
    label: '',
    getSummary: (input) => {
      const cmd = ((input as Record<string, unknown>)?.command || (input as Record<string, unknown>)?.cmd || '') as string;
      return cmd ? (cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd) : 'bash';
    },
  },
  {
    match: (n) => ['write', 'edit', 'writefile', 'write_file', 'create_file', 'createfile', 'notebookedit', 'notebook_edit'].includes(n.toLowerCase()),
    iconName: 'edit',
    label: 'Edit',
    getSummary: (input) => {
      const path = getFilePath(input);
      return path ? extractFilename(path) : 'file';
    },
  },
  {
    match: (n) => ['read', 'readfile', 'read_file'].includes(n.toLowerCase()),
    iconName: 'file',
    label: 'Read',
    getSummary: (input) => {
      const path = getFilePath(input);
      return path ? extractFilename(path) : 'file';
    },
  },
  {
    match: (n) => ['search', 'glob', 'grep', 'find_files', 'search_files', 'websearch', 'web_search'].includes(n.toLowerCase()),
    iconName: 'search',
    label: 'Search',
    getSummary: (input) => {
      const inp = input as Record<string, unknown> | undefined;
      const pattern = (inp?.pattern || inp?.query || inp?.glob || '') as string;
      return pattern ? `"${pattern.length > 50 ? pattern.slice(0, 47) + '...' : pattern}"` : 'search';
    },
  },
  {
    match: (n) => n.toLowerCase() === 'agent',
    iconName: 'assistant',
    label: 'Agent',
    getSummary: (input) => {
      const inp = input as Record<string, unknown> | undefined;
      const agentType = (inp?.agent || 'general') as string;
      const prompt = (inp?.prompt || '') as string;
      const short = prompt.length > 50 ? prompt.slice(0, 47) + '...' : prompt;
      return `${agentType}: ${short}`;
    },
  },
  {
    // Fallback — must be last. Shows the raw tool name so unregistered tools
    // (TodoWrite, MCP tools, plugin tools) remain identifiable.
    match: () => true,
    iconName: 'wrench',
    label: '',
    getSummary: (input, name?: string) => {
      const prefix = name || '';
      if (!input || typeof input !== 'object') return prefix;
      const str = JSON.stringify(input);
      const detail = str.length > 50 ? str.slice(0, 47) + '...' : str;
      return prefix ? `${prefix} ${detail}` : detail;
    },
  },
];

function getRenderer(name: string): ToolRendererDef {
  return TOOL_REGISTRY.find((r) => r.match(name)) || TOOL_REGISTRY[TOOL_REGISTRY.length - 1];
}

/** Register a custom tool renderer. It takes priority over built-in ones. */
export function registerToolRenderer(def: ToolRendererDef): void {
  TOOL_REGISTRY.unshift(def);
}

// ---------------------------------------------------------------------------
// Status indicator — running: gray, completed: green, error: red
// ---------------------------------------------------------------------------

type ToolStatus = 'running' | 'success' | 'error';

function getStatus(tool: ToolAction): ToolStatus {
  if (tool.result === undefined) return 'running';
  return tool.isError ? 'error' : 'success';
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 1) return '<1s';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function ProcessCollapseGroup({
  children,
  defaultExpanded = false,
  active = false,
  summary,
  elapsedMs,
  processCount,
}: ProcessCollapseGroupProps) {
  const [userExpandedState, setUserExpandedState] = useState<boolean | null>(null);
  const expanded = userExpandedState !== null ? userExpandedState : defaultExpanded;
  const fallbackSummary = (() => {
    if (elapsedMs !== undefined) return `已处理 ${formatElapsed(elapsedMs)}`;
    if (processCount !== undefined) return `已处理 ${processCount} 项`;
    return '已处理';
  })();

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setUserExpandedState((prev) => prev !== null ? !prev : !expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 border-b border-border/60 py-2.5 text-sm transition-colors hover:text-foreground"
      >
        <span className="font-normal text-muted-foreground truncate">
          {summary ?? fallbackSummary}
        </span>
        {active && <SpinnerGap size={14} className="shrink-0 animate-spin text-muted-foreground/60" />}
        <CaretRight
          size={15}
          className={cn(
            "shrink-0 text-muted-foreground/60 transition-transform duration-200",
            expanded && "rotate-90"
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{ overflow: 'hidden', transformOrigin: 'top' }}
          >
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
              className="mt-0.5"
            >
              <div className="pt-3">
                {children}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context tool grouping — auto-group 3+ consecutive read/search tools
// ---------------------------------------------------------------------------

const CONTEXT_TOOLS = new Set([
  'read', 'readfile', 'read_file',
  'glob', 'grep',
  'ls', 'list', 'list_files',
  'search', 'find_files', 'search_files',
]);

function isContextTool(name: string): boolean {
  return CONTEXT_TOOLS.has(name.toLowerCase());
}

type Segment =
  | { kind: 'context'; tools: ToolAction[] }
  | { kind: 'single'; tool: ToolAction };

function computeSegments(tools: ToolAction[]): Segment[] {
  const segments: Segment[] = [];
  let contextBuffer: ToolAction[] = [];

  const flushContext = () => {
    if (contextBuffer.length >= 3) {
      segments.push({ kind: 'context', tools: contextBuffer });
    } else {
      for (const t of contextBuffer) {
        segments.push({ kind: 'single', tool: t });
      }
    }
    contextBuffer = [];
  };

  for (const tool of tools) {
    if (isContextTool(tool.name)) {
      contextBuffer.push(tool);
    } else {
      flushContext();
      segments.push({ kind: 'single', tool });
    }
  }
  flushContext();
  return segments;
}

function ContextGroup({ tools }: { tools: ToolAction[] }) {
  const [expanded, setExpanded] = useState(false);
  const hasRunning = tools.some((t) => t.result === undefined);
  const hasError = tools.some((t) => t.isError);
  const groupStatus: ToolStatus = hasRunning ? 'running' : hasError ? 'error' : 'success';

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 px-2 py-1 min-h-[28px] text-xs hover:bg-muted/30 rounded-sm transition-colors"
      >
        <StatusBullet status={groupStatus} />
        <CaretRight
          size={10}
          className={cn(
            "shrink-0 text-muted-foreground/60 transition-transform duration-200",
            expanded && "rotate-90"
          )}
        />
        <span className="font-medium text-muted-foreground">
          {hasRunning ? '正在探索' : '已探索'}
        </span>
        <span className="font-mono text-muted-foreground/50">
          {tools.length} 项
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="ml-5 space-y-0.5 font-mono text-[12px] leading-5">
              {tools.map((tool, i) => (
                <div key={tool.id || `ctx-${i}`} className="flex gap-2 text-muted-foreground/75">
                  <span className="shrink-0 text-muted-foreground/45">{i === 0 ? '└' : ' '}</span>
                  <span className="shrink-0 text-cyan-600 dark:text-cyan-400">
                    {toolKind(tool.name) === 'search' ? 'Search' : 'Read'}
                  </span>
                  <span className="truncate">{getRenderer(tool.name).getSummary(tool.input, tool.name)}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusBullet({ status }: { status: ToolStatus }) {
  if (status === 'running') {
    return <SpinnerGap size={13} className="shrink-0 animate-spin text-muted-foreground/55" />;
  }
  return (
    <span
      className={cn(
        "inline-flex w-[13px] shrink-0 justify-center font-mono text-sm leading-none",
        status === 'success' ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
      )}
      aria-hidden
    >
      •
    </span>
  );
}

// ---------------------------------------------------------------------------
// Thinking row — same style as tool rows, Brain icon → caret on hover
// ---------------------------------------------------------------------------

function ThinkingRow({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  // Default open during streaming, collapsed in history
  const [expanded, setExpanded] = useState(!!isStreaming);
  const [hovered, setHovered] = useState(false);
  const { stopScroll } = useStickToBottomContext();
  const plugins = useStreamdownPlugins(content);

  // Extract summary from first **bold** or # heading
  const summary = (() => {
    const boldMatch = content.match(/\*\*(.+?)\*\*/);
    if (boldMatch) return boldMatch[1];
    const headingMatch = content.match(/^#{1,4}\s+(.+)$/m);
    if (headingMatch) return headingMatch[1];
    return isStreaming ? '正在思考...' : '思考过程';
  })();

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          const willExpand = !expanded;
          setExpanded(willExpand);
          // Detach from auto-scroll when expanding to prevent page jump
          if (willExpand) stopScroll();
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex items-center gap-2 px-2 py-1 min-h-[28px] text-xs hover:bg-muted/30 rounded-sm transition-colors w-full"
      >
        {hovered ? (
          <CaretRight
            size={14}
            className={cn(
              "shrink-0 text-muted-foreground transition-transform duration-200",
              expanded && "rotate-90"
            )}
          />
        ) : (
          <CodexWebIcon name="assistant" size="sm" className="shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="font-mono text-muted-foreground/60 truncate flex-1 text-left">
          {isStreaming ? <Shimmer duration={1.5}>{summary}</Shimmer> : summary}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="ml-6 px-2 py-1.5 text-xs text-muted-foreground/70 border-l-2 border-border/30 prose prose-sm dark:prose-invert max-w-none">
              <Streamdown plugins={plugins}>{content}</Streamdown>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact row for a single tool action
// ---------------------------------------------------------------------------

function ToolActionRow({ tool, streamingToolOutput }: { tool: ToolAction; streamingToolOutput?: string }) {
  const renderer = getRenderer(tool.name);
  const status = getStatus(tool);
  const running = status === 'running';
  const detail = toolDetail(tool, renderer);
  const detailLines = splitNonEmptyLines(detail);
  const [firstDetailLine = detail, ...restDetailLines] = detailLines.length > 0 ? detailLines : [detail];
  const visibleContinuation = restDetailLines.slice(0, TOOL_COMMAND_CONTINUATION_MAX_LINES);
  const hiddenContinuation = restDetailLines.length - visibleContinuation.length;
  const outputText = running ? streamingToolOutput : tool.result;
  const outputLines = outputText ? truncatedOutputLines(outputText, running) : [];

  return (
    <div className="px-2 py-1 text-xs hover:bg-muted/20 rounded-sm transition-colors">
      <div className="flex min-h-[24px] items-baseline gap-2">
        <StatusBullet status={status} />
        <span className="shrink-0 font-semibold text-muted-foreground">
          {toolTitle(tool, status)}
        </span>
        <span className="min-w-0 flex-1 break-words font-mono text-muted-foreground/75">
          {firstDetailLine}
        </span>
        {tool.media && tool.media.length > 0 && (
          <CodexWebIcon name="image" size="sm" className="shrink-0 text-primary/60" aria-hidden />
        )}
      </div>

      {visibleContinuation.length > 0 && (
        <div className="ml-[21px] font-mono text-[12px] leading-5 text-muted-foreground/60">
          {visibleContinuation.map((line, index) => (
            <div key={`${tool.id ?? tool.name}-cmd-${index}`} className="flex gap-2">
              <span className="shrink-0 text-muted-foreground/40">│</span>
              <span className="min-w-0 break-words">{line}</span>
            </div>
          ))}
          {hiddenContinuation > 0 && (
            <div className="flex gap-2">
              <span className="shrink-0 text-muted-foreground/40">│</span>
              <span>… +{hiddenContinuation} lines</span>
            </div>
          )}
        </div>
      )}

      {outputLines.length > 0 && (
        <div className="ml-[21px] font-mono text-[12px] leading-5 text-muted-foreground/60">
          {outputLines.map((line, index) => (
            <div key={`${tool.id ?? tool.name}-out-${index}`} className="flex gap-2">
              <span className="shrink-0 text-muted-foreground/40">{index === 0 ? '└' : ' '}</span>
              <span className={cn("min-w-0 break-words", line.omitted !== undefined && "italic")}>
                {line.text}
              </span>
            </div>
          ))}
        </div>
      )}

      {running && !outputText && (
        <div className="ml-[21px] flex gap-2 font-mono text-[12px] leading-5 text-muted-foreground/45">
          <span className="shrink-0">└</span>
          <Shimmer duration={1.5}>正在思考</Shimmer>
        </div>
      )}

      {toolKind(tool.name) === 'terminal' && !running && !tool.result && !tool.isError && (
        <div className="ml-[21px] flex gap-2 font-mono text-[12px] leading-5 text-muted-foreground/45">
          <span className="shrink-0">└</span>
          <span>(no output)</span>
        </div>
      )}

    </div>
  );
}

// ---------------------------------------------------------------------------
// Header summary helper — build running task description
// ---------------------------------------------------------------------------

function getRunningDescription(tools: ToolAction[]): string {
  const running = tools.filter((t) => t.result === undefined);
  if (running.length === 0) return '';
  const last = running[running.length - 1];
  return getRenderer(last.name).getSummary(last.input, last.name);
}

// ---------------------------------------------------------------------------
// Main group component
// ---------------------------------------------------------------------------

export function ToolActionsGroup({
  tools,
  isStreaming = false,
  streamingToolOutput,
  defaultExpanded,
  flat = false,
  thinkingContent,
  elapsedMs,
  processCount,
}: ToolActionsGroupProps) {
  const hasRunningTool = tools.some((t) => t.result === undefined);
  const hasMetadata = elapsedMs !== undefined || processCount !== undefined;
  const hasDetails = tools.length > 0 || !!thinkingContent;

  // Track whether user has manually toggled and their chosen state
  const [userExpandedState, setUserExpandedState] = useState<boolean | null>(null);

  if (tools.length === 0 && !thinkingContent && !hasMetadata) return null;

  // Derived: if user has toggled, use their choice; otherwise auto-expand based on streaming state
  const autoExpanded = defaultExpanded ?? (hasRunningTool || isStreaming);
  const expanded = hasDetails && (userExpandedState !== null ? userExpandedState : autoExpanded);

  // Flat mode: skip header, render tool list directly
  if (flat) {
    const lastRunningId = [...tools].reverse().find((t) => t.result === undefined)?.id;
    return (
      <div className="w-[min(100%,48rem)]">
        <div className="border-l-2 border-border/50 pl-2 ml-1.5">
          {thinkingContent && <ThinkingRow content={thinkingContent} isStreaming={isStreaming} />}
          {computeSegments(tools).map((seg, i) =>
            seg.kind === 'context' ? (
              <ContextGroup key={`ctx-group-${i}`} tools={seg.tools} />
            ) : (
              <ToolActionRow
                key={seg.tool.id || `tool-${i}`}
                tool={seg.tool}
                streamingToolOutput={seg.tool.id === lastRunningId ? streamingToolOutput : undefined}
              />
            )
          )}
        </div>
      </div>
    );
  }

  const runningCount = tools.filter((t) => t.result === undefined).length;
  const runningDesc = getRunningDescription(tools);
  const hasError = tools.some((t) => t.isError);
  const elapsedText = elapsedMs !== undefined ? ` ${formatElapsed(elapsedMs)}` : '';
  const singleInlineTool = !hasMetadata && !thinkingContent && tools.length === 1 ? tools[0] : null;
  const singleInlineDetail = singleInlineTool
    ? toolDetail(singleInlineTool, getRenderer(singleInlineTool.name))
    : '';
  const headerDetail = singleInlineDetail || runningDesc;

  const handleToggle = () => {
    if (!hasDetails) return;
    setUserExpandedState((prev) => prev !== null ? !prev : !expanded);
  };

  const summaryText = (() => {
    if (singleInlineTool) return toolTitle(singleInlineTool, getStatus(singleInlineTool));
    if (runningCount > 0) return runningCount === 1 ? '正在处理' : `正在处理 ${runningCount} 项`;
    if (isStreaming) return '正在生成回答';
    if (hasError) return `处理遇到问题${elapsedText}`;
    if (!hasMetadata && tools.length > 1) return `已处理 ${tools.length} 项`;
    return `已处理${elapsedText}`;
  })();

  return (
    <div className="w-[min(100%,48rem)]">
      {/* Header — content left, caret right.
          Round 12 fix: was `py-1 rounded-sm` with NO horizontal
          padding, so the inner count badge sat flush against the
          button's left edge and the hover-bg `rounded-sm` (2px)
          curve cut into the badge's own `rounded` (4px). Visually
          this read as "图标露在 hover 区外". `px-2` + `rounded-md`
          (6px) keeps the badge inside the hover surface and matches
          the curve scale across nested elements. */}
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={hasDetails ? expanded : undefined}
        className={cn(
          "flex w-full items-center gap-2 px-2 py-1 text-xs rounded-md transition-colors",
          hasDetails ? "hover:bg-muted/30" : "cursor-default"
        )}
      >
        {hasRunningTool || isStreaming ? (
          <SpinnerGap size={14} className="shrink-0 animate-spin text-muted-foreground/60" />
        ) : (
          <CodexWebIcon name="terminal" size="sm" className="shrink-0 text-muted-foreground/70" aria-hidden />
        )}

        <span className="font-medium text-muted-foreground/70 truncate">
          {summaryText}
        </span>

        {/* Show running task description */}
        {headerDetail && (
          <span className="text-muted-foreground/40 text-[11px] font-mono truncate max-w-[40%]">
            {hasRunningTool ? <Shimmer duration={1.5}>{headerDetail}</Shimmer> : headerDetail}
          </span>
        )}

        {hasDetails && (
          <CaretRight
            size={12}
            className={cn(
              "shrink-0 text-muted-foreground/60 transition-transform duration-200 ml-auto",
              expanded && "rotate-90"
            )}
          />
        )}
      </button>

      {/* Expanded list — left vertical line like blockquote */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{ overflow: 'hidden', transformOrigin: 'top' }}
          >
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
            >
              <div className="ml-1.5 mt-0.5 border-l-2 border-border/50 pl-2">
                {thinkingContent && <ThinkingRow content={thinkingContent} isStreaming={isStreaming} />}
                {(() => {
                  const segments = computeSegments(tools);
                  // Find the last running tool to attach streamingToolOutput
                  const lastRunningId = [...tools].reverse().find((t) => t.result === undefined)?.id;
                  return segments.map((seg, i) =>
                    seg.kind === 'context' ? (
                      <ContextGroup key={`ctx-group-${i}`} tools={seg.tools} />
                    ) : (
                      <ToolActionRow
                        key={seg.tool.id || `tool-${i}`}
                        tool={seg.tool}
                        streamingToolOutput={seg.tool.id === lastRunningId ? streamingToolOutput : undefined}
                      />
                    )
                  );
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
