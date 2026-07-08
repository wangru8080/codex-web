import fs from 'fs';
import os from 'os';

export type WorkingDirectorySource =
  | 'requested'
  | 'binding'
  | 'session_sdk_cwd'
  | 'session_working_directory'
  | 'setting'
  | 'home'
  | 'process';

export interface WorkingDirectoryCandidate {
  path?: string | null;
  source: Exclude<WorkingDirectorySource, 'home' | 'process'>;
}

export interface ResolvedWorkingDirectory {
  path: string;
  source: WorkingDirectorySource;
  invalidCandidates: Array<{
    source: WorkingDirectoryCandidate['source'];
    path: string;
  }>;
}

export function isExistingDirectory(pathValue?: string | null): pathValue is string {
  if (typeof pathValue !== 'string') return false;
  const trimmed = pathValue.trim();
  if (!trimmed) return false;

  try {
    return fs.statSync(trimmed).isDirectory();
  } catch {
    return false;
  }
}

export function resolveWorkingDirectory(
  candidates: WorkingDirectoryCandidate[],
): ResolvedWorkingDirectory {
  const invalidCandidates: ResolvedWorkingDirectory['invalidCandidates'] = [];

  for (const candidate of candidates) {
    const value = typeof candidate.path === 'string' ? candidate.path.trim() : '';
    if (!value) continue;

    if (isExistingDirectory(value)) {
      return {
        path: value,
        source: candidate.source,
        invalidCandidates,
      };
    }

    invalidCandidates.push({ source: candidate.source, path: value });
  }

  const homeDir = os.homedir();
  if (isExistingDirectory(homeDir)) {
    return {
      path: homeDir,
      source: 'home',
      invalidCandidates,
    };
  }

  return {
    path: process.cwd(),
    source: 'process',
    invalidCandidates,
  };
}
