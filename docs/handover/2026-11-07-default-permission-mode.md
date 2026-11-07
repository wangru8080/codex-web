# Handover: Default Permission Mode

Date: 2026-11-07
Execution Plan: [2026-11-07-default-permission-mode.md](../exec-plans/completed/2026-11-07-default-permission-mode.md)

## Summary

New sessions can now default to Full Access after the user checks “Use this mode
for all future sessions” in the Full Access warning. Settings → General exposes
the same default as a selector backed by the app-server configuration.

## Data Flow

```text
Settings / Full Access warning
  | config/batchWrite (four permission keys)
  v
codex app-server
  | config/read
  v
Default Permissions selector + new-chat permission default
```

The browser never stores a permission default in local storage or a database.
The only source is the effective app-server config, with breadcrumb
`app-server.config/read`.

## Config Mapping

| UI mode | `default_permissions` | `approvals_reviewer` | `approval_policy` | `sandbox_mode` |
| --- | --- | --- | --- | --- |
| Ask for approval | `:workspace` | `user` | `on-request` | `workspace-write` |
| Auto approval | `:workspace` | `auto_review` | `on-request` | `workspace-write` |
| Full access | `:danger-full-access` | `user` | `never` | `danger-full-access` |

All four keys are written together because app-server resolves them independently.
A custom `default_permissions` value is displayed as a disabled
“Custom (config.toml)” option and is replaced when a built-in mode is selected.

## Full Access Warning Behavior

- The warning opens only when switching a composer into Full Access.
- Confirmation applies the thread/composer permission first.
- If the future-sessions checkbox is enabled, the confirmation then calls
  `config/batchWrite`.
- A config save failure keeps the warning visible and shows a specific error; the
  already-applied thread permission is not rolled back.
- Canceling the warning clears the pending choice and checkbox state.

## Files

- `src/codex-web/default-permission-mode.ts`
- `src/components/chat/MessageInput.tsx`
- `src/components/settings/GeneralSection.tsx`
- `src/i18n/en.ts`, `src/i18n/zh.ts`
- `src/codex-web/tests/default-permission-mode.test.ts`
- `src/codex-web/tests/default-permission-settings-wiring.test.ts`

## Operational Notes

- Verification used the isolated `CODEX_HOME=/tmp/codex-web-ui-home` and
  `CODEX_WEB_STATE=/tmp/codex-web-ui-state`; no real account or session data was
  used.
- The temporary browser verification script and screenshots were removed after
  the walkthrough.
- Settings writes use the existing config runtime refresh path. Permission-only
  edits intentionally do not trigger MCP, plugin, or skill reloads.
