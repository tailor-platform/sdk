# GitHub Actions Integration

`tailor-sdk setup github` generates a GitHub Actions workflow that deploys your
Tailor Platform application automatically on push or tag.

> **Beta:** This command is under active development. CLI flags, the generated
> workflow, and the `.github/tailor-sdk.lock` schema may change before general
> availability.

## Quick start

Run the command from the root of your SDK project (where `tailor.config.ts`
lives):

```bash
# Branch target: deploy to stg on every push to main
tailor-sdk setup github -o <org-id> -r <region> -n my-app-stg

# Tag target: deploy to production when a tag is pushed, with an approval gate
tailor-sdk setup github -o <org-id> -r <region> -n my-app-prod \
  --tag --branch main --environment production
```

After running the command, follow the **Next steps** printed to the terminal to
set the required secrets and commit the generated files.

## Targets

A _target_ is one workflow file that handles one deployment destination.
Run `setup github` once per target.

### Branch target (recommended for staging)

The branch target fires on pull requests and pushes to the branch you specify
(defaulting to the repository's default branch when `--branch` is omitted):

```bash
tailor-sdk setup github -o <org-id> -r <region> -n my-app-stg
# Equivalent to:
tailor-sdk setup github -o <org-id> -r <region> -n my-app-stg --branch main
```

What it does:

- On **pull request**: runs `generate`, checks that generated files are
  committed (`generate-check`), and posts a deployment plan as a PR comment.
- On **push to the branch**: runs the same checks, then deploys.
- On **`workflow_dispatch`** with `dry-run: true`: runs plan only (useful for
  rollback verification — see [Rollback](#rollback)).

Fork pull requests cannot read repository secrets. For forks, the plan step is
automatically skipped; `generate-check` and other non-secret checks still run.

### Tag target (recommended for production)

The tag target fires when a tag matching `--tag-pattern` (default `v*`) is
pushed:

```bash
tailor-sdk setup github -o <org-id> -r <region> -n my-app-prod \
  --tag --tag-pattern "v*" --branch main --environment production
```

What it does:

- **`tailor-tag-guard`** (generated when `--branch` is supplied): checks that
  the tagged commit is reachable from `main`. A tag on an unrelated commit is
  silently skipped, not an error.
- **`tailor-plan`**: runs `generate`, `generate-check`, and posts a plan
  summary to the Actions step summary (no PR comment, because there is no PR).
- **`tailor-deploy`**: waits for `tailor-plan`, then deploys. When
  `--environment` is set, GitHub requires the environment's required reviewers
  to approve before the deploy job starts.
- On **`workflow_dispatch`**: `tag-guard` is bypassed (useful for rollbacks
  from any ref). `dry-run: true` stops before the deploy job.

### Choosing `--branch` for the tag target

`--branch` has two different roles depending on the target kind:

| Target | Role of `--branch`                                                                             |
| ------ | ---------------------------------------------------------------------------------------------- |
| Branch | The branch that triggers the workflow (push + PR base). Defaults to the repo's default branch. |
| Tag    | The branch whose history the tag must be reachable from. Omit to disable the guard entirely.   |

## Generated files

Running `setup github` creates or updates:

### `.github/workflows/tailor-<workspace-name>.yml`

The workflow file. The `name:` field is set to `Tailor (<workspace-name>)` so
you can distinguish multiple workspaces in the Actions UI.

Jobs and steps whose `id` starts with `tailor-` are managed by the SDK. Do not
edit or rename them — the SDK tracks them by id.

You can add your own jobs and steps around the managed ones. To add
project-specific setup (such as private registry authentication or a system
dependency), add a step _before_ the managed setup steps. For post-install
extras (such as `playwright install`), add a step _after_ them.

Note that re-running `setup github` currently regenerates the whole file: if
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

If your config does not already have an `id` field, `setup github` injects one.
This `id` must be committed alongside the workflow file. In CI, `tailor-sdk
deploy` refuses to inject a new id — if the id were assigned fresh on each CI
run, every deploy would create a brand-new application and lose ownership of
previously deployed resources.

## Secrets

The generated workflow reads two secrets:

| Secret                                       | Description                |
| -------------------------------------------- | -------------------------- |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID`     | Machine user client ID     |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET` | Machine user client secret |

Set them with the GitHub CLI:

```bash
gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID
gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET
```

When `--environment <env>` is used, set secrets at the environment level so
they are isolated from other targets:

```bash
gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID --env production
gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET --env production
```

## GitHub Environments (approval gate)

When you pass `--environment <env>`, the deploy job is associated with a GitHub
Environment. This lets you:

- **Require reviewer approval** before the deploy runs (suitable for
  production).
- **Scope secrets** to specific environments so staging and production use
  separate machine users.

To configure the environment, go to your repository's **Settings → Environments**
and create an environment whose name matches the `--environment` value you
passed to `setup github`. Add required reviewers and environment-scoped secrets
there.

## Manual runs and dry-run

You can trigger the workflow manually from **Actions → Run workflow**. The
`dry-run` input (boolean, default `false`) runs the plan job without
proceeding to deploy. Use this to preview what would change before executing
a rollback or an out-of-band deploy.

For tag targets, you can select any branch or tag when dispatching manually. The tag-guard check is skipped for manual dispatches, so
you can deploy any commit regardless of branch membership.

## Monorepo setup

For a monorepo where your SDK app lives in a subdirectory, pass `--dir`:

```bash
tailor-sdk setup github -o <org-id> -r <region> -n my-app --dir apps/backend
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

The push triggers the normal pipeline. The plan job previews the diff; the
deploy job applies it after the plan succeeds.

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
tailor-sdk setup github -o <org-id> -r <region> -n my-app-stg

# Production: tagged commits → prod, with approval gate and branch guard
tailor-sdk setup github -o <org-id> -r <region> -n my-app-prod \
  --tag --branch main --environment production
```

Commit both workflow files and `.github/tailor-sdk.lock`.

## Updating the generated workflow

When you upgrade the SDK, re-run `setup github` with the same flags to pick up
template improvements. If the SDK detects that you have hand-edited a managed
section, it stops and asks you to use `--force` to overwrite your edits, or to
move your customizations into your own steps before regenerating.

The `.github/tailor-sdk.lock` file records the flags used at generation time,
so you can check what arguments were used previously.
