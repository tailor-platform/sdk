# E2E Suites

## `example/e2e`

This suite asserts against the deployed state of `example/`. The selected workspace must contain
the current `example/tailor.config.ts` output as application `my-app`.

### Preflight

Confirm the saved workspace still hosts `my-app`:

```sh
pnpm exec tailor-sdk workspace app list --workspace-id "$TAILOR_PLATFORM_WORKSPACE_ID"
```

If the workspace is absent or no longer hosts the application:

1. Verify login with `pnpm exec tailor-sdk workspace list`.
2. Resolve the organization and folder only when their saved IDs are unavailable:
   ```sh
   pnpm exec tailor-sdk organization list
   pnpm exec tailor-sdk organization folder list --organization-id <organization-id>
   ```
3. Ask before creating a long-lived workspace. Use `example-e2e` unless it collides:
   ```sh
   pnpm exec tailor-sdk workspace create --name example-e2e --region asia-northeast \
     --organization-id <organization-id> --folder-id <folder-id>
   ```
4. Save its ID to `ids.local.env`, deploy, and confirm `my-app`:
   ```sh
   TAILOR_PLATFORM_WORKSPACE_ID=<workspace-id> pnpm --filter example run deploy
   pnpm exec tailor-sdk workspace app list --workspace-id <workspace-id>
   ```

Use `run deploy`; pnpm's built-in `deploy` shadows the package script when `run` is omitted.

### Run and Repair Drift

```sh
TAILOR_PLATFORM_WORKSPACE_ID="$TAILOR_PLATFORM_WORKSPACE_ID" pnpm --filter example test:e2e
```

Resolver/workflow count mismatches or missing GraphQL fields usually mean the deployed app is stale.
Redeploy with the same workspace ID, then rerun the same test command.

## `packages/sdk/e2e`

This suite creates workspaces, deploys into them, and must delete them after every local run. It
uses `TAILOR_PLATFORM_ORGANIZATION_ID` and `TAILOR_PLATFORM_FOLDER_ID`; it does not reuse
`TAILOR_PLATFORM_WORKSPACE_ID`.

### Run with Existing Login

```sh
.agents/skills/e2e-test/scripts/run-sdk-e2e.sh
```

### Run with Isolated Machine-User Login

Follow [AUTH.md](AUTH.md), using this target command:

```sh
.agents/skills/e2e-test/scripts/run-sdk-e2e.sh
```

The runner assigns a unique run ID and temporary tracking directory, then executes
`pnpm run test -- --project e2e` in `packages/sdk`. It previews and deletes only workspaces
containing that run ID and verifies with a second dry run that no match remains, including after
test failure or interruption. It then independently parses a raw JSON workspace listing and fails
if any workspace name still contains the run ID; the isolated-auth flow uses the trusted CLI for
this second check. A cleanup failure makes the run fail and prints the test status separately;
inspect both before any manual deletion.

To sweep older unscoped leftovers, run the cleanup script with `--dry-run`, inspect every listed
workspace, and only then run it without `--dry-run`. Never automate an unscoped sweep.
