/**
 * Command metadata — shared constants for slash commands and their expansion prompts.
 *
 * Lives in lib/constants/ to avoid circular dependencies between hooks and logic modules.
 * Icon assignments live in command-icons.ts to keep this module presentation-free.
 */

import type { PopoverItem } from '@/types';

/** Expansion prompts for CLI-only commands (not natively supported by SDK). */
export const COMMAND_PROMPTS: Record<string, string> = {
  '/doctor': 'Run diagnostic checks on this project. Check system health, dependencies, configuration files, and report any issues.',
  '/terminal-setup': 'Help me configure my terminal for optimal use with Claude Code. Check current setup and suggest improvements.',
  '/memory': 'Show the current CLAUDE.md project memory file and help me review or edit it.',
};

/** Built-in slash commands shown in the popover (without icons — see command-icons.ts). */
export const BUILT_IN_COMMANDS: PopoverItem[] = [
  { label: 'MCP', value: '/mcp', description: '显示 MCP 服务器状态', builtIn: true, immediate: true },
  { label: '代码审查', value: '/review', description: '审查未暂存的更改，或与某个分支进行比较', builtIn: true, immediate: true },
  { label: '压缩', value: '/compact', description: '精简此任务的上下文', builtIn: true, immediate: true },
  { label: '推理', value: '/reasoning', description: '设置模型推理等级', builtIn: true, immediate: true },
  { label: '模型', value: '/model', description: '选择当前任务使用的模型', builtIn: true, immediate: true },
  { label: '状态', value: '/status', description: '显示任务 ID、上下文用量和速率限制', builtIn: true, immediate: true },
  { label: '目标', value: '/goal', description: '设置要持续追求的目标', builtIn: true, immediate: true },
  { label: '计划模式', value: '/plan', description: '开启计划模式', builtIn: true, immediate: true },
  { label: '记忆', value: '/memories', description: '配置任务记忆', builtIn: true, immediate: true },
];
