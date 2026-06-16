# `setup github` Contracts

This document specifies the **beta graduation contracts** for `tailor-sdk setup
github` and the generated GitHub Actions workflows.

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

| Job id             | Target                | Description                                                                                                                                                 |
| ------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tailor-tag-guard` | tag (with `--branch`) | Checks that the tagged commit is reachable from the configured branch. Output: `on-branch`.                                                                 |
| `tailor-plan`      | branch, tag           | Runs `generate`, `generate-check`, and the plan dry-run. On a branch target it posts a PR comment; on a tag target it writes the step summary only (no PR). |
| `tailor-deploy`    | branch, tag           | Runs the deploy (`tailor-sdk deploy`).                                                                                                                      |

#### Steps generated in P0

| Qualified id (`<job>/<step>`)             | Description                                                     |
| ----------------------------------------- | --------------------------------------------------------------- |
| `tailor-tag-guard/tailor-checkout`        | `actions/checkout` with `fetch-depth: 0`                        |
| `tailor-tag-guard/tailor-tag-guard`       | Branch-reachability shell script                                |
| `tailor-plan/tailor-checkout`             | `actions/checkout`                                              |
| `tailor-plan/tailor-merge-base`           | Merges the PR base branch before branch-target dry-runs         |
| `tailor-plan/tailor-setup-pnpm`           | `pnpm/action-setup` (pnpm projects only)                        |
| `tailor-plan/tailor-setup-node`           | `actions/setup-node`                                            |
| `tailor-plan/tailor-setup-bun`            | `oven-sh/setup-bun` (bun projects only)                         |
| `tailor-plan/tailor-install`              | Package install (`pnpm install --frozen-lockfile` / equivalent) |
| `tailor-plan/tailor-generate`             | `tailor-sdk generate`                                           |
| `tailor-plan/tailor-generate-check`       | Checks generated files are committed                            |
| `tailor-plan/tailor-mask-credentials`     | Masks machine-user credentials                                  |
| `tailor-plan/tailor-login`                | `tailor-sdk login --machine-user`                               |
| `tailor-plan/tailor-plan`                 | `tailor-sdk deploy --dry-run --yes`                             |
| `tailor-plan/tailor-plan-summary`         | Writes the plan result to the step summary                      |
| `tailor-plan/tailor-plan-comment`         | Updates the PR plan comment on branch targets                   |
| `tailor-plan/tailor-plan-fail`            | Fails the job when the dry-run exits non-zero                   |
| `tailor-deploy/tailor-checkout`           | `actions/checkout`                                              |
| `tailor-deploy/tailor-setup-pnpm`         | pnpm projects only                                              |
| `tailor-deploy/tailor-setup-node`         | node projects                                                   |
| `tailor-deploy/tailor-setup-bun`          | bun projects only                                               |
| `tailor-deploy/tailor-install`            | Package install                                                 |
| `tailor-deploy/tailor-validate-workspace` | Fails when `TAILOR_PLATFORM_WORKSPACE_ID` is empty              |
| `tailor-deploy/tailor-mask-credentials`   | Masks machine-user credentials                                  |
| `tailor-deploy/tailor-login`              | `tailor-sdk login --machine-user`                               |
| `tailor-deploy/tailor-generate`           | `tailor-sdk generate`                                           |
| `tailor-deploy/tailor-deploy`             | `tailor-sdk deploy --yes`                                       |

#### Public outputs (P0 implemented)

| Expression                                 | Description                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `needs.tailor-tag-guard.outputs.on-branch` | `"true"` / `"false"`. Used in downstream `if:` conditions to gate plan/deploy on branch reachability. |

#### Reserved for future releases (Design confirmed, P1+ implementation)

The following ids and outputs are reserved and must not be used by user code:

| Future id / output                    | Planned role                                                         |
| ------------------------------------- | -------------------------------------------------------------------- |
| `tailor-drift-check` (step)           | Warns when config has drifted from generated workflow                |
| `tailor-seed-validate` (step)         | Validates seed JSONL against schema                                  |
| `tailor-staticwebsite-deploy` (step)  | Deploys static website assets                                        |
| `build-site-<name>` (step)            | User-owned slot for building a static site named `<name>`            |
| `seed-data` (step)                    | User-owned slot for seeding data (preview target)                    |
| `tailor-preview-comment` (step)       | Posts workspace URL to PR                                            |
| `tailor-preview-deploy` (job)         | Deploys the per-PR preview workspace                                 |
| `tailor-preview-cleanup` (job)        | Deletes ephemeral preview workspace on PR close                      |
| `steps.tailor-deploy.outputs.app-url` | Application URL after deploy (wired into `build-site-<name>` inputs) |
| `TAILOR_SITE_DIST_<SITE>` (env)       | Path to built static site dist registered by `build-site-<name>`     |

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
      "templateVersion": 2, // internal constant TEMPLATE_VERSION
      "inputs": {
        "branch": "main", // null for tag target with no --branch
        "tagPattern": null, // non-null for tag target only
        "environment": "my-app-stg", // always set (defaults to the workspace name)
        "dir": ".",
        "packageManager": "pnpm", // "npm" | "pnpm" | "yarn" | "bun"
        "plan": true, // false when --no-plan
      },
      "generatedIds": [
        // history of managed ids written by this setup run
        "tailor-plan", // job id
        "tailor-plan/tailor-checkout", // job/step qualified form
        "tailor-plan/tailor-merge-base",
        "tailor-plan/tailor-setup-pnpm", // pnpm projects only
        "tailor-plan/tailor-setup-node",
        "tailor-plan/tailor-install",
        "tailor-plan/tailor-generate",
        "tailor-plan/tailor-generate-check",
        "tailor-plan/tailor-mask-credentials",
        "tailor-plan/tailor-login",
        "tailor-plan/tailor-plan",
        "tailor-plan/tailor-plan-summary",
        "tailor-plan/tailor-plan-comment",
        "tailor-plan/tailor-plan-fail",
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

- **Version field**: if `version > LOCK_VERSION`, the SDK errors with
  "`.github/tailor-sdk.lock` was written by a newer SDK (lock version N).
  Update the SDK to continue: pnpm update @tailor-platform/sdk". A missing
  `version`, a non-array `targets`, or invalid JSON each produce a distinct
  "machine-owned; restore it from git" error rather than the newer-SDK message.
- **Hash mismatch**: if the on-disk file hash differs from `contentHash`, the
  SDK stops and reports the conflict. `--force` overwrites the file and resets
  the hash.
- **Missing file, lock present**: the file is re-rendered from the current
  options (not reconstructed from the lock contents) and the hash updated. The
  SDK logs that the file was regenerated because it was missing on disk.
- **File present, not in lock**: treated as an unmanaged file. The SDK errors
  and asks the user to delete it or use `--force` to take it under management.
- **Target identity in P0**: `(kind, workspaceName)` is the unique key.
  Full dual-key matching (trigger-primary, path-secondary) is P2.
- **`ejectedIds`**: populated in P1+ when eject semantics are fully
  implemented. In P0, the field is present but always `[]`.
- **No workspace id in the lock**: the lock is the target manifest only. The
  resolved workspace id is **not** stored here — it lives in the
  `TAILOR_PLATFORM_WORKSPACE_ID` Environment variable (Contracts 3 and 9), so
  there is a single source of truth and no drift between the lock and the
  variable.

---

## Contract 3 — Secrets and variables naming

### Status: P0 implemented (secret names); Design confirmed, implementation reworking (workspace-id variable)

**Secrets**

| Name                                         | Scope                            | Description                      |
| -------------------------------------------- | -------------------------------- | -------------------------------- |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID`     | Repository or Environment secret | Machine user OAuth client ID     |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET` | Repository or Environment secret | Machine user OAuth client secret |

**Variables**

| Name                           | Scope                                         | Description                                                                                                                                                                              |
| ------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAILOR_PLATFORM_WORKSPACE_ID` | Environment variable (per target environment) | The workspace id that `deploy`/`plan` target. The source of truth for which workspace a target deploys to. Written at provisioning time (Terraform / GitHub App / manual); not a secret. |

