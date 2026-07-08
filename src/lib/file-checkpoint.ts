/**
 * file-checkpoint.ts — File state checkpointing for native rewind.
 *
 * Before writing/editing files, captures a snapshot of the original file content.
 * On rewind, restores files to their pre-modification state using the snapshot,
 * preserving any uncommitted changes that existed before the session started.
 *
 * Key safety invariant: restoreCheckpoint NEVER uses `git checkout HEAD` because
 * that would destroy pre-session uncommitted changes. Instead it restores from
 * the in-memory snapshot captured before the first modification.
 */

import fs from 'fs';
import path from 'path';

interface FileSnapshot {
  /** File content before modification (null = file didn't exist, should be deleted on restore) */
  content: string | null;
}

interface Checkpoint {
  /** Message ID this checkpoint corresponds to */
  messageId: string;
  /** Session ID */
  sessionId: string;
  /** Files modified after this checkpoint (relative paths) */
  modifiedFiles: string[];
  /** Pre-modification snapshots keyed by relative file path */
  snapshots: Map<string, FileSnapshot>;
  /** Timestamp */
  createdAt: number;
}

// Per-session checkpoint stack (most recent last)
const checkpoints = new Map<string, Checkpoint[]>();

/**
 * Create a checkpoint before a file-modifying operation.
 * Call this at the start of each user turn (before tools run).
 */
export function createCheckpoint(sessionId: string, messageId: string, _cwd: string): void {
  const stack = checkpoints.get(sessionId) || [];

  // Only one checkpoint per message (dedup)
  if (stack.length > 0 && stack[stack.length - 1].messageId === messageId) {
    return;
  }

  const checkpoint: Checkpoint = {
    messageId,
    sessionId,
    modifiedFiles: [],
    snapshots: new Map(),
    createdAt: Date.now(),
  };

  stack.push(checkpoint);
  // Keep max 20 checkpoints per session
  if (stack.length > 20) stack.shift();
  checkpoints.set(sessionId, stack);
}

/**
 * Record that a file is about to be modified.
 * Captures a snapshot of the file's current content BEFORE the modification.
 * Must be called BEFORE the actual write/edit happens.
 */
export function recordFileModification(sessionId: string, filePath: string, cwd?: string): void {
  const stack = checkpoints.get(sessionId);
  if (!stack || stack.length === 0) return;
  const latest = stack[stack.length - 1];

  // Track the file path
  if (!latest.modifiedFiles.includes(filePath)) {
    latest.modifiedFiles.push(filePath);
  }

  // Capture snapshot only once per file per checkpoint
  if (!latest.snapshots.has(filePath)) {
    const absPath = cwd ? path.resolve(cwd, filePath) : path.resolve(filePath);
    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      latest.snapshots.set(filePath, { content });
    } catch {
      // File doesn't exist yet (new file) — snapshot as null
      latest.snapshots.set(filePath, { content: null });
    }
  }
}

/**
 * Restore files to the state at a given message checkpoint.
 * Uses the captured snapshots to restore file contents safely,
 * preserving any pre-session uncommitted changes.
 *
 * Returns list of files that were restored.
 */
export function restoreCheckpoint(sessionId: string, messageId: string, cwd: string): string[] {
  const stack = checkpoints.get(sessionId);
  if (!stack) return [];

  // Find the checkpoint for this message
  const idx = stack.findIndex(cp => cp.messageId === messageId);
  if (idx < 0) return [];

  // Collect all files and snapshots from the target checkpoint onward
  const filesToRestore = new Set<string>();
  // Build a map of earliest snapshot per file (the state we want to restore to)
  const restoreSnapshots = new Map<string, FileSnapshot>();

  for (let i = idx; i < stack.length; i++) {
    for (const file of stack[i].modifiedFiles) {
      filesToRestore.add(file);
    }
    // Only use the FIRST (earliest) snapshot for each file
    for (const [file, snapshot] of stack[i].snapshots) {
      if (!restoreSnapshots.has(file)) {
        restoreSnapshots.set(file, snapshot);
      }
    }
  }

  const restored: string[] = [];

  for (const file of filesToRestore) {
    const snapshot = restoreSnapshots.get(file);
    const absPath = path.resolve(cwd, file);

    try {
      if (snapshot && snapshot.content !== null) {
        // Restore to original content
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, snapshot.content, 'utf-8');
        restored.push(file);
      } else if (snapshot && snapshot.content === null) {
        // File was new (didn't exist before) — delete it
        try { fs.unlinkSync(absPath); } catch { /* already gone */ }
        restored.push(file);
      }
      // If no snapshot exists, we can't safely restore — skip
    } catch {
      // Restore failed for this file — continue with others
    }
  }

  // Remove checkpoints after the restored point
  stack.splice(idx + 1);
  checkpoints.set(sessionId, stack);

  return restored;
}

/**
 * Clear all checkpoints for a session.
 */
export function clearCheckpoints(sessionId: string): void {
  checkpoints.delete(sessionId);
}
