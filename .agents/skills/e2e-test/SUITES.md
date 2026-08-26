# E2E Suites

## `example/e2e`

This suite asserts against the deployed state of `example/`. The selected workspace must contain the
current `example/tailor.config.ts` output as application `my-app`.

### Preflight

Confirm the saved workspace still hosts `my-app`:

```sh
/bin/bash .agents/skills/e2e-test/scripts/with-e2e-ids.sh \
  .agents/skills/e2e-test/ids.local.env -- \
  pnpm exec tailor workspace app list
```

Treat a reused workspace as shared until its users and ownership are known. List its Platform users
before any redeploy:

```sh
/bin/bash .agents/skills/e2e-test/scripts/with-e2e-ids.sh \
  .agents/skills/e2e-test/ids.local.env -- \
  pnpm exec tailor workspace user list
```

If another person or automation may rely on it, ask the user before changing it. With a valid
profile, run both checks with the same `TAILOR_PLATFORM_PROFILE` instead of the ID loader.

If the workspace is missing or no longer hosts the application:

1. Verify login with `pnpm exec tailor workspace list`.
2. Resolve existing organization and folder IDs only when they are not saved:
   ```sh
   pnpm exec tailor organization list
   pnpm exec tailor organization folder list --organization-id <organization-id>
   ```
3. Ask before creating a long-lived workspace. Use `example-e2e` unless it collides.
4. Save its ID to `ids.local.env`, set mode `0600`, deploy, and confirm `my-app`:
   ```sh
   TAILOR_PLATFORM_WORKSPACE_ID=<workspace-id> pnpm --filter example run deploy
   pnpm exec tailor workspace app list --workspace-id <workspace-id>
   ```

Use `run deploy`; pnpm's built-in `deploy` shadows the package script when `run` is omitted.

### Run and Repair Drift

```sh
/bin/bash .agents/skills/e2e-test/scripts/with-e2e-ids.sh \
  .agents/skills/e2e-test/ids.local.env -- pnpm --filter example test:e2e
```

With a valid saved profile and no ID file, run:

```sh
TAILOR_PLATFORM_PROFILE=<profile> pnpm --filter example test:e2e
```

Resolver/workflow count mismatches or missing GraphQL fields usually mean the deployed app is stale.
Before redeploying, run `pnpm --filter example run deploy --dry-run` with the same ID loader or
profile. Inspect deletes, replacements, ownership conflicts, and TailorDB migrations. Obtain explicit
approval before applying destructive or ownership-conflicting changes, then rerun the same test.

## `packages/sdk/e2e`

This suite creates disposable workspaces and uses `TAILOR_PLATFORM_ORGANIZATION_ID` and
`TAILOR_PLATFORM_FOLDER_ID`; it does not reuse `TAILOR_PLATFORM_WORKSPACE_ID`.

If either ID is missing, discover an existing value and save it to `ids.local.env` with mode `0600`:

```sh
pnpm exec tailor organization list
pnpm exec tailor organization folder list --organization-id <organization-id>
```

Run through the wrapper so every workspace created for the run receives one namespace and cleanup is
attempted after success, failure, HUP, INT, or TERM:

```sh
/bin/bash .agents/skills/e2e-test/scripts/with-e2e-ids.sh \
  .agents/skills/e2e-test/ids.local.env -- \
  /bin/bash .agents/skills/e2e-test/scripts/run-sdk-e2e.sh
```

The wrapper runs `pnpm run test:e2e` in `packages/sdk`, deletes only valid workspace IDs whose names
start with its exact `e2e-ws-<run-id>-` namespace, and obtains a fresh workspace list afterward. It
tries every matching deletion even when one fails. The cleanup result overrides the test result when
cleanup fails, and both statuses are printed.

Signal cleanup is best effort; SIGKILL and machine or network failure cannot be trapped. If the final
audit did not complete, list workspaces and inspect the exact run namespace before deleting anything.

To sweep older unscoped leftovers, run the existing
`packages/sdk/scripts/cleanup-e2e-workspaces.ts` with `--dry-run`, inspect every listed workspace, ask
for explicit approval, and only then run it without `--dry-run`. Never automate an unscoped sweep.

The one sanctioned scoped exception is `--local-orphans --min-age-hours=<N>`: it restricts the sweep
to workspaces with no organization and no run id in their name (i.e. leftovers from a killed local
run, which CI's own scheduled cleanup can never match, since it has no GitHub Actions run to check
against), and only once they are at least that old. A `lefthook-local.yml` hook may call this scoped
form unattended; the unscoped form above still always requires a human in the loop.