Rules:

- The prefix `TAILOR_PLATFORM_` is reserved for all SDK-related secrets and
  variables. (The workspace-id variable is therefore `TAILOR_PLATFORM_WORKSPACE_ID`,
  not `TAILOR_WORKSPACE_ID`.)
- Names are **fixed**. App-specific or environment-specific suffixes (e.g.,
  `_PRODUCTION`) are not used. Per-environment isolation is expressed through
  GitHub Environments (environment-scoped secret/variable values), not name
  variants.
- `TAILOR_PLATFORM_WORKSPACE_ID` is the workspace-id store (see Contract 9):
  `deploy`/`plan` read it and operate by id; they never resolve a workspace by
  name or create one. (This supersedes the short-lived name+region resolution
  approach explored during the rewrite, in which this variable was temporarily
  removed.)
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

- **Workflow = contract.** The generated workflow owns triggers, job topology
  (`needs`, `if`, `concurrency`, `environment`, `permissions`), secret/variable
  wiring, and the managed CLI steps.
- **Actions = optional future extraction.** Behaviour can move to
  `tailor-platform/actions` in a later release, but P0 generated workflows do
  not depend on Tailor-owned composite actions.

### P0 state

In P0, the setup steps (`tailor-setup-node`, `tailor-setup-pnpm`,
`tailor-setup-bun`, `tailor-install`), `tailor-generate` /
`tailor-generate-check`, plan dry-run/commenting, and deploy steps are inlined
in the generated workflow. They use the canonical CLI surface:
`tailor-sdk login --machine-user` and `tailor-sdk deploy`.

