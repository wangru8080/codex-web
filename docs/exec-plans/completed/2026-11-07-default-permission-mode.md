# Default Permission Mode for New Sessions

Status: Code complete; Tests pass; Smoke passed

Related: [2026-11-07-default-permission-mode.md](../../handover/2026-11-07-default-permission-mode.md)

## Goal

Let users opt in from the Full Access warning to make Full Access the permission
default for future sessions, and let users inspect or change that default from
Settings → General.

## Design Decisions

- The app-server remains the source of truth. Settings reads the current default
  from `config/read` and writes changes through `config/batchWrite`; there is no
  browser-local permission default.
- Each built-in mode writes a complete set of four app-server keys:
  `default_permissions`, `approvals_reviewer`, `approval_policy`, and
  `sandbox_mode`. Writing only one key can leave a mixed mode because the
  app-server reads these settings independently.
- The Full Access warning applies the current thread permission first, then
  saves the default only when “Use this mode for all future sessions” is checked.
  A failed default save keeps the warning open and reports the error without
  reverting the already-applied thread permission.
- A config.toml profile that cannot be represented by a built-in mode is shown
  as a disabled “Custom (config.toml)” value. Selecting a built-in mode replaces
  it deterministically.
- The Settings selector shows the same Full Access risk banner when the current
  default resolves to Full Access.

## Implementation

- `src/codex-web/default-permission-mode.ts` maps `config/read` values to the
  built-in modes and builds complete config edit sets.
- `src/components/chat/MessageInput.tsx` adds the warning checkbox, async
  confirmation, error handling, and config persistence.
- `src/components/settings/GeneralSection.tsx` adds the Default Permissions
  selector and save feedback.
- `src/i18n/en.ts` and `src/i18n/zh.ts` add the English and Chinese copy.
- Unit and wiring tests cover the config edit mapping and UI integration points.

## Verification

Environment for every command below:

```bash
CODEX_HOME=/tmp/codex-web-ui-home
```

The repository's documented `/volume2` test home is not available in this
environment, so a temporary isolated home was used. No real `CODEX_HOME` data was
read or modified.

- `pnpm run test`: 218 test files and 1,100 tests passed.
- `pnpm run build`: production build completed successfully.
- `pnpm run test:smoke`: passed with isolated `CODEX_HOME`, 9 models, and account
  source `app-server.account/read`.
- `git diff --check`: passed.

## Smoke Ledger

| Scope | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| Unit | Permission mode mapping and complete config edits | Tests pass | 3 targeted files passed; full suite passed |
| Build | Production Next.js build | Tests pass | `pnpm run build` completed |
| Bridge smoke | Isolated app-server initialize/model/account path | Smoke passed | `pnpm run test:smoke`, 9 models, `app-server.account/read` |
| Browser positive | Full Access warning checkbox writes config | Smoke passed | Isolated Chromium/CDP; all four Full Access keys appeared in `config.toml` |
| Browser positive | Settings selector reflects and changes the default | Smoke passed | Settings showed “Full access”, then wrote the four request-approval keys |
| Browser negative | New-chat default differs before and after the change | Smoke passed | Initial `/chat` was “Ask for Approval”; after saving Full Access it became “Full access”, and after switching back it returned to “Ask for Approval” |

## Negative Verification

- The initial request-approval state and the restored new-chat state both showed
  “Ask for Approval”; the new-chat selector changed only after the Full Access
  default was saved, then changed back after the settings write.
- The Settings selector did not report Full Access before the alert save; after
  the save it reported “Full access”, proving the value came from the refreshed
  `config/read` state rather than local component state.
- Changing the default writes all four app-server keys, so selecting a built-in
  mode cannot leave `default_permissions`, approval policy, reviewer, and sandbox
  mode pointing at different modes.

## Follow-Ups

- Permanently automate this browser flow if the repository adopts a stable
  Playwright suite for Settings and composer interactions.
