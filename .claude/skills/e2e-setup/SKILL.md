---
name: e2e-setup
description: >
  Set up the environment and run e2e tests in this repo (`example/e2e` and `packages/sdk/e2e`).
  Covers tailor-sdk authentication, workspace selection, and re-deploying `example/` when
  the deployed app drifts from the current code. Use when running e2e tests locally, fixing
  e2e failures, or when a run errors with "Failed to refresh token", "Workspace ID not found",
  or mismatched counts/fields in resolver/workflow assertions.
metadata:
  internal: true
---

# E2E Test Setup

Two e2e suites live in this repo, with different prerequisites:

| Suite              | Workspace lifecycle                       | Pre-deploy needed                                   | Run in CI?          |
| ------------------ | ----------------------------------------- | --------------------------------------------------- | ------------------- |
| `example/e2e`      | Long-lived, with `example/` deployed      | Yes — must match current `example/tailor.config.ts` | No                  |
| `packages/sdk/e2e` | Created fresh per run, deleted on cleanup | No (the test deploys itself)                        | Yes (`sdk-e2e.yml`) |

**Which suite to run.** If the user names a suite or points at a failing path under `example/e2e/**` or `packages/sdk/e2e/**`, run that one. If the request is open-ended ("run the e2e tests"), ask the user which suite they want — do not guess; "both" is a valid answer and the suites are independent.

## Stored IDs (`ids.local.env`)

Three IDs drive both suites:

- `TAILOR_PLATFORM_WORKSPACE_ID` — for `example/e2e`
- `TAILOR_PLATFORM_ORGANIZATION_ID` — for `packages/sdk/e2e`
- `TAILOR_PLATFORM_FOLDER_ID` — for `packages/sdk/e2e`

This skill ships with a gitignored `ids.local.env` (sibling of this file) holding all three. **Read it first** and use the values directly — do not invoke `workspace list` / `organization list` / `folder list` to rediscover IDs that are already on disk.

Format:

```
TAILOR_PLATFORM_WORKSPACE_ID=<uuid>
TAILOR_PLATFORM_ORGANIZATION_ID=<uuid>
TAILOR_PLATFORM_FOLDER_ID=<uuid>
```

Source it once and reuse:

```
set -a; source .claude/skills/e2e-setup/ids.local.env; set +a
```

