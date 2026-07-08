import fs from 'fs';
import path from 'path';
import type { TaxonomyCategory, TaxonomyFile } from '@/types';
import { loadConfig } from '@/lib/workspace-config';
import { loadTaxonomy, saveTaxonomy, classifyPath } from '@/lib/workspace-taxonomy';
import { loadManifest } from '@/lib/workspace-indexer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Assert that `target` resolves to a path inside `workspaceDir`.
 * Rejects absolute paths, `../` traversals, and symlink escapes.
 */
export function assertContained(workspaceDir: string, relativePath: string): string {
  // Reject absolute paths and obvious traversal attempts early
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Absolute paths are not allowed: ${relativePath}`);
  }
  if (relativePath.startsWith('~')) {
    throw new Error(`Home-relative paths are not allowed: ${relativePath}`);
  }

  const resolved = path.resolve(workspaceDir, relativePath);
  const normalizedWorkspace = path.resolve(workspaceDir);

  // Must start with workspace dir + separator (or equal it)
  if (resolved !== normalizedWorkspace && !resolved.startsWith(normalizedWorkspace + path.sep)) {
    throw new Error(`Path escapes workspace boundary: ${relativePath}`);
  }

  // If the resolved path exists, check it's not a symlink pointing outside
  try {
    const real = fs.realpathSync(resolved);
    if (real !== normalizedWorkspace && !real.startsWith(normalizedWorkspace + path.sep)) {
      throw new Error(`Symlink target escapes workspace boundary: ${relativePath}`);
    }
  } catch (e) {
    // File doesn't exist yet — that's fine for targets being created
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }

  return resolved;
}

function sanitizeFilename(title: string): string {
  return title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function parseDateFromFilename(filename: string): Date | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
  if (!match) return null;
  const d = new Date(match[1] + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 86_400_000;
  return Math.floor(Math.abs(a.getTime() - b.getTime()) / msPerDay);
}

// ---------------------------------------------------------------------------
// 1. Capture
// ---------------------------------------------------------------------------

export function captureNote(dir: string, title: string, content: string): string {
  const config = loadConfig(dir);
  const captureDir = config.captureDefault || 'Inbox';

  // Validate captureDefault is a safe relative path within workspace
  const filename = sanitizeFilename(title) + '.md';
  const relativePath = path.join(captureDir, filename);
  const absTarget = assertContained(dir, relativePath);

  ensureDir(path.dirname(absTarget));
  fs.writeFileSync(absTarget, content, 'utf-8');
  return absTarget;
}

// ---------------------------------------------------------------------------
// 2. Classify & Suggest
// ---------------------------------------------------------------------------

export function classifyAndSuggest(
  dir: string,
  filePath: string,
): { suggestedCategory: TaxonomyCategory | null; confidence: number; suggestedPath: string } {
  const taxonomy = loadTaxonomy(dir);
  const category = classifyPath(filePath, taxonomy);

  if (category) {
    const primaryPath = category.paths[0] || 'Inbox/';
    const basename = path.basename(filePath);
    return {
      suggestedCategory: category,
      confidence: category.confidence,
      suggestedPath: path.join(primaryPath, basename),
    };
  }

  // No good match — suggest Inbox
  const basename = path.basename(filePath);
  return {
    suggestedCategory: null,
    confidence: 0,
    suggestedPath: path.join('Inbox', basename),
  };
}

// ---------------------------------------------------------------------------
// 3. Move File
// ---------------------------------------------------------------------------

export function moveFile(dir: string, fromPath: string, toPath: string): void {
  const absFrom = assertContained(dir, fromPath);
  const absTo = assertContained(dir, toPath);
  ensureDir(path.dirname(absTo));
  fs.renameSync(absFrom, absTo);
}

// ---------------------------------------------------------------------------
// 4. Archive Daily Memories
// ---------------------------------------------------------------------------

export function archiveDailyMemories(
  dir: string,
): { archived: number; retained: number } {
  const config = loadConfig(dir);
  const retentionDays = config.archivePolicy.dailyMemoryRetentionDays;
  const dailyDir = path.join(dir, 'memory', 'daily');

  if (!fs.existsSync(dailyDir)) {
    return { archived: 0, retained: 0 };
  }

  const now = new Date();
  let archived = 0;
  let retained = 0;

  const entries = fs.readdirSync(dailyDir);
  const archivePath = path.join(dailyDir, 'archive.md');

  for (const entry of entries) {
    if (entry === 'archive.md') continue;
    const fileDate = parseDateFromFilename(entry);
    if (!fileDate) {
      retained++;
      continue;
    }

    if (daysBetween(now, fileDate) > retentionDays) {
      // Read content and build summary line
      const fullPath = path.join(dailyDir, entry);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const firstLine = content.split('\n').find((l) => l.trim().length > 0) || entry;
      const summaryLine = `- **${entry}**: ${firstLine.replace(/^#+\s*/, '').trim()}\n`;

      // Append to archive
      fs.appendFileSync(archivePath, summaryLine, 'utf-8');
      fs.unlinkSync(fullPath);
      archived++;
    } else {
      retained++;
    }
  }

  return { archived, retained };
}

