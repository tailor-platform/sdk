# `setup github` Contracts

This document specifies the **beta graduation contracts** for `tailor-sdk setup
github` and the `tailor-platform/actions` that the generated workflows reference.

> **Graduation criterion:** Beta is not finished when implementation is
> complete — it is finished when all 13 contracts below are confirmed, specified
> here in concrete terms, and recorded in generated files and
> `.github/tailor-sdk.lock`.

Notation used throughout:

- **P0 — implemented:** Shipped in the initial `setup github` rewrite
  (actions v1.2 + SDK released together).
- **Design confirmed, P1+ implementation:** Contract is fixed now so external
  surfaces do not change; implementation follows in a later release.

---

## Contract 1 — Reserved job/step ids and public outputs/env

### Status: P0 implemented (P0 ids); Design confirmed, P1+ implementation (future ids and outputs)

Every job id and step id with a `tailor-` prefix is SDK-managed. Users must not
edit, rename, or delete managed ids unless deliberately ejecting them (see
[Contract 6](#contract-6--ownership-model-and-regeneration-behaviour)).
Managed ids are stable references safe to use in branch protection **required
status checks**.

#### Jobs generated in P0

| Job id             | Target                | Description                                                                                 |
| ------------------ | --------------------- | ------------------------------------------------------------------------------------------- |
| `tailor-tag-guard` | tag (with `--branch`) | Checks that the tagged commit is reachable from the configured branch. Output: `on-branch`. |
| `tailor-plan`      | branch, tag           | Runs `generate`, `generate-check`, and posts a plan diff.                                   |
| `tailor-deploy`    | branch, tag           | Runs deploy (`tailor-sdk deploy`).                                                          |

#### Steps generated in P0

| Qualified id (`<job>/<step>`)       | Description                                                     |
| ----------------------------------- | --------------------------------------------------------------- |
| `tailor-tag-guard/tailor-checkout`  | `actions/checkout` with `fetch-depth: 0`                        |
| `tailor-tag-guard/tailor-tag-guard` | Branch-reachability shell script                                |
| `tailor-plan/tailor-checkout`       | `actions/checkout`                                              |
| `tailor-plan/tailor-setup-pnpm`     | `pnpm/action-setup` (pnpm projects only)                        |
| `tailor-plan/tailor-setup-node`     | `actions/setup-node`                                            |
| `tailor-plan/tailor-setup-bun`      | `oven-sh/setup-bun` (bun projects only)                         |
| `tailor-plan/tailor-install`        | Package install (`pnpm install --frozen-lockfile` / equivalent) |
| `tailor-plan/tailor-generate`       | `tailor-sdk generate`                                           |
| `tailor-plan/tailor-generate-check` | Checks generated files are committed                            |
| `tailor-plan/tailor-plan`           | `tailor-platform/actions/plan@v1`                               |
| `tailor-deploy/tailor-checkout`     | `actions/checkout`                                              |
| `tailor-deploy/tailor-setup-pnpm`   | pnpm projects only                                              |
| `tailor-deploy/tailor-setup-node`   | node projects                                                   |
| `tailor-deploy/tailor-setup-bun`    | bun projects only                                               |
| `tailor-deploy/tailor-install`      | Package install                                                 |
| `tailor-deploy/tailor-apply`        | `tailor-platform/actions/deploy@v1`                             |

#### Public outputs (P0 implemented)

| Expression                                 | Description                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `needs.tailor-tag-guard.outputs.on-branch` | `"true"` / `"false"`. Used in downstream `if:` conditions to gate plan/deploy on branch reachability. |

#### Reserved for future releases (Design confirmed, P1+ implementation)

The following ids and outputs are reserved and must not be used by user code:

| Future id / output                   | Planned role                                                         |
| ------------------------------------ | -------------------------------------------------------------------- |
| `tailor-drift-check` (step)          | Warns when config has drifted from generated workflow                |
| `tailor-seed-validate` (step)        | Validates seed JSONL against schema                                  |
| `tailor-staticwebsite-deploy` (step) | Deploys static website assets                                        |
| `build-site-<name>` (step)           | User-owned slot for building a static site named `<name>`            |
| `seed-data` (step)                   | User-owned slot for seeding data (preview target)                    |
| `tailor-preview-comment` (step)      | Posts workspace URL to PR                                            |
| `tailor-preview-deploy` (job)        | Deploys the per-PR preview workspace                                 |
| `tailor-preview-cleanup` (job)       | Deletes ephemeral preview workspace on PR close                      |
| `steps.tailor-apply.outputs.app-url` | Application URL after deploy (wired into `build-site-<name>` inputs) |
| `TAILOR_SITE_DIST_<SITE>` (env)      | Path to built static site dist registered by `build-site-<name>`     |

Slot ids (`build-site-<name>`, `seed-data`) are **user-owned in content** but
**SDK-owned in name and position**. The SDK reserves the namespace; user code
fills in the implementation.

---

## Contract 2 — `.github/tailor-sdk.lock` schema

### Status: P0 implemented

The lock file is JSON, 2-space indented, with a trailing newline. It is
**machine-owned**: commit it, never edit it by hand.

### v1 schema

```jsonc
{
  "version": 1,
  "targets": [
    {
      "kind": "branch", // "branch" | "tag"
      "workspaceName": "my-app-stg",
      "file": ".github/workflows/tailor-my-app-stg.yml", // repo-root-relative, POSIX separators
      "templateVersion": 1, // internal constant TEMPLATE_VERSION
      "inputs": {
        "workspaceRegion": "...",
        "organizationId": "...",
        "folderId": null, // null when omitted
        "branch": "main", // null for tag target with no --branch
        "tagPattern": null, // non-null for tag target only
        "environment": null, // non-null when --environment is passed
        "dir": ".",
        "packageManager": "pnpm", // "npm" | "pnpm" | "yarn" | "bun"
        "plan": true, // false when --no-plan
      },
      "generatedIds": [
        // history of managed ids written by this setup run
        "tailor-plan", // job id
        "tailor-plan/tailor-checkout", // job/step qualified form
        "tailor-plan/tailor-setup-pnpm",
        "tailor-plan/tailor-install",
        "tailor-plan/tailor-generate",
        "tailor-plan/tailor-generate-check",
        "tailor-plan/tailor-plan",
        "tailor-deploy",
        "tailor-deploy/tailor-checkout",
        "...",
      ],
      "ejectedIds": [], // ids the user has deliberately removed; not regenerated
      "contentHash": "sha256:<hex>", // SHA-256 of the written workflow file
    },
  ],
}
```

### Discipline

- **Version field**: if `version > 1`, the SDK emits an error: "This lock file
  was written by a newer SDK. Update `@tailor-platform/sdk` to continue."
- **Hash mismatch**: if the on-disk file hash differs from `contentHash`, the
  SDK stops and reports the conflict. `--force` overwrites the file and resets
  the hash.
- **Missing file, lock present**: the file is regenerated and the hash updated.
  The SDK logs that the file was restored.
- **File present, not in lock**: treated as an unmanaged file. The SDK errors
  and asks the user to delete it or use `--force` to take it under management.
- **Target identity in P0**: `(kind, workspaceName)` is the unique key.
  Full dual-key matching (trigger-primary, path-secondary) is P2.
- **`ejectedIds`**: populated in P1+ when eject semantics are fully
  implemented. In P0, the field is present but always `[]`.

---

## Contract 3 — Secrets and variables naming

### Status: P0 implemented

| Name                                         | Scope                            | Description                      |
| -------------------------------------------- | -------------------------------- | -------------------------------- |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID`     | Repository or Environment secret | Machine user OAuth client ID     |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET` | Repository or Environment secret | Machine user OAuth client secret |

Rules:

- The prefix `TAILOR_PLATFORM_` is reserved for all SDK-related secrets and
  variables.
- Names are **fixed**. App-specific or environment-specific suffixes (e.g.,
  `_PRODUCTION`) are not used. Environment isolation is expressed through
  GitHub Environments (environment-scoped secrets), not name variants.
- `TAILOR_PLATFORM_WORKSPACE_ID` (used in the pre-P0 beta) is **removed**.
  Workspace resolution now uses `workspace-name` + `workspace-region` inputs
  at plan/deploy time, eliminating the chicken-and-egg problem.
- The deprecated `PLATFORM_MACHINE_USER_*` names (pre-P0 beta) are no longer
  generated.

---

## Contract 4 — File naming, `name:` convention, and lock-based identity

### Status: P0 implemented (naming); Design confirmed, P1+ implementation (dual-key matching)

| Convention         | Value                                           |
| ------------------ | ----------------------------------------------- |
| Workflow file path | `.github/workflows/tailor-<workspace-name>.yml` |
| Workflow `name:`   | `Tailor (<workspace-name>)`                     |

The lock identifies targets by `(kind, workspaceName)` in P0. If the same
workspace name is used for both a branch and a tag target, the generated files
would share the same path — the CLI errors and asks the user to specify a
different name with `-n`.

Full dual-key matching (trigger as primary key, file path as secondary) that
can handle renaming and multi-trigger coexistence is a P2 enhancement.

---

## Contract 5 — Composite actions and role separation

### Status: Design confirmed, P1+ implementation (full actions extraction)

### Principle

- **Workflow = configuration.** The generated workflow owns triggers, job
  topology (`needs`, `if`, `concurrency`, `environment`, `permissions`), and
  `with:` parameter wiring.
- **Actions = behaviour.** The execution logic of managed steps lives in
  `tailor-platform/actions`, not in the generated workflow. This limits how
  often users need to regenerate — only when configuration changes, not when
  behaviour improves.

### P0 state

In P0, the setup steps (`tailor-setup-node`, `tailor-setup-pnpm`,
`tailor-setup-bun`, `tailor-install`) and the `tailor-generate` /
`tailor-generate-check` steps are inlined in the generated workflow. The
`tailor-plan` and `tailor-apply` steps already delegate to composite actions
(`tailor-platform/actions/plan@v1` and `tailor-platform/actions/deploy@v1`).

### P1 target state

All managed steps will be extracted into `tailor-platform/actions`. The
generated workflow will contain only a single composite-action call per managed
function. Users will receive behaviour improvements (e.g., new drift checks)
via Renovate pin updates without needing to regenerate their workflows.

### No reusable workflows

Managed behaviour is delivered as composite actions, not reusable workflows.
Composite actions can be used as steps inside user-controlled jobs; reusable
workflows would impose a separate job boundary and limit user customization.

---

## Contract 6 — Ownership model and regeneration behaviour

### Status: P0 implemented (3 classes, `--force`); Design confirmed, P1+ implementation (eject/`--restore`, slot semantics, merge engine)

### Three ownership classes

| Class                                       | How to identify                    | Content ownership | On regeneration                                                                                                                 |
| ------------------------------------------- | ---------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Managed** (`tailor-*`)                    | `id:` starts with `tailor-`        | SDK               | Full replacement. Hand edits detected via lock hash; error stops regeneration (diff display is P2). Use `--force` to overwrite. |
| **Slot** (`build-site-<name>`, `seed-data`) | Reserved name, no `tailor-` prefix | User              | Presence, position, and wiring are regenerated; inner content is preserved.                                                     |
| **User**                                    | Everything else                    | User              | Untouched. Position anchored to the preceding managed step.                                                                     |

### User-editable fields on managed jobs/steps

The following fields may be edited by the user within managed jobs/steps and
are preserved across regeneration (they are excluded from the content hash):

| Field                  | Level                        | Notes                                                                                                         |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `runs-on`              | job                          | Self-hosted runners, container runs                                                                           |
| `timeout-minutes`      | job                          | Override the generated default                                                                                |
| `container`            | job                          | Container execution                                                                                           |
| `env`                  | job and step (all levels)    | The template never writes `env:`. All `env:` usage on any job or step is user territory and always preserved. |
| `with.ignore`          | `tailor-generate-check` step | Glob patterns to exclude from the generated-file check (P1, when step is extracted to action)                 |
| `with.install-command` | `tailor-install` step        | Override the default install command (P1)                                                                     |

### Regeneration behaviour matrix

| Element                                                         | How identified              | On regeneration                                                         | If hand-edited                               | If deleted                                                            |
| --------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| Lock file                                                       | `.github/tailor-sdk.lock`   | Always regenerated                                                      | Prohibited (machine-owned)                   | Recreated, but managed state is lost; existing files become unmanaged |
| Top-level keys (`on:`, `name:`, `permissions:`, `concurrency:`) | —                           | Replaced from target definition                                         | Hash mismatch → error (`--force` overwrites) | Same                                                                  |
| Managed job/step                                                | `id:` starts with `tailor-` | Full replacement                                                        | Hash mismatch → error (`--force` overwrites) | Logged as eject; not regenerated (recorded in `ejectedIds`)           |
| User-editable fields (see above)                                | Field name                  | Preserved                                                               | Preserved (expected customization)           | Reverts to template default                                           |
| Slot                                                            | Reserved name               | Presence/position/wiring only; content preserved                        | Freely editable (user-owned)                 | Logged as eject                                                       |
| User step/job                                                   | All other ids               | Untouched                                                               | Freely editable                              | Freely deletable                                                      |
| Local action (`build-site-*`)                                   | Under `.github/actions/`    | Not touched; scaffold regenerated if slot is live but action is missing | Freely editable                              | Not regenerated if slot is also ejected                               |

### `--force`

Discards all hand edits and unmanaged files in conflict, regenerates from the
current template, and resets the lock. Showing a diff before applying is a P2
enhancement (P0 overwrites directly).

### Eject (P1+)

Deleting or renaming a managed id is an eject: the user takes ownership of
that element. On the next `setup github` run, the id is moved from
`generatedIds` to `ejectedIds` in the lock and the user is notified. Ejected
elements are never regenerated.

### `--restore <id>` (P1+)

Restores a previously ejected id from the current template. Only that element
is regenerated; the rest of the file is unchanged.

### In-file affordance (P0 header comment)

The generated workflow includes a header comment block that explains the
ownership rules to human and AI editors:

```yaml
# Generated by `tailor-sdk setup github` — managed by the Tailor SDK.
#
# - Jobs and steps whose id starts with `tailor-` are managed by the SDK.
#   Do not edit or rename them.
# - State is tracked in .github/tailor-sdk.lock (machine-owned: commit it, never edit it).
# - Re-running `tailor-sdk setup github` regenerates this file. If you have
#   edited it by hand, regeneration stops and asks for --force (which discards
#   your edits), so prefer keeping customizations in your own jobs/steps and
#   re-running setup after SDK updates.
```

In P1+, slot steps will carry `# slot: inner content is yours` and
user-editable fields will carry `# editable: preserved on regeneration`
inline comments so editors can identify them without consulting the lock.

---

## Contract 7 — CLI flag semantics

### Status: P0 implemented

| Flag                 | Alias | Required | Default                    | Semantics                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ----- | -------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--workspace-name`   | `-n`  | No       | Derived from `config.name` | Workspace name. Must match `/^[a-z0-9][a-z0-9-]*$/` and be ≤ 63 characters.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--workspace-region` | `-r`  | Yes      | —                          | Workspace region.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--organization-id`  | `-o`  | Yes      | —                          | Organization ID for workspace auto-creation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--folder-id`        | `-f`  | No       | None                       | Optional folder placement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--branch`           | —     | No       | See below                  | **Three distinct meanings depending on target:** (1) Branch target: the branch that triggers the workflow (push events + PR base filter). Defaults to the repo's default branch, detected from `git symbolic-ref --short refs/remotes/origin/HEAD`. (2) Tag target with `--branch`: the branch whose history the tag must be reachable from (tag-guard). Omitting `--branch` on a tag target disables the guard. (3) Tag target manual dispatch: `--branch` has no effect; the guard is bypassed for `workflow_dispatch` regardless. |
| `--tag`              | —     | No       | `false`                    | Generate a tag target instead of a branch target.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--tag-pattern`      | —     | No       | `v*`                       | Tag glob pattern. Requires `--tag`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--environment`      | —     | No       | None                       | GitHub Environment name for the deploy job.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--no-plan`          | —     | No       | `false`                    | Omit the plan job (and `on.pull_request` trigger) from a branch target. Incompatible with `--tag`.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `--dir`              | `-d`  | No       | `.`                        | App directory for monorepos. Adds a `paths` filter and sets `working-directory` on SDK commands.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `--force`            | —     | No       | `false`                    | Overwrite hand-edited or unmanaged files without prompting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**Removed flags (pre-P0 beta):** `--with-plan` / `-p` (replaced by the new
default-on plan job; disable with `--no-plan`).

**Validation rules:**

- `--tag-pattern` without `--tag`: error.
- `--no-plan` + `--tag`: error (tag targets always require a plan).
- Workspace name does not match pattern or exceeds 63 characters: error.
- `tailor.config.ts` not found under `--dir`: error with actionable message.

---

## Contract 8 — GitHub Environments and per-target secret resolution

### Status: P0 implemented (`--environment`); Design confirmed for full multi-target isolation

The deploy job's `environment:` key is set to the `--environment` value when
provided. GitHub's secret resolution order — environment secrets override
repository secrets — is the entire isolation mechanism.

Rules:

- Secret names are fixed (`TAILOR_PLATFORM_MACHINE_USER_*`). There are no
  app-specific or environment-specific name suffixes.
- Tag routing to environments is controlled by approval gates, not tag name
  patterns. One tag = one release candidate; which environment it reaches is
  determined by who approves the corresponding environment.
- When multiple tag targets share the same tag pattern and none uses
  `--environment`, `setup github` emits a warning (P1+, when the CLI gains
  API validation).

---

## Contract 9 — Workspace resolution modes

### Status: P0 implemented (auto-create); Design confirmed, P1+ implementation (`--workspace-id`)

**P0 — auto-create mode (name + region):**
`tailor-platform/actions/plan@v1` and `tailor-platform/actions/deploy@v1`
receive `workspace-name` and `workspace-region` as inputs. The actions resolve
or create the workspace at runtime. This eliminates the pre-P0 chicken-and-egg
problem where `TAILOR_PLATFORM_WORKSPACE_ID` was unavailable until after the
first deploy.

**P1 — `--workspace-id` direct mode:**
A `--workspace-id` CLI flag will allow targeting a pre-existing workspace by
ID. The generated `with:` block will include `workspace-id` instead of
`workspace-name` + `workspace-region`. Use this for workspaces that must not
be auto-created.

---

## Contract 10 — `workflow_dispatch` inputs schema

### Status: P0 implemented

Every generated workflow includes a `workflow_dispatch` trigger with the
following input:

```yaml
on:
  workflow_dispatch:
    inputs:
      dry-run:
        description: Preview changes without deploying
        type: boolean
        default: false
```

Behaviour:

- `dry-run: true` runs the plan job and skips the deploy job.
- `dry-run: false` (default) runs both plan and deploy.
- When `--no-plan` is set on a branch target, the `workflow_dispatch` trigger
  is still generated but `inputs:` is omitted (there is no plan job to run).

---

## Contract 11 — Static website local actions and interface

### Status: Design confirmed, P1+ implementation

This contract covers the `build-site-<name>` slot and the
`tailor-platform/actions/staticwebsite-deploy` action. Nothing in this
contract is generated in P0.

Rules that are fixed now so the namespace is stable:

- Local actions live under `.github/actions/build-site-<name>/`. This
  namespace is reserved; user projects must not place unrelated actions here.
- The site `<name>` is normalized to a step id-safe string
  (`[a-z0-9-]+`). Normalization collisions are an error at setup time.
- The interface contract for `build-site-<name>`:
  - Input: `api-url` (the application GraphQL URL from `tailor-apply` outputs)
  - Output: registers `TAILOR_SITE_DIST_<SITE>` in `$GITHUB_ENV`
    where `<SITE>` is the upper-cased, non-alphanumeric-replaced site name
    (e.g., site `admin-portal` → `TAILOR_SITE_DIST_ADMIN_PORTAL`).
- `tailor-staticwebsite-deploy` reads the `TAILOR_SITE_DIST_*` env vars and
  uploads all registered sites.

---

## Contract 12 — Preview workspace naming and lifecycle

### Status: Design confirmed, P1+ implementation

Not generated in P0. Specified here so the workspace naming scheme is stable.

- Preview workspace name pattern: `<prefix>-pr-<PR number>`.
- Default prefix: the repository name (for monorepos with multiple apps,
  `<repo>-<app>`); override with `--name-prefix`.
- If the resulting name exceeds 63 characters, `setup github` errors at
  generation time with the message "Preview workspace name
  `<prefix>-pr-<N>` would exceed 63 characters. Shorten the name with
  `--name-prefix`."
- Workspace id is recorded in a PR comment by `tailor-preview-comment` and
  used as the deletion guard: the cleanup job deletes the workspace only if a
  recorded id exists.

---

## Contract 13 — actions ↔ SDK version compatibility and semver rules

### Status: Design confirmed (semver rules); P1+ implementation (runtime SDK version check)

### actions semver rules

| Change type                                               | Version impact |
| --------------------------------------------------------- | -------------- |
| Adding a new action                                       | Minor (v1.x)   |
| Adding an optional input to an existing action            | Minor (v1.x)   |
| Removing an input or changing behaviour in a breaking way | Major (v2)     |

Templates generated by `setup github` always pin actions to the current major
version tag (e.g., `tailor-platform/actions/plan@v1`). This is a moving tag
that points to the latest compatible release. Renovate updates third-party
actions (e.g., `actions/checkout`) to SHA pins with version comments.

### SDK ↔ actions compatibility check (P1)

Starting in P1, `tailor-platform/actions` will validate that the SDK version
installed in the repository is at or above a minimum supported version. If the
check fails, the action will emit a clear error message such as:

> "This workflow was generated for `@tailor-platform/sdk` ≥ 1.x.x. The
> installed version is 0.y.z. Run `npm install @tailor-platform/sdk@latest` to
> upgrade."

---

## Appendix: Contract-to-implementation mapping

| Contract                | User guide section       | Lock field(s)                               | CLI flag(s)                  | Action input/output                            |
| ----------------------- | ------------------------ | ------------------------------------------- | ---------------------------- | ---------------------------------------------- |
| #1 Reserved ids         | Ownership rules          | `generatedIds`, `ejectedIds`                | —                            | job/step ids                                   |
| #2 Lock schema          | Generated files          | entire file                                 | —                            | —                                              |
| #3 Secrets naming       | Secrets                  | `inputs.{organizationId,...}`               | —                            | `platform-client-id`, `platform-client-secret` |
| #4 File naming          | Generated files          | `file`, `workspaceName`                     | `-n`                         | —                                              |
| #5 Composite actions    | — (developer doc)        | `templateVersion`                           | —                            | action refs                                    |
| #6 Ownership model      | Ownership rules          | `generatedIds`, `ejectedIds`, `contentHash` | `--force`                    | —                                              |
| #7 CLI flags            | Usage examples           | `inputs.*`                                  | all flags                    | `workspace-name`, `workspace-region`, etc.     |
| #8 Environments         | GitHub Environments      | `inputs.environment`                        | `--environment`              | —                                              |
| #9 Workspace resolution | — (developer doc)        | `inputs.workspaceRegion`                    | `--workspace-region`         | `workspace-name`, `workspace-region`           |
| #10 `workflow_dispatch` | Manual runs              | `inputs.plan`                               | `--no-plan`                  | `dry-run` input                                |
| #11 Static site slots   | — (not in P0 user guide) | future `slots` field                        | future `--site`              | `api-url` input, `TAILOR_SITE_DIST_*` env      |
| #12 Preview naming      | — (not in P0 user guide) | future preview entry                        | `--preview`, `--name-prefix` | preview-comment                                |
| #13 Semver + compat     | — (developer doc)        | `templateVersion`                           | —                            | min-sdk-version check                          |
