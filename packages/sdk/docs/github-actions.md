# GitHub Actions Integration

`tailor-sdk setup` generates a GitHub Actions workflow that deploys your
Tailor Platform application automatically on push or tag.

> **Beta:** This command is under active development. CLI flags, the generated
> workflow, and the `.github/tailor-sdk.lock` schema may change before general
> availability.

## Quick start

Run the command from the root of your SDK project (where `tailor.config.ts`
lives):

```bash
# Branch target: deploy to stg on every push to main
tailor-sdk setup -n my-app-stg

# Tag target: deploy to production when a tag is pushed, with an approval gate
tailor-sdk setup -n my-app-prod \
  --tag --branch main --environment production
```

`setup` defaults to the GitHub provider; `--provider github` (`-p github`) is
accepted but optional, and other providers are not yet supported.

After running the command, follow the **Next steps** printed to the terminal to
set the required secrets, set the `TAILOR_PLATFORM_WORKSPACE_ID` variable, and
commit the generated files.

The generated workflow deploys to whichever workspace its
`TAILOR_PLATFORM_WORKSPACE_ID` Environment variable points at — it never
creates or renames a workspace. Provision the workspace and set that variable
before the first deploy (see [Targeting a workspace](#targeting-a-workspace)).

## Targets

A _target_ is one workflow file that handles one deployment destination.
Run `setup` once per target.

### Branch target (recommended for staging)

The branch target fires on pull requests and pushes to the branch you specify
(defaulting to the repository's default branch when `--branch` is omitted):

```bash
tailor-sdk setup -n my-app-stg
# Equivalent to:
tailor-sdk setup -n my-app-stg --branch main
```

What it does:

- On **pull request**: runs `generate`, checks that generated files are
  committed (`generate-check`), and posts a deployment plan as a PR comment.
  (The plan and deploy jobs are independent; pull requests run plan only.)
- On **push to the branch**: deploys. The deploy action runs `generate` and
  applies the config; it does not re-run the PR plan.
- On **`workflow_dispatch`** with `dry-run: true`: runs plan only (useful for
  rollback verification — see [Rollback](#rollback)). With `dry-run: false`
  (default) it deploys, like a push.

Fork pull requests cannot read repository secrets. For forks, the plan step is
automatically skipped; `generate-check` and other non-secret checks still run.

#### ERD preview artifacts

Pass `--erd-preview` on a branch target to add TailorDB ERD preview artifacts
to pull requests:

```bash
tailor-sdk setup -n my-app-stg --erd-preview
```

The generated workflow builds a self-contained ERD viewer HTML file and a
visual ERD diff HTML file for each owned TailorDB namespace in
`tailor.config.ts`. The diff compares the pull request merge result with the
base branch, can switch between the current schema and highlighted diff, uploads
the HTML files as unarchived Actions artifacts, and upserts a PR comment with
artifact links.

ERD preview does not use Tailor Platform credentials. Fork pull requests still
build artifacts, but the comment step is skipped because fork tokens cannot
write PR comments.

`--erd-preview` is only available for branch targets with the plan job enabled;
it cannot be combined with `--tag` or `--no-plan`. The namespace list is
recorded in `.github/tailor-sdk.lock`; the pull request workflow compares the
head and base lock files so newly added or removed namespaces can still produce
all-added or all-removed diff artifacts. Re-run `setup` after adding or
removing TailorDB namespaces. `setup check` reports drift when the recorded ERD
preview namespaces no longer match the current config.

### Tag target (recommended for production)

The tag target fires when a tag matching `--tag-pattern` (default `v*`) is
pushed:

```bash
tailor-sdk setup -n my-app-prod \
  --tag --tag-pattern "v*" --branch main --environment production
```

What it does:

- **`tailor-tag-guard`** (generated when `--branch` is supplied): checks that
  the tagged commit is reachable from `main`. A tag on an unrelated commit is
  silently skipped, not an error.
- **`tailor-plan`**: runs `generate`, `generate-check`, and posts a plan
  summary to the Actions step summary (no PR comment, because there is no PR).
- **`tailor-deploy`**: waits for `tailor-plan`, then deploys. If the target
  environment has required reviewers configured, GitHub requires their approval
  before the deploy job starts.
- On **`workflow_dispatch`**: the `tailor-tag-guard` result is ignored — the
  plan job runs regardless of branch reachability (useful for rolling back to
  any tag). `dry-run: true` stops before the deploy job.

### Choosing `--branch` for the tag target

`--branch` has two different roles depending on the target kind:

| Target | Role of `--branch`                                                                             |
| ------ | ---------------------------------------------------------------------------------------------- |
| Branch | The branch that triggers the workflow (push + PR base). Defaults to the repo's default branch. |
| Tag    | The branch whose history the tag must be reachable from. Omit to disable the guard entirely.   |

The workspace name (`--workspace-name`, or the config `name` when omitted) must
be 3–63 characters of lowercase letters, numbers, and hyphens, and cannot start
or end with a hyphen. It is used for the generated file name, the workflow
`name:`, the plan label, and the default GitHub Environment name; it does not
select which workspace gets deployed (see
[Targeting a workspace](#targeting-a-workspace)).

## Targeting a workspace

The generated `plan` and `deploy` jobs target a workspace by **id**, read from
the `TAILOR_PLATFORM_WORKSPACE_ID` GitHub Environment variable. They never
resolve a workspace by name and never create one. Set this variable per
environment before the first deploy.

Because the variable is scoped to a GitHub Environment, both the `plan` and
`deploy` jobs declare `environment:` so the value resolves. When you omit
`--environment`, the environment name defaults to the workspace name.

1. Provision the workspace (once per environment) and obtain its id. For now
   this is a manual step:

   ```bash
   tailor-sdk workspace create   # copy the printed workspace id
   ```

2. Set the id as the Environment variable (the environment name is your
   `--environment` value, or the workspace name when omitted):

   ```bash
   gh variable set TAILOR_PLATFORM_WORKSPACE_ID --env my-app-stg
   ```

If `TAILOR_PLATFORM_WORKSPACE_ID` is unset, `deploy` fails because the target
workspace is not provisioned, and `plan` reports that the workspace is not
provisioned yet instead of running a dry-run.

If the target environment has required reviewers, that approval gate applies to
the `plan` job as well as `deploy`, because `plan` must enter the environment to
read the variable. (A token-based read that lets `plan` run without entering the
environment is planned.)

## Generated files

Running `setup` creates or updates:

### `.github/workflows/tailor-<workspace-name>.yml`

The workflow file. The `name:` field is set to `Tailor (<workspace-name>)` so
you can distinguish multiple workspaces in the Actions UI.

Jobs and steps whose `id` starts with `tailor-` are managed by the SDK. Do not
edit or rename them — the SDK tracks them by id.

You can add your own jobs and steps around the managed ones. To add
project-specific setup (such as private registry authentication or a system
dependency), add a step _before_ the managed `tailor-setup` step. For
post-install extras (such as `playwright install`), add a step _after_ it.

Note that re-running `setup` currently regenerates the whole file: if
the file differs from what the SDK last wrote — whether you edited a managed
step or added your own — the command stops and reports the conflict. Pass
`--force` to discard your edits and regenerate from the current template, then
re-apply your own steps. (Preserving user-added steps across regeneration is
planned.)

### `.github/tailor-sdk.lock`

A machine-owned JSON file that tracks which files the SDK manages, the inputs
they were generated from, and their content hashes. **Commit this file. Never
edit it by hand.** The SDK uses it to recognize its own files on re-runs and to
detect hand edits.

### `tailor.config.ts` (id injection)

If your config does not already have an `id` field, `setup` injects one.
This `id` must be committed alongside the workflow file. In CI, `tailor-sdk
deploy` refuses to inject a new id — if the id were assigned fresh on each CI
run, every deploy would create a brand-new application and lose ownership of
previously deployed resources.

If your pipeline intentionally deploys a fresh, throwaway application on every
run (for example an end-to-end test harness that creates and deletes its own
workspace), set `TAILOR_PLATFORM_SDK_ALLOW_CI_ID_INJECTION=true` to opt back
into automatic id injection for that pipeline.

## Secrets

The generated workflow reads two secrets:

| Secret                                       | Description                |
| -------------------------------------------- | -------------------------- |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID`     | Machine user client ID     |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET` | Machine user client secret |

Set them on the target GitHub Environment (the `--environment` value, or the
workspace name when omitted) with the GitHub CLI:

```bash
gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID --env my-app-stg
gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET --env my-app-stg
```

Setting them at the environment level isolates each target's credentials and
keeps them alongside that environment's `TAILOR_PLATFORM_WORKSPACE_ID`
variable. You can also set them as repository-level secrets if every target
shares one machine user.

## GitHub Environments (approval gate)

Both the `plan` and `deploy` jobs are associated with a GitHub Environment — the
`--environment` value, or the workspace name when omitted. The environment holds
that target's `TAILOR_PLATFORM_WORKSPACE_ID` variable and machine-user secrets,
and lets you:

- **Require reviewer approval** before the jobs run (suitable for production).
- **Scope secrets and the workspace-id variable** to specific environments so
  staging and production deploy to separate workspaces with separate machine
  users.

To configure the environment, go to your repository's **Settings → Environments**
and create an environment whose name matches the target's environment. Add
required reviewers, the `TAILOR_PLATFORM_WORKSPACE_ID` variable, and the
environment-scoped secrets there.

Required reviewers gate the `plan` job as well, because `plan` must enter the
environment to read `TAILOR_PLATFORM_WORKSPACE_ID`. (A token-based read that
lets `plan` run without entering the environment is planned.)

## Manual runs and dry-run

You can trigger the workflow manually from **Actions → Run workflow**. The
`dry-run` input (boolean, default `false`) runs the plan job without
deploying. Use this to preview what would change before executing a rollback
or an out-of-band deploy. With `dry-run` off, a branch-target dispatch goes
straight to deploy (like a push), while a tag-target dispatch runs plan first
and then deploys.

For tag targets, you can select any branch or tag when dispatching manually. The tag-guard check is skipped for manual dispatches, so
you can deploy any commit regardless of branch membership.

## Monorepo setup

For a monorepo where your SDK app lives in a subdirectory, pass `--dir`:

```bash
tailor-sdk setup -n my-app --dir apps/backend
```

The generated workflow adds a `paths` filter on `apps/backend/**` so the
workflow only runs when that subdirectory changes. The `working-directory` for
SDK commands is set accordingly.

## Rollback

`tailor-sdk deploy` is declarative: redeploying a past configuration returns
the platform to that state. The recommended rollback approaches are:

### Option 1 — Revert the commit (branch target)

```bash
git revert <commit-sha>
git push
```

The push triggers the deploy job, which applies the reverted configuration. To
preview the diff first, open the revert as a pull request (the plan job comments
the diff) or use a `dry-run: true` manual dispatch before merging.

### Option 2 — Advance the tag (tag target)

Move the production tag to an earlier commit:

```bash
git tag -f v1.2.3 <earlier-commit-sha>
git push --force-with-lease origin v1.2.3
```

Or create a new tag that points to the earlier commit:

```bash
git tag v1.2.4 <earlier-commit-sha>
git push origin v1.2.4
```

### Option 3 — Manual dispatch with dry-run verification

1. Go to **Actions → `Tailor (<workspace-name>)` → Run workflow**.
2. Enter the tag or ref you want to redeploy.
3. Set `dry-run` to `true` and run. Inspect the plan output.
4. Run again with `dry-run` set to `false`.

For tag targets, the tag-guard step is bypassed on manual dispatch, so you can
dispatch from any ref. Environment approval (if configured) applies as usual.

### Rollback limitations

- **Schema and data are not rolled back.** If the older config expects a schema
  state that no longer exists, the plan may show errors. In that case, review
  the diff carefully before proceeding.
- **Seed data** is not part of the deployment pipeline and is unaffected by
  rollbacks.
- **Static websites** are not yet integrated into the generated pipeline.
  Static asset rollbacks must be performed manually.

## Multi-environment example

A typical setup with staging and production:

```bash
# Staging: main → stg (deploy on every push to main)
tailor-sdk setup -n my-app-stg

# Production: tagged commits → prod, with approval gate and branch guard
tailor-sdk setup -n my-app-prod \
  --tag --branch main --environment production
```

Then provision each workspace and set its id on the matching environment (the
staging target's environment defaults to `my-app-stg`; production uses
`production`):

```bash
gh variable set TAILOR_PLATFORM_WORKSPACE_ID --env my-app-stg
gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID --env my-app-stg
gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET --env my-app-stg

gh variable set TAILOR_PLATFORM_WORKSPACE_ID --env production
gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID --env production
gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET --env production
```

Commit both workflow files and `.github/tailor-sdk.lock`.

## Checking for drift

`tailor-sdk setup check` audits the workflows recorded in
`.github/tailor-sdk.lock` against your current config and repository, without
writing anything. It reports when a workflow file is missing or hand-edited, a
newer template is available, `tailor.config.ts` is no longer under the recorded
`--dir`, or the repository default branch no longer matches a branch target's
trigger. It exits non-zero when it finds drift, so you can run it in CI. Each
finding names a stable rule key for future suppression.

## Updating the generated workflow

When you upgrade the SDK, re-run `setup` with the same flags to pick up
template improvements. If the SDK detects that you have hand-edited a managed
section, it stops and asks you to use `--force` to overwrite your edits, or to
move your customizations into your own steps before regenerating.

The `.github/tailor-sdk.lock` file records the flags used at generation time,
so you can check what arguments were used previously.
