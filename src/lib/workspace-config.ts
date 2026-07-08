import fs from 'fs';
import path from 'path';
import { AssistantWorkspaceConfig } from '@/types';

const CONFIG_FILE = '.assistant/config.json';

export const DEFAULT_CONFIG: AssistantWorkspaceConfig = {
  workspaceType: 'general',
  organizationStyle: 'mixed',
  captureDefault: 'Inbox',
  archivePolicy: {
    completedTaskArchiveAfterDays: 30,
    closedProjectArchive: true,
    dailyMemoryRetentionDays: 30,
  },
  ignore: [
    '.obsidian/**',
    '.trash/**',
    '**/*.png',
    '**/*.jpg',
    '**/*.jpeg',
    '**/*.gif',
    '**/*.mp4',
    'node_modules/**',
    '.git/**',
  ],
  index: {
    maxFileSizeKB: 512,
    chunkSize: 1200,
    chunkOverlap: 150,
    maxDepth: 8,
    includeExtensions: ['.md', '.txt', '.markdown'],
  },
};

function deepMerge<T extends Record<string, unknown>>(defaults: T, overrides: Partial<T>): T {
  const result = { ...defaults };
  for (const key of Object.keys(overrides) as (keyof T)[]) {
    const val = overrides[key];
    if (
      val !== undefined &&
      val !== null &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      typeof defaults[key] === 'object' &&
      !Array.isArray(defaults[key])
    ) {
      result[key] = deepMerge(
        defaults[key] as Record<string, unknown>,
        val as Record<string, unknown>,
      ) as T[keyof T];
    } else if (val !== undefined) {
      result[key] = val as T[keyof T];
    }
  }
  return result;
}

export function loadConfig(dir: string): AssistantWorkspaceConfig {
  const configPath = path.join(dir, CONFIG_FILE);
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AssistantWorkspaceConfig>;
    return deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, parsed as unknown as Record<string, unknown>) as unknown as AssistantWorkspaceConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(dir: string, config: AssistantWorkspaceConfig): void {
  const configPath = path.join(dir, CONFIG_FILE);
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function globToRegex(pattern: string): RegExp {
  let regex = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      // ** matches any path segment(s)
      if (pattern[i + 2] === '/') {
        regex += '(?:.+/)?';
        i += 3;
      } else {
        regex += '.*';
        i += 2;
      }
    } else if (ch === '*') {
      // * matches anything except /
      regex += '[^/]*';
      i++;
    } else if (ch === '?') {
      regex += '[^/]';
      i++;
    } else if (ch === '.') {
      regex += '\\.';
      i++;
    } else {
      regex += ch;
      i++;
    }
  }
  return new RegExp(`^${regex}$`);
}

export function shouldIgnore(filePath: string, config: AssistantWorkspaceConfig): boolean {
  // Normalize to forward slashes for consistent matching
  const normalized = filePath.replace(/\\/g, '/');
  return config.ignore.some((pattern) => {
    const re = globToRegex(pattern);
    return re.test(normalized);
  });
}
