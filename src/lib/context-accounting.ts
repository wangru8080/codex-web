import type {
  ContextAccountingKind,
  RuntimeContextAccountingSnapshot,
} from '@/types';

export function snapshotToCompilerInputs(
  snapshot: RuntimeContextAccountingSnapshot | null | undefined,
): {
  systemPromptTokens?: number;
  toolDescriptorTokens?: number;
  workspaceRuleTokens?: number;
  skillsHarnessTokens?: number;
  mcpDescriptorTokens?: number;
  memoryTokens?: number;
} | undefined {
  if (!snapshot) return undefined;

  const get = (kind: ContextAccountingKind): number | undefined => {
    if (snapshot.unsupported.includes(kind)) return undefined;
    return snapshot.entries[kind]?.tokens;
  };
  const result = {
    systemPromptTokens: get('system_prompt'),
    toolDescriptorTokens: get('tools'),
    workspaceRuleTokens: get('rules'),
    skillsHarnessTokens: get('skills'),
    mcpDescriptorTokens: get('mcp'),
    memoryTokens: get('memory'),
  };

  return Object.values(result).every((value) => value === undefined)
    ? undefined
    : result;
}