**Fallback.** If the file is missing, or a needed value is empty, run the discovery flow in [`example/e2e` → One-time setup](#one-time-setup) and then write the resolved IDs back to `ids.local.env` so future runs skip the discovery. Ask the user before creating new workspaces.

**Sanity check on `TAILOR_PLATFORM_WORKSPACE_ID`.** Before running `example/e2e`, confirm the workspace still has `my-app` deployed:

```
pnpm exec tailor-sdk workspace app list --workspace-id "$TAILOR_PLATFORM_WORKSPACE_ID"
```

If it is gone, re-deploy per [Pre-deploy](#one-time-setup) step 4.

## `example/e2e`

The tests assert against the **deployed** state of `example/` (resolver count, workflow count, GraphQL schema, etc.), so the chosen workspace must hold the current `example/tailor.config.ts` output. The app name is `my-app`.

### One-time setup

Only needed when `ids.local.env` has no `TAILOR_PLATFORM_WORKSPACE_ID` yet, or the saved workspace was deleted / no longer hosts `my-app`. Write the resolved workspace ID back to `ids.local.env` when finished.

1. Make sure you are logged in. `tailor-sdk login` opens a browser — **only the user can run it**; the agent must ask. Verify with `pnpm exec tailor-sdk workspace list` (errors with `Tailor Platform token not found.` if unauthenticated).
2. Look up the organization and folder you want the workspace to live under. The `workspace create` flags below need both IDs:
   ```
   pnpm exec tailor-sdk organization list
   pnpm exec tailor-sdk organization folder list --organization-id <org>
   # Optional: drill into a sub-folder
   pnpm exec tailor-sdk organization folder list --organization-id <org> --parent-folder-id <folder>
   ```
3. Pick or create a personal workspace. Suggested name: `example-e2e` (descriptive of purpose; fall back to a personal prefix only if it collides under the same folder). The agent must not invent a name — use the suggestion or ask the user:
   ```
   pnpm exec tailor-sdk workspace list
   pnpm exec tailor-sdk workspace create --name example-e2e --region asia-northeast --organization-id <org> --folder-id <folder>
   ```
4. Deploy `example/` into it once:
   ```
   TAILOR_PLATFORM_WORKSPACE_ID=<id> pnpm --filter example run deploy
   ```
   Use `run deploy`, not bare `deploy` — pnpm has a builtin `deploy` command that shadows the package script when invoked via `--filter`.
5. Confirm `my-app` is present:
   ```
   pnpm exec tailor-sdk workspace app list --workspace-id <id>
   ```

Optionally save the workspace as a profile (`~/.config/tailor-platform/config.yaml`) so `TAILOR_PLATFORM_PROFILE=<name>` alone is enough.

### Running

```
TAILOR_PLATFORM_WORKSPACE_ID=<id> pnpm --filter example test:e2e
```

### When tests fail with count/field mismatches

Errors like `expected 8 to be 7` (resolver/workflow counts) or `field: <name> not defined on type: <T>` mean the deployed app is stale relative to `example/`. Re-deploy and re-run:

```
TAILOR_PLATFORM_WORKSPACE_ID=<id> pnpm --filter example run deploy
TAILOR_PLATFORM_WORKSPACE_ID=<id> pnpm --filter example test:e2e
```

## `packages/sdk/e2e`

Each test creates its own workspace, deploys into it, asserts, and the workspace is removed by `scripts/cleanup-e2e-workspaces.ts`. Required env (already in `ids.local.env`):

- `TAILOR_PLATFORM_ORGANIZATION_ID`
- `TAILOR_PLATFORM_FOLDER_ID`

Run with:

```
cd packages/sdk && pnpm exec turbo run test -- --project e2e
```

`TAILOR_PLATFORM_WORKSPACE_ID` is **not** read here — do not set it expecting reuse.

### After running: always sweep leftover workspaces

The `globalSetup.ts` teardown that deletes created workspaces is gated on `process.env.TAILOR_PLATFORM_TOKEN`. When running locally with keyring/config credentials (no env token), teardown is skipped and `e2e-ws-*` / `sdk-ci-*` / `template-e2e-*` workspaces accumulate. Run the cleanup script after every local run (not optional — they incur cost and quota):

```
cd packages/sdk
pnpm exec tsx scripts/cleanup-e2e-workspaces.ts --dry-run   # always preview first
pnpm exec tsx scripts/cleanup-e2e-workspaces.ts             # delete after confirming the list
```

The script uses `loadAccessToken()` so it works with keyring/config credentials too. It only touches workspaces matching the e2e prefixes above; the dry-run output is the audit trail — read it before deleting.

## Auth & env troubleshooting

| Error                                                                                                      | Cause                                                                    | Fix                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `Failed to refresh token. Your session may have expired.`                                                  | The refresh token in `~/.config/tailor-platform/config.yaml` is expired. | `pnpm exec tailor-sdk login` (interactive; only the user can run this — the agent should ask).                                    |
| `Workspace ID not found.`                                                                                  | No `--workspace-id`, no `TAILOR_PLATFORM_WORKSPACE_ID`, no profile set.  | Set `TAILOR_PLATFORM_WORKSPACE_ID` or `TAILOR_PLATFORM_PROFILE`.                                                                  |
| `Application my-app does not have an auth configuration.` / `Machine user manager-machine-user not found.` | Wrong workspace selected, or `example/` was never deployed there.        | Confirm with `tailor-sdk workspace app list`; deploy if missing.                                                                  |
| `TAILOR_PLATFORM_ORGANIZATION_ID` / `..._FOLDER_ID` unset (in `packages/sdk/e2e`)                          | The suite needs these to create workspaces.                              | `source .claude/skills/e2e-setup/ids.local.env` (or follow the fallback in [Stored IDs](#stored-ids-idslocalenv) to populate it). |

## When the user reports an e2e failure

Run the failing command first and capture the real error before exploring code — most e2e failures are environmental (expired token, wrong workspace, stale deploy), not code bugs.
