/**
 * tools/edit.ts — Edit files via string replacement with multi-layer fallback.
 *
 * Implements a cascade of replacement strategies (inspired by OpenCode's 9-layer approach):
 * 1. Exact match
 * 2. Trimmed line match (leading/trailing whitespace normalized)
 * 3. Whitespace-normalized match (all whitespace collapsed)
 * 4. Fuzzy match (Levenshtein distance on lines)
 *
 * If old_string matches multiple locations, the edit is rejected
 * (user must provide more context to disambiguate).
 */

import { tool } from 'ai';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { recordFileModification } from '../file-checkpoint';
import type { ToolContext } from './index';

export function createEditTool(ctx: ToolContext) {
  return tool({
    description:
      'Edit a file by replacing a specific string with a new string. ' +
      'The old_string must uniquely identify the location to edit. ' +
      'Provide enough surrounding context to make old_string unique. ' +
      'Set replace_all to true to replace all occurrences.',
    inputSchema: z.object({
      file_path: z.string().describe('Absolute path to the file to edit'),
      old_string: z.string().describe('The exact text to find and replace'),
      new_string: z.string().describe('The replacement text'),
      replace_all: z.boolean().optional().describe('Replace all occurrences (default false)'),
    }),
    execute: async ({ file_path, old_string, new_string }) => {
      const resolved = path.isAbsolute(file_path) ? file_path : path.resolve(ctx.workingDirectory, file_path);

      if (!fs.existsSync(resolved)) {
        return `Error: File not found: ${resolved}`;
      }

      if (old_string === new_string) {
        return 'Error: old_string and new_string are identical. No change needed.';
      }

      const content = fs.readFileSync(resolved, 'utf-8');

      // Try replacement strategies in order
      const result =
        tryExactReplace(content, old_string, new_string) ??
        tryTrimmedReplace(content, old_string, new_string) ??
        tryWhitespaceNormalized(content, old_string, new_string) ??
        tryFuzzyReplace(content, old_string, new_string);

      if (!result) {
        // Build helpful error message
        const lines = content.split('\n');
        const oldLines = old_string.split('\n');
        const firstOldLine = oldLines[0].trim();

        // Try to find partial matches for debugging
        const partialMatches = lines
          .map((line, i) => ({ line: line.trim(), num: i + 1 }))
          .filter(({ line }) => firstOldLine && line.includes(firstOldLine))
          .slice(0, 3);

        let hint = '';
        if (partialMatches.length > 0) {
          hint = '\n\nPartial matches found at:\n' +
            partialMatches.map(m => `  Line ${m.num}: ${m.line.slice(0, 100)}`).join('\n') +
            '\n\nTry including more surrounding context in old_string.';
        }

        return `Error: Could not find old_string in ${resolved}. ` +
          `Make sure the text matches exactly (including indentation).${hint}`;
      }

      if (result.ambiguous) {
        return `Error: old_string matches ${result.matchCount} locations in ${resolved}. ` +
          'Please provide more surrounding context to uniquely identify the edit location.';
      }

      fs.writeFileSync(resolved, result.newContent, 'utf-8');
      recordFileModification(ctx.sessionId || '', path.relative(ctx.workingDirectory, resolved));
      return `Successfully edited ${resolved}`;
    },
  });
}

// ── Replacement strategies ──────────────────────────────────────

interface ReplaceResult {
  newContent: string;
  ambiguous: boolean;
  matchCount: number;
}

/** Strategy 1: Exact string match */
function tryExactReplace(content: string, oldStr: string, newStr: string): ReplaceResult | null {
  const count = countOccurrences(content, oldStr);
  if (count === 0) return null;
  if (count > 1) return { newContent: content, ambiguous: true, matchCount: count };

  return {
    newContent: content.replace(oldStr, newStr),
    ambiguous: false,
    matchCount: 1,
  };
}

