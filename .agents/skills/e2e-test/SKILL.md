---
name: e2e-test
description: >
  Prepare, run, diagnose, and clean up this repository's end-to-end tests securely.
  Use when running `example/e2e` or `packages/sdk/e2e`, fixing their failures, or
  handling authentication, workspace, deployed-state, or cleanup prerequisites.
metadata:
  internal: true
---

# E2E Testing

Run the selected suite against authenticated, current platform state and clean up resources created
by the run.

## Workflow

1. If the user reported a failure, run or inspect the failing command before diagnosing it.
2. Select `example/e2e`, `packages/sdk/e2e`, or both from the user's request. Ask when the request is
   open-ended; the suites have different prerequisites.
3. Load saved non-secret IDs through the validating loader below when the selected path requires
   them. A valid profile can replace the example workspace ID. Do not rediscover saved IDs.
4. Verify authentication using [AUTH.md](AUTH.md). If the saved session cannot refresh, ask the user
   to log in; do not read or rewrite refresh-token data.
5. Follow the selected suite's preflight, run, and cleanup instructions in [SUITES.md](SUITES.md).
6. Report the first relevant failure, the exact command run, and the cleanup result.

## Suite Selection

| Suite              | Workspace lifecycle           | Pre-deploy                     |
| ------------------ | ----------------------------- | ------------------------------ |
| `example/e2e`      | Reuses one workspace          | Deploy `example/` when drifted |
| `packages/sdk/e2e` | Creates disposable workspaces | Test deploys itself            |

## Stored IDs

Read `.agents/skills/e2e-test/ids.local.env` first. It is gitignored and may contain only:

- `TAILOR_PLATFORM_WORKSPACE_ID` for `example/e2e`
- `TAILOR_PLATFORM_ORGANIZATION_ID` for `packages/sdk/e2e`
- `TAILOR_PLATFORM_FOLDER_ID` for `packages/sdk/e2e`

If the file is missing but `.agents/skills/e2e-setup/ids.local.env` exists, move that legacy file to
the new location and set mode `0600`. Never store tokens, client IDs, or client secrets in this file.
A valid `TAILOR_PLATFORM_PROFILE` can supply the example workspace without this file.

Never source the file. Run commands through the loader, which accepts only the three UUID fields and
rejects duplicate, malformed, or executable content:

```sh
/bin/bash .agents/skills/e2e-test/scripts/with-e2e-ids.sh \
  .agents/skills/e2e-test/ids.local.env -- <command> [args...]
```

## Failure Routing

- Authentication or token errors: [AUTH.md](AUTH.md)
- Missing workspace, organization, or folder IDs: [SUITES.md](SUITES.md)
- Missing auth configuration, missing machine user, resolver/workflow count mismatches, or absent
  GraphQL fields: verify the selected example workspace and follow its deploy preflight
- Failed `packages/sdk/e2e`: inspect both the test status and exact-namespace cleanup status
