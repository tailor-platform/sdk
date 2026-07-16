# E2E Suites

## `example/e2e`

This suite asserts against the deployed state of `example/`. The selected workspace must contain
the current `example/tailor.config.ts` output as application `my-app`.

### Preflight

Confirm the saved workspace still hosts `my-app`:

```sh
/bin/bash .agents/skills/e2e-test/scripts/with-e2e-ids.sh \
  .agents/skills/e2e-test/ids.local.env -- \
  pnpm exec tailor-sdk workspace app list
```

Treat a reused workspace as shared until its users and ownership are known. List its Platform users
before any redeploy:

```sh
/bin/bash .agents/skills/e2e-test/scripts/with-e2e-ids.sh \
  .agents/skills/e2e-test/ids.local.env -- \
  pnpm exec tailor-sdk workspace user list
```

If another person or automation may rely on the workspace, confirm ownership and intended use with
the user. Do not repair drift in a shared workspace by assumption.

If a valid platform profile already selects the workspace, the stored workspace ID is optional.
Use the same profile for both preflight checks:

```sh
TAILOR_PLATFORM_PROFILE=<profile> pnpm exec tailor-sdk workspace app list
TAILOR_PLATFORM_PROFILE=<profile> pnpm exec tailor-sdk workspace user list
```

If the workspace is absent or no longer hosts the application:

1. Verify login with `pnpm exec tailor-sdk workspace list`.
2. Resolve the organization and folder only when their saved IDs are unavailable:
   ```sh
   pnpm exec tailor-sdk organization list
   pnpm exec tailor-sdk organization folder list --organization-id <organization-id>
   # Optional: drill into a sub-folder.
   pnpm exec tailor-sdk organization folder list --organization-id <organization-id> \
     --parent-folder-id <folder-id>
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
/bin/bash .agents/skills/e2e-test/scripts/with-e2e-ids.sh \
  .agents/skills/e2e-test/ids.local.env -- pnpm --filter example test:e2e
```

With a valid saved profile, run
`TAILOR_PLATFORM_PROFILE=<profile> pnpm --filter example test:e2e` instead.

Resolver/workflow count mismatches or missing GraphQL fields usually mean the deployed app is stale.
Before redeploying with the same workspace ID, run `pnpm --filter example run deploy --dry-run` with
the same ID loader or profile used for the test. Inspect deletes, replacements, unmanaged-resource
warnings, ownership conflicts, and pending TailorDB migrations. Obtain explicit approval before
applying a plan that deletes or replaces resources, conflicts with another owner, or removes a
TailorDB field or type and its data. If ownership is unclear, stop and ask whether to use a dedicated
workspace. After an approved deploy, rerun the same test command.

## `packages/sdk/e2e`

This suite creates workspaces, deploys into them, and must delete them after every local run. It
uses `TAILOR_PLATFORM_ORGANIZATION_ID` and `TAILOR_PLATFORM_FOLDER_ID`; it does not reuse
`TAILOR_PLATFORM_WORKSPACE_ID`.

If either ID is missing, discover existing values and save both UUIDs to `ids.local.env` with mode
`0600`:

```sh
pnpm exec tailor-sdk organization list
pnpm exec tailor-sdk organization folder list --organization-id <organization-id>
# Optional: drill into a sub-folder.
pnpm exec tailor-sdk organization folder list --organization-id <organization-id> \
  --parent-folder-id <folder-id>
```

### Run with Existing Login

```sh
/bin/bash .agents/skills/e2e-test/scripts/with-e2e-ids.sh \
  .agents/skills/e2e-test/ids.local.env -- \
  /bin/bash .agents/skills/e2e-test/scripts/run-sdk-e2e.sh
```

### Run with Isolated Machine-User Login

Follow [AUTH.md](AUTH.md), using this target command:

```sh
/bin/bash .agents/skills/e2e-test/scripts/run-sdk-e2e.sh
```

The runner requires the organization and folder UUIDs, assigns a lowercase run ID of at most 40
characters and a temporary tracking directory, then executes `pnpm run test:e2e` in `packages/sdk`.
It previews and deletes only workspaces
containing that run ID, but first parses a raw JSON workspace listing and rejects candidates outside
the exact `e2e-ws-<run-id>-...` namespace. It verifies the same exact namespace is empty after
deletion, including after test failure or HUP, INT, or TERM; the isolated-auth flow uses the trusted
CLI for both checks. A cleanup failure makes the run fail and prints the test status separately;
inspect both before any manual deletion.

Errors stating that `my-app` has no auth configuration or that `manager-machine-user` was not found
usually select an undeployed or stale example workspace. Confirm the app list, follow the
shared-workspace and deploy-plan preflight above before redeploying `example/`, and rerun before
changing authentication.

To sweep older unscoped leftovers, run the cleanup script with `--dry-run`, inspect every listed
workspace, and only then run it without `--dry-run`. Never automate an unscoped sweep.
