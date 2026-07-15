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

Run the selected suite against authenticated, current platform state and leave no disposable
workspaces behind.

## Workflow

1. If the user reported a failure, run or inspect the failing command first. Do not diagnose from
   a paraphrase when raw output is available.
2. Select the suite from the table below. If the request is open-ended, ask whether to run
   `example/e2e`, `packages/sdk/e2e`, or both; do not guess.
3. Load the stored non-secret IDs described below. Do not rediscover IDs already on disk.
4. Establish authentication using [AUTH.md](AUTH.md). Never expose a long-lived client secret to
   the code under test.
5. Follow the selected suite's preflight, run, and cleanup instructions in [SUITES.md](SUITES.md).
6. Report the first relevant failure, the exact verification command, and cleanup results.

## Suite Selection

| Suite              | Workspace lifecycle           | Pre-deploy                     | CI  |
| ------------------ | ----------------------------- | ------------------------------ | --- |
| `example/e2e`      | Reuses one workspace          | Deploy `example/` when drifted | No  |
| `packages/sdk/e2e` | Creates disposable workspaces | Test deploys itself            | Yes |

## Stored IDs

Read `.agents/skills/e2e-test/ids.local.env` first. It is gitignored and contains only:

- `TAILOR_PLATFORM_WORKSPACE_ID` for `example/e2e`
- `TAILOR_PLATFORM_ORGANIZATION_ID` for `packages/sdk/e2e`
- `TAILOR_PLATFORM_FOLDER_ID` for `packages/sdk/e2e`

If the file is missing but `.agents/skills/e2e-setup/ids.local.env` exists, move that legacy file
to the new location and set mode `0600`. Never store tokens, client IDs, or client secrets in this
file. If a required ID remains missing, follow the discovery flow in [SUITES.md](SUITES.md); ask
before creating a new long-lived workspace.

Source the file once and reuse its values:

```sh
set -a
source .agents/skills/e2e-test/ids.local.env
set +a
```

## Failure Routing

- Authentication or token errors: [AUTH.md](AUTH.md)
- Missing workspace, organization, or folder IDs: [SUITES.md](SUITES.md)
- Resolver/workflow counts or missing GraphQL fields: redeploy `example/`, then rerun
- Failed `packages/sdk/e2e`: always run the audited workspace cleanup before finishing
