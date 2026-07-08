import fs from 'fs';
import path from 'path';
import type { TaxonomyCategory, TaxonomyFile } from '@/types';

const TAXONOMY_FILENAME = 'taxonomy.json';
const ASSISTANT_DIR = '.assistant';

export const DEFAULT_TAXONOMY: TaxonomyFile = {
  version: 1,
  categories: [],
  evolutionRules: {
    allowAutoCreateCategory: false,
    allowAutoArchive: false,
    requireConfirmationForMoves: true,
  },
};

function getTaxonomyPath(dir: string): string {
  return path.join(dir, ASSISTANT_DIR, TAXONOMY_FILENAME);
}

export function loadTaxonomy(dir: string): TaxonomyFile {
  const filePath = getTaxonomyPath(dir);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as TaxonomyFile;
  } catch {
    return { ...DEFAULT_TAXONOMY, categories: [] };
  }
}

export function saveTaxonomy(dir: string, taxonomy: TaxonomyFile): void {
  const filePath = getTaxonomyPath(dir);
  const assistantDir = path.join(dir, ASSISTANT_DIR);
  if (!fs.existsSync(assistantDir)) {
    fs.mkdirSync(assistantDir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(taxonomy, null, 2), 'utf-8');
}

const ROLE_MAP: Record<string, string> = {
  notes: 'notes',
  note: 'notes',
  projects: 'project',
  project: 'project',
  journal: 'journal',
  diary: 'journal',
  daily: 'journal',
  archive: 'archive',
  archives: 'archive',
  inbox: 'inbox',
  templates: 'template',
  template: 'template',
  resources: 'resource',
  assets: 'resource',
  attachments: 'resource',
  memory: 'memory',
};

// Names that are an exact canonical form get higher confidence
const EXACT_NAMES = new Set([
  'notes',
  'projects',
  'journal',
  'archive',
  'archives',
  'inbox',
  'templates',
  'resources',
  'assets',
  'attachments',
  'memory',
  'daily',
  'diary',
]);

function inferRole(dirName: string): { role: string; confidence: number } {
  const lower = dirName.toLowerCase();
  const role = ROLE_MAP[lower];
  if (role) {
    const confidence = EXACT_NAMES.has(lower) ? 0.9 : 0.6;
    return { role, confidence };
  }
  return { role: 'unknown', confidence: 0.3 };
}

export function inferTaxonomyFromDirs(dir: string): TaxonomyCategory[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const categories: TaxonomyCategory[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const { role, confidence } = inferRole(entry.name);
    categories.push({
      id: entry.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      label: entry.name,
      paths: [entry.name + '/'],
      role,
      confidence,
      source: 'learned',
      description: role !== 'unknown'
        ? `Auto-detected ${role} directory`
        : `Unknown directory: ${entry.name}`,
      createdBy: 'system',
    });
  }

  return categories;
}

export function classifyPath(
  filePath: string,
  taxonomy: TaxonomyFile,
): TaxonomyCategory | null {
  const normalized = filePath.replace(/\\/g, '/');
  let bestMatch: TaxonomyCategory | null = null;
  let bestLength = 0;

  for (const category of taxonomy.categories) {
    for (const catPath of category.paths) {
      const normalizedCatPath = catPath.replace(/\\/g, '/');
      if (
        normalized.startsWith(normalizedCatPath) ||
        normalized.startsWith('/' + normalizedCatPath)
      ) {
        if (normalizedCatPath.length > bestLength) {
          bestLength = normalizedCatPath.length;
          bestMatch = category;
        }
      }
    }
  }

  return bestMatch;
}

export function suggestNewCategory(dirName: string): TaxonomyCategory {
  const { role, confidence } = inferRole(dirName);
  return {
    id: dirName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    label: dirName,
    paths: [dirName + '/'],
    role,
    confidence,
    source: 'learned',
    description: role !== 'unknown'
      ? `Suggested ${role} category for "${dirName}"`
      : `New category for "${dirName}"`,
    createdBy: 'system',
  };
}