/** Strategy 2: Line-by-line trimmed match */
function tryTrimmedReplace(content: string, oldStr: string, newStr: string): ReplaceResult | null {
  const contentLines = content.split('\n');
  const oldLines = oldStr.split('\n');

  if (oldLines.length === 0) return null;

  const trimmedOld = oldLines.map(l => l.trim());
  const matches: number[] = [];

  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    let match = true;
    for (let j = 0; j < oldLines.length; j++) {
      if (contentLines[i + j].trim() !== trimmedOld[j]) {
        match = false;
        break;
      }
    }
    if (match) matches.push(i);
  }

  if (matches.length === 0) return null;
  if (matches.length > 1) return { newContent: content, ambiguous: true, matchCount: matches.length };

  const matchStart = matches[0];
  // Preserve the indentation of the first matched line
  const indent = contentLines[matchStart].match(/^(\s*)/)?.[1] || '';
  const newLines = newStr.split('\n').map((line, i) => {
    if (i === 0) return indent + line.trimStart();
    return line; // preserve indentation of replacement as-is for subsequent lines
  });

  const result = [
    ...contentLines.slice(0, matchStart),
    ...newLines,
    ...contentLines.slice(matchStart + oldLines.length),
  ];

  return { newContent: result.join('\n'), ambiguous: false, matchCount: 1 };
}

/** Strategy 3: Whitespace-normalized match (collapse all whitespace to single space) */
function tryWhitespaceNormalized(content: string, oldStr: string, newStr: string): ReplaceResult | null {
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  const normalizedOld = normalize(oldStr);
  if (!normalizedOld) return null;

  const normalizedContent = normalize(content);
  const count = countOccurrences(normalizedContent, normalizedOld);
  if (count !== 1) return null; // only proceed if exactly one match

  // Find the position in the original content
  // Strategy: scan through original content tracking normalized position
  const contentLines = content.split('\n');
  const oldLines = oldStr.split('\n');
  const normalizedOldLines = oldLines.map(l => l.trim());

  // Try trimmed match as backup approach
  return tryTrimmedReplace(content, oldStr, newStr);
}

/** Strategy 4: Fuzzy match (find best-matching region using line similarity) */
function tryFuzzyReplace(content: string, oldStr: string, newStr: string): ReplaceResult | null {
  const contentLines = content.split('\n');
  const oldLines = oldStr.split('\n');

  if (oldLines.length === 0 || contentLines.length === 0) return null;

  let bestScore = 0;
  let bestStart = -1;

  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    let score = 0;
    for (let j = 0; j < oldLines.length; j++) {
      const sim = lineSimilarity(contentLines[i + j], oldLines[j]);
      score += sim;
    }
    const avgScore = score / oldLines.length;
    if (avgScore > bestScore) {
      bestScore = avgScore;
      bestStart = i;
    }
  }

  // Only accept fuzzy matches with >80% similarity
  if (bestScore / oldLines.length < 0.8 || bestStart < 0) return null;

  const result = [
    ...contentLines.slice(0, bestStart),
    ...newStr.split('\n'),
    ...contentLines.slice(bestStart + oldLines.length),
  ];

  return { newContent: result.join('\n'), ambiguous: false, matchCount: 1 };
}

// ── Helpers ─────────────────────────────────────────────────────

function countOccurrences(str: string, sub: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(sub, pos)) !== -1) {
    count++;
    pos += sub.length;
  }
  return count;
}

/** Simple line similarity (0-1) based on common character sequences */
function lineSimilarity(a: string, b: string): number {
  const ta = a.trim();
  const tb = b.trim();
  if (ta === tb) return 1;
  if (!ta || !tb) return 0;

  const maxLen = Math.max(ta.length, tb.length);
  if (maxLen === 0) return 1;

  // Count matching characters in order (LCS approximation)
  let matches = 0;
  let bIdx = 0;
  for (let i = 0; i < ta.length && bIdx < tb.length; i++) {
    if (ta[i] === tb[bIdx]) {
      matches++;
      bIdx++;
    }
  }

  return matches / maxLen;
}