// ---------------------------------------------------------------------------
// 5. Promote Daily to Long-Term
// ---------------------------------------------------------------------------

export function promoteDailyToLongTerm(dir: string, date: string): boolean {
  const dailyFile = path.join(dir, 'memory', 'daily', `${date}.md`);
  if (!fs.existsSync(dailyFile)) return false;

  const content = fs.readFileSync(dailyFile, 'utf-8');

  // Skip if already promoted (idempotency marker)
  if (content.includes('<!-- promoted -->')) return false;

  // Look for promotion-worthy sections
  const sectionPattern = /^##\s+(Candidate Long-Term Memory|To Remember)\s*$/im;
  const match = content.match(sectionPattern);
  if (!match) return false;

  // Extract content from the matched section until the next ## heading or EOF
  const sectionStart = match.index! + match[0].length;
  const rest = content.slice(sectionStart);
  const nextHeading = rest.search(/^##\s+/m);
  const sectionContent =
    nextHeading >= 0 ? rest.slice(0, nextHeading).trim() : rest.trim();

  // Only promote if non-trivial
  if (sectionContent.length <= 50) return false;

  // Check for duplicates in memory.md
  const memoryFile = path.join(dir, 'memory.md');
  let existingMemory = '';
  try { existingMemory = fs.readFileSync(memoryFile, 'utf-8'); } catch { /* new file */ }

  if (existingMemory.includes(`## Promoted from ${date}`)) return false;

  const promotionBlock = `\n\n## Promoted from ${date}\n\n${sectionContent}\n`;
  fs.appendFileSync(memoryFile, promotionBlock, 'utf-8');

  // Mark daily file as promoted so it won't be promoted again
  fs.appendFileSync(dailyFile, '\n<!-- promoted -->\n', 'utf-8');
  return true;
}

// ---------------------------------------------------------------------------
// 6. Suggest Taxonomy Evolution
// ---------------------------------------------------------------------------

export function suggestTaxonomyEvolution(
  dir: string,
): Array<{ type: 'new_category' | 'merge' | 'archive_category'; description: string; confidence: number }> {
  const taxonomy = loadTaxonomy(dir);
  const manifest = loadManifest(dir);
  const suggestions: Array<{
    type: 'new_category' | 'merge' | 'archive_category';
    description: string;
    confidence: number;
  }> = [];

  // Count files per category
  const categoryFileCounts = new Map<string, number>();
  for (const cat of taxonomy.categories) {
    categoryFileCounts.set(cat.id, 0);
  }

  const uncategorized: string[] = [];

  for (const entry of manifest) {
    const category = classifyPath(entry.path, taxonomy);
    if (category) {
      categoryFileCounts.set(
        category.id,
        (categoryFileCounts.get(category.id) || 0) + 1,
      );
    } else {
      uncategorized.push(entry.path);
    }
  }

  // Files without a good category → suggest new category
  if (uncategorized.length > 0) {
    // Group by top-level directory
    const dirGroups = new Map<string, number>();
    for (const p of uncategorized) {
      const topDir = p.split('/')[0] || p;
      dirGroups.set(topDir, (dirGroups.get(topDir) || 0) + 1);
    }
    for (const [dirName, count] of dirGroups) {
      if (count >= 2) {
        suggestions.push({
          type: 'new_category',
          description: `Create category for "${dirName}" (${count} uncategorized files)`,
          confidence: Math.min(0.9, 0.4 + count * 0.1),
        });
      }
    }
  }

  // Categories with 0 files → suggest archive
  for (const [catId, count] of categoryFileCounts) {
    if (count === 0) {
      const cat = taxonomy.categories.find((c) => c.id === catId);
      suggestions.push({
        type: 'archive_category',
        description: `Archive empty category "${cat?.label || catId}" (0 files)`,
        confidence: 0.7,
      });
    }
  }

  // Sort by confidence descending
  suggestions.sort((a, b) => b.confidence - a.confidence);
  return suggestions;
}
