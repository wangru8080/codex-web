/**
 * Keyword-based search over the workspace index.
 * Pure text matching — no vector DB required.
 */

import fs from 'fs';
import path from 'path';
import type { ManifestEntry, ChunkEntry, HotsetFile, SearchResult } from '@/types';
import { loadManifest, loadChunks, INDEX_DIR } from '@/lib/workspace-indexer';

// ---------------------------------------------------------------------------
// Stop words
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'can', 'could', 'of', 'at', 'by', 'for',
  'with', 'about', 'against', 'between', 'through', 'during', 'before',
  'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out',
  'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once',
  'and', 'but', 'or', 'nor', 'not', 'so', 'if', 'this', 'that', 'these',
  'those', 'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
  'he', 'his', 'she', 'her', 'they', 'their', 'what', 'which', 'who', 'whom',
]);

// ---------------------------------------------------------------------------
// CJK detection & bigram tokenization
// ---------------------------------------------------------------------------

const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uf900-\ufaff]/;

function isCJK(ch: string): boolean {
  return CJK_RANGE.test(ch);
}

/** Split a CJK run into overlapping bigrams (+ individual chars as fallback). */
function cjkBigrams(text: string): string[] {
  const chars = [...text];
  const tokens: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    tokens.push(chars[i]); // unigram
    if (i + 1 < chars.length) {
      tokens.push(chars[i] + chars[i + 1]); // bigram
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

export function parseQuery(query: string): string[] {
  const lower = query.toLowerCase();
  const tokens: string[] = [];

  // Split into runs of CJK vs non-CJK
  let buf = '';
  let wasCJK = false;

  for (const ch of lower) {
    const nowCJK = isCJK(ch);
    if (buf.length > 0 && nowCJK !== wasCJK) {
      // flush previous run
      if (wasCJK) {
        tokens.push(...cjkBigrams(buf));
      } else {
        const words = buf.split(/[\s\p{P}]+/u).filter(t => t.length > 0 && !STOP_WORDS.has(t));
        tokens.push(...words);
      }
      buf = '';
    }
    // Skip whitespace/punctuation between runs but keep CJK chars
    if (nowCJK || !/[\s\p{P}]/u.test(ch)) {
      buf += ch;
    } else if (buf.length > 0 && !wasCJK) {
      buf += ch; // let split handle it
    }
    wasCJK = nowCJK;
  }

  // flush remainder
  if (buf.length > 0) {
    if (wasCJK) {
      tokens.push(...cjkBigrams(buf));
    } else {
      const words = buf.split(/[\s\p{P}]+/u).filter(t => t.length > 0 && !STOP_WORDS.has(t));
      tokens.push(...words);
    }
  }

  return [...new Set(tokens)];
}

// ---------------------------------------------------------------------------
// Manifest scoring
// ---------------------------------------------------------------------------

export function scoreManifest(
  entry: ManifestEntry,
  keywords: string[],
): { score: number; source: SearchResult['source'] } {
  let score = 0;
  let bestWeight = 0;
  let source: SearchResult['source'] = 'content';

  const titleLower = entry.title.toLowerCase();
  const pathLower = entry.path.toLowerCase();
  const headingsLower = entry.headings.map(h => h.toLowerCase());
  const tagsLower = entry.tags.map(t => t.toLowerCase());
  const aliasesLower = entry.aliases.map(a => a.toLowerCase());

  for (const kw of keywords) {
    if (titleLower.includes(kw)) {
      score += 10;
      if (10 > bestWeight) { bestWeight = 10; source = 'title'; }
    }
    if (tagsLower.some(t => t.includes(kw))) {
      score += 8;
      if (8 > bestWeight) { bestWeight = 8; source = 'tag'; }
    }
    if (aliasesLower.some(a => a.includes(kw))) {
      score += 7;
    }
    if (headingsLower.some(h => h.includes(kw))) {
      score += 5;
      if (5 > bestWeight && bestWeight < 8) { bestWeight = 5; source = 'heading'; }
    }
    if (pathLower.includes(kw)) {
      score += 3;
    }
  }

  return { score, source };
}

// ---------------------------------------------------------------------------
// Chunk scoring
// ---------------------------------------------------------------------------

export function scoreChunk(chunk: ChunkEntry, keywords: string[]): number {
  let score = 0;
  const textLower = chunk.text.toLowerCase();
  const headingLower = chunk.heading.toLowerCase();

  for (const kw of keywords) {
    // Count occurrences in text
    let idx = 0;
    while ((idx = textLower.indexOf(kw, idx)) !== -1) {
      score += 1;
      idx += kw.length;
    }
    // Heading matches get 2x weight
    idx = 0;
    while ((idx = headingLower.indexOf(kw, idx)) !== -1) {
      score += 2;
      idx += kw.length;
    }
  }

  return score;
}

// ---------------------------------------------------------------------------
// Main search
// ---------------------------------------------------------------------------

export function searchWorkspace(
  dir: string,
  query: string,
  options?: { limit?: number },
): SearchResult[] {
  const limit = options?.limit ?? 5;
  const keywords = parseQuery(query);
  if (keywords.length === 0) return [];

  const manifest = loadManifest(dir);

  // Load hotset for score boosting
  const hotset = loadHotset(dir);
  const pinnedSet = new Set(hotset.pinned);
  const frequentMap = new Map<string, number>();
  for (const f of hotset.frequent) {
    frequentMap.set(f.path, f.count);
  }

  // Score every manifest entry
  const scored = manifest.map(entry => {
    const { score: baseScore, source } = scoreManifest(entry, keywords);
    let score = baseScore;

    // Boost pinned files
    if (pinnedSet.has(entry.path)) {
      score += 5;
    }
    // Boost frequently accessed files (diminishing returns, cap at +4)
    const freq = frequentMap.get(entry.path);
    if (freq) {
      score += Math.min(4, Math.log2(freq + 1));
    }

    return { entry, score, source };
  });

  // Take top 2*limit candidates by manifest score
  scored.sort((a, b) => b.score - a.score);
  const candidates = scored.filter(s => s.score > 0).slice(0, limit * 2);

  if (candidates.length === 0) return [];

  // Load all chunks once, group by noteId
  const allChunks = loadChunks(dir);
  const chunksByNote = new Map<string, ChunkEntry[]>();
  for (const chunk of allChunks) {
    const list = chunksByNote.get(chunk.noteId) || [];
    list.push(chunk);
    chunksByNote.set(chunk.noteId, list);
  }

  // For each candidate, find the best chunk
  const results: SearchResult[] = [];

  for (const candidate of candidates) {
    const chunks = chunksByNote.get(candidate.entry.noteId) || [];
    let bestChunkScore = 0;
    let bestChunk: ChunkEntry | null = null;

    for (const chunk of chunks) {
      const cs = scoreChunk(chunk, keywords);
      if (cs > bestChunkScore) {
        bestChunkScore = cs;
        bestChunk = chunk;
      }
    }

    const totalScore = candidate.score + bestChunkScore;
    const snippet = bestChunk
      ? bestChunk.text.slice(0, 300)
      : candidate.entry.summary.slice(0, 300);
    const heading = bestChunk?.heading ?? candidate.entry.headings[0] ?? '';

    results.push({
      path: candidate.entry.path,
      heading,
      snippet,
      score: totalScore,
      source: bestChunkScore > candidate.score ? 'content' : candidate.source,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Hotset management
// ---------------------------------------------------------------------------

export function loadHotset(dir: string): HotsetFile {
  const hotsetPath = path.join(dir, INDEX_DIR, 'hotset.json');
  try {
    const raw = fs.readFileSync(hotsetPath, 'utf-8');
    return JSON.parse(raw) as HotsetFile;
  } catch {
    return { pinned: [], frequent: [], lastUpdated: Date.now() };
  }
}

export function updateHotset(dir: string, accessedPaths: string[]): void {
  const hotset = loadHotset(dir);
  const now = Date.now();

  for (const p of accessedPaths) {
    const existing = hotset.frequent.find(f => f.path === p);
    if (existing) {
      existing.count += 1;
      existing.lastAccessed = now;
    } else {
      hotset.frequent.push({ path: p, count: 1, lastAccessed: now });
    }
  }

  // Sort by count descending, cap at 20
  hotset.frequent.sort((a, b) => b.count - a.count);
  hotset.frequent = hotset.frequent.slice(0, 20);
  hotset.lastUpdated = now;

  const hotsetPath = path.join(dir, INDEX_DIR, 'hotset.json');
  fs.mkdirSync(path.dirname(hotsetPath), { recursive: true });
  fs.writeFileSync(hotsetPath, JSON.stringify(hotset, null, 2), 'utf-8');
}
