# Jules automation, GitHub source mapping, and session outputs

Status: Complete

## Goal

Close the remaining documented Jules v1alpha gaps that Codex can support with
real app-server state:

- accept `automationMode: "AUTO_CREATE_PR"` and direct Codex to create a branch
  and pull request after code changes;
- accept `sourceContext.githubRepoContext.startingBranch` and check out the
  requested branch before the thread starts;
- accept GitHub source resource names (`sources/github/{owner}/{repo}`) and map
  them to known local checkout directories;
- expose real commit/PR results as Jules `outputs` and keep RFC3339 timestamps
  and Jules session states consistent.

## Boundaries

- No fabricated PRs, commits, branches, or timestamps.
- PR output is emitted only when a successful command's output contains a real
  GitHub pull request URL.
- Change sets are derived from app-server `fileChange` items and successful git
  history commands, with the initial thread commit used as `baseCommitId`.
- `AUTO_CREATE_PR` is implemented as a real developer instruction to Codex; the
  API does not claim success unless the command evidence exists.
- `startingBranch` is applied with app-server `command/exec` against the mapped
  source checkout. Dirty worktrees and missing branches fail visibly.
- `workingBranch`, source environment variables, and activity time-range filters
  remain unsupported.

## Checklist

- [x] Extend session metadata with automation mode, starting branch, and initial
      git commit.
- [x] Update source model and route parsing for `sources/github/{owner}/{repo}`.
- [x] Apply `startingBranch` through app-server command execution.
- [x] Add `AUTO_CREATE_PR` developer instructions.
- [x] Derive `outputs` from real command/file-change evidence.
- [x] Normalize timestamps and session state mapping.
- [x] Add unit/API tests and update documentation.
- [x] Run typecheck/unit tests/build and record verification.

## Verification

- `pnpm run test`: 223 files and 1127 tests passed with
  `CODEX_HOME=/volume2/SSD/codex/Temp/codex-dev-home`.
- `pnpm run build`: Next.js production build completed and included
  `/v1alpha/[...path]`.
- Targeted API/model/store/broker tests: 23 tests passed.
- Browser smoke was not run because this change is server-side API behavior with
  unit/route coverage and no UI changes.

## Negative Verification

- A dirty source checkout rejects `startingBranch` with `FAILED_PRECONDITION` and
  does not call `thread/start`.
- A failed `gh pr create` command produces no `pullRequest` output.
- A session with no file changes, commits, or PRs produces no `outputs` field.
- A thread with `systemError` and no turns maps to `FAILED`, not `QUEUED`.

## Remaining Risks

- `startingBranch` switches the shared local checkout; concurrent API sessions on
  the same checkout can observe the branch change. A future isolation model could
  use one git worktree per session.
- `AUTO_CREATE_PR` depends on Codex finding `gh`, GitHub credentials, and a
  network-capable sandbox. The API reports only command-observed PR URLs.
