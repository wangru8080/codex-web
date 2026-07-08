/**
 * Minimal semver comparison for the GitHub-release update check
 * (`src/app/api/app/updates/route.ts`).
 *
 * Local on purpose — `semver` is NOT a direct dependency (only present
 * transitively), so the update path must not rely on it. This handles exactly
 * what the check needs:
 *   - numeric MAJOR.MINOR.PATCH precedence
 *   - a STABLE release outranks a same-numeric prerelease:
 *     `0.55.0` > `0.55.0-preview.5`. The previous implementation split on `.`
 *     and `Number()`-coerced the first three segments, so the `-preview.N`
 *     suffix was dropped (and `NaN || 0` collapsed the patch to 0) — making
 *     `0.55.0` compare EQUAL to `0.55.0-preview.5`, so preview testers never saw
 *     the stable v0.55.0 update.
 *   - prerelease vs prerelease by dot-separated identifiers:
 *     `0.55.0-preview.4` < `0.55.0-preview.5`
 *
 * Returns 1 if a > b, -1 if a < b, 0 if equal OR if either version is
 * unparseable — conservative, so a malformed `latest` from GitHub can't trigger
 * a false update prompt. The update check still only reads `/releases/latest`;
 * this does not introduce a prerelease channel.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;

  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;

  // Same MAJOR.MINOR.PATCH — a stable release outranks a prerelease.
  if (pa.prerelease === null && pb.prerelease === null) return 0;
  if (pa.prerelease === null) return 1; // a stable, b prerelease → a > b
  if (pb.prerelease === null) return -1; // a prerelease, b stable → a < b
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** The `-PRERELEASE` suffix without the leading dash, or null for a stable release. */
  prerelease: string | null;
}

function parseVersion(v: unknown): ParsedVersion | null {
  if (typeof v !== "string") return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
  };
}

/**
 * Compare two prerelease strings by dot-separated identifiers (semver-style):
 * numeric identifiers compared numerically, alphanumeric lexically, numeric
 * ranks below alphanumeric, and a shorter set of identifiers ranks lower.
 * Enough to guarantee `preview.4` < `preview.5` < (stable).
 */
function comparePrerelease(a: string, b: string): number {
  const as = a.split(".");
  const bs = b.split(".");
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const ai = as[i];
    const bi = bs[i];
    if (ai === undefined) return -1; // fewer identifiers → lower precedence
    if (bi === undefined) return 1;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      if (ai !== bi) return Number(ai) > Number(bi) ? 1 : -1;
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1; // numeric identifiers rank below alphanumeric
    } else if (ai !== bi) {
      return ai > bi ? 1 : -1;
    }
  }
  return 0;
}