### P1 target state

Managed steps may be extracted into `tailor-platform/actions`. If that happens,
the generated workflow will contain a composite-action call per managed
function. Users would receive behaviour improvements (e.g., new drift checks)
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

### Status: P0 implemented (pre-rework); flag set under review for id-by-variable

> **Note (id-by-variable rework).** The table below reflects the pre-rework flag
> set, in which the generated workflow created the workspace by name+region.
> Under Contract 9 (id-by-variable), the generated `deploy`/`plan` target the
> workspace by `TAILOR_PLATFORM_WORKSPACE_ID` and never create it, so the flags
> that fed creation (`--workspace-region`, `--organization-id`, `--folder-id`)
> move to **provisioning** rather than the deploy workflow. The exact flag set
> after the rework is decided alongside the code changes.

| Flag                 | Alias | Required | Default                    | Semantics                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ----- | -------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--workspace-name`   | `-n`  | No       | Derived from `config.name` | Workspace name. 3-63 characters of lowercase letters, numbers, and hyphens; cannot start or end with a hyphen (same rule as `workspace create`).                                                                                                                                                                                                                                                                                                                                                                                     |
| `--workspace-region` | `-r`  | Yes      | —                          | Workspace region.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--organization-id`  | `-o`  | No       | None                       | Organization ID. Used only to create the workspace on the first deploy; omit when the workspace already exists (or when the machine user's default organization applies).                                                                                                                                                                                                                                                                                                                                                            |
| `--folder-id`        | `-f`  | No       | None                       | Folder placement, applied only on workspace creation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
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

## Contract 9 — Workspace resolution (id-by-variable) and provisioning

### Status: Design confirmed; implementation reworking #19/#1403 (replaces the name+region auto-create model)

**Resolution (steady state).** `deploy` and `plan` target the workspace by
**id**, read from the `TAILOR_PLATFORM_WORKSPACE_ID` Environment variable
(Contract 3). They **never resolve by name and never create** a workspace.

- `deploy`: if the variable is unset → hard error ("not provisioned"). Never
  creates. Deploys are rename-proof (a console rename does not change the id)
  and can run with workspace-level permission only.
- `plan`: reads the same id; if unset → reports "not provisioned yet" instead
  of running a dry-run.

**Provisioning.** Creating the workspace and writing its id into the variable
is a separate, deliberate step — the only place a workspace is created. Two
**independent** axes (pick one from each; the id flows 取得 → 設定):

- **取得 (obtain the id):**
  - **A1 — Terraform** `tailor_workspace` resource; the id is a computed
    attribute held in tfstate (rename-resilient: terraform reconciles name
    drift rather than duplicating). Needs org-level create permission.
  - **A2 — CI provision workflow** (Control Plane Machine User); creates at
    runtime when org-create permission exists only in CI.
  - **A3 — CLI**; an operator with org-create permission runs
    `tailor-sdk workspace create` locally.
  - **A4 — Console (manual)**; read an existing workspace's id from the
    console. **Not a `setup github` feature** — documented fallback only.
- **設定 (write the id into GitHub):**
  - **B1 — Terraform** (`github_actions_environment_variable`); also writes the
    machine-user secrets, so no GitHub App is needed.
  - **B2 — GitHub App**; the provision workflow writes the variable via an App
    token.
  - **B3 — Manual**; an operator sets the variable (`gh variable set --env` / UI).

Same tool/actor for 取得 and 設定 = direct (no handoff); different = the id must
be handed off (terraform reads it, or it is pasted in).

**Why id-by-variable (not name+region find-or-create).** Workspace `name` has
no uniqueness constraint, `workspace create` is not idempotent, and a console
rename keeps the id while changing the name (all confirmed in
`platform-core-services`). A name-based find-or-create can therefore silently
create a duplicate (after a rename) or match the wrong workspace (multi-match).
Targeting by a provisioned id removes this class of footgun, which is why
`deploy` never name-resolves or creates. (Because there is no name resolution
in `deploy`/`plan`, a multi-match guard is **not** needed there.)

**Terraform ownership boundary.** Terraform manages only the `tailor_workspace`
shell; the in-workspace resources (TailorDB types, auth, executors, …) are
owned by the SDK (`tailor-sdk deploy`). The same resource must not be managed by
both.

**Caveat (B2 GitHub App).** The App needs the `Environments: write` permission,
which is monolithic in GitHub: it also grants read/write of Environment
**secrets** and protection rules — there is no per-environment or
variables-only scoping. This must be documented wherever the App path is
described.

**No name+region stepping stone.** The name+region auto-create model (where the
deploy action created the workspace on first deploy) is **not** shipped as an
interim. #19/#1403 are reworked to id-by-variable directly so users never see
the footgun-prone model.

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

Behaviour (per target kind):

- Branch target: `dry-run: true` runs the plan job only; `dry-run: false`
  (default) runs the deploy job only. Plan and deploy are independent jobs on
  branch targets — deploys (including push deploys) are not gated on a plan,
  which is a PR-time check.
- Tag target: the plan job always runs; `dry-run: true` stops before the
  deploy job, `dry-run: false` (default) continues to deploy after the
  environment approval (if any).
- When `--no-plan` is set on a branch target, the `workflow_dispatch` trigger
  is still generated but `inputs:` is omitted (there is no plan job to run);
  every dispatch deploys.

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
  - Input: `api-url` (the application GraphQL URL from `tailor-deploy` outputs)
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

Templates generated by `setup github` pin **all** referenced actions to a
**full commit SHA with a version comment**, exactly like every third-party
action in the template. Moving tags (`@v1`) are **not** used: a committed
workflow must be reproducible and must pass the `unpinned-uses` / pin checks of
zizmor and ghalint. A generated-workflow check fails if any `uses:` is not
SHA-pinned. If Tailor-managed composite actions are introduced later, their
embedded SHA must correspond to a released `tailor-platform/actions` version
and be set/finalized as part of the coordinated release.

### SDK ↔ actions compatibility check (P1)

Starting in P1, `tailor-platform/actions` will validate that the SDK version
installed in the repository is at or above a minimum supported version. If the
check fails, the action will emit a clear error message such as:

> "This workflow was generated for `@tailor-platform/sdk` ≥ 1.x.x. The
> installed version is 0.y.z. Run `npm install @tailor-platform/sdk@latest` to
> upgrade."

---

## Appendix: Contract-to-implementation mapping

| Contract                | User guide section       | Lock field(s)                               | CLI flag(s)                  | Action input/output                                  |
| ----------------------- | ------------------------ | ------------------------------------------- | ---------------------------- | ---------------------------------------------------- |
| #1 Reserved ids         | Ownership rules          | `generatedIds`, `ejectedIds`                | —                            | job/step ids                                         |
| #2 Lock schema          | Generated files          | entire file                                 | —                            | —                                                    |
| #3 Secrets naming       | Secrets                  | `inputs.{organizationId,...}`               | —                            | `platform-client-id`, `platform-client-secret`       |
| #4 File naming          | Generated files          | `file`, `workspaceName`                     | `-n`                         | —                                                    |
| #5 Composite actions    | — (developer doc)        | `templateVersion`                           | —                            | action refs                                          |
| #6 Ownership model      | Ownership rules          | `generatedIds`, `ejectedIds`, `contentHash` | `--force`                    | —                                                    |
| #7 CLI flags            | Usage examples           | `inputs.*`                                  | all flags                    | `workspace-name`, `workspace-region`, etc.           |
| #8 Environments         | GitHub Environments      | `inputs.environment`                        | `--environment`              | —                                                    |
| #9 Workspace resolution | — (developer doc)        | (id not in lock)                            | provisioning flags           | `workspace-id` (from `TAILOR_PLATFORM_WORKSPACE_ID`) |
| #10 `workflow_dispatch` | Manual runs              | `inputs.plan`                               | `--no-plan`                  | `dry-run` input                                      |
| #11 Static site slots   | — (not in P0 user guide) | future `slots` field                        | future `--site`              | `api-url` input, `TAILOR_SITE_DIST_*` env            |
| #12 Preview naming      | — (not in P0 user guide) | future preview entry                        | `--preview`, `--name-prefix` | preview-comment                                      |
| #13 Semver + compat     | — (developer doc)        | `templateVersion`                           | —                            | min-sdk-version check                                |
