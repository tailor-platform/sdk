# GitHub Actions Integration

`tailor setup` generates GitHub repository automation for your Tailor Platform
application, including deploy workflows and Renovate configuration.

> **Beta:** This command is under active development. CLI flags, the generated
> workflow, and the `.github/tailor.lock` schema may change before general
> availability.

## Installation

The `setup` commands are provided by the `@tailor-platform/sdk-plugin-setup` CLI
plugin. Install it next to the SDK:

```bash
npm install -D @tailor-platform/sdk-plugin-setup
```

The Tailor CLI discovers the plugin automatically from `node_modules/.bin` (or
your `PATH`). Run `tailor plugin list` to confirm it resolves.

## Quick start

Run the command from the root of your SDK project (where `tailor.config.ts`
lives):

```bash
# Branch target: deploy to stg on every push to main
tailor setup ci branch --name my-app-stg

# Tag target: deploy to production when a tag is pushed, with an approval gate
tailor setup ci tag --name my-app-prod \
  --branch main --environment production
```

After running the command, follow the **Next steps** printed to the terminal:
run `tailor setup ci env` to get the commands that set the secrets and
variables each GitHub Environment needs (see
[Setting secrets and variables](#setting-secrets-and-variables)), then commit
the generated files.

The generated workflow deploys to whichever workspace its
`TAILOR_PLATFORM_WORKSPACE_ID` Environment variable points at — it never
creates or renames a workspace. Provision the workspace and set that variable
before the first deploy (see [Targeting a workspace](#targeting-a-workspace)).

## Targets

A _target_ is one workflow file that handles one deployment destination.
Run `setup` once per target.

### Branch target (recommended for staging)

The branch target fires on pull requests and pushes to the branch you specify
(defaulting to the repository's default branch when `--target` is
omitted):

```bash
tailor setup ci branch --name my-app-stg
# Equivalent to:
tailor setup ci branch --name my-app-stg --target main
```

What it does:

- On **pull request**: runs `generate`, checks that generated files are
  committed (`generate-check`), and posts a deployment plan as a PR comment.
  (The plan and deploy jobs are independent; pull requests run plan only.)
- On **push to the branch**: deploys. The deploy action runs `generate` and
  applies the config; it does not re-run the PR plan.
- On **`workflow_dispatch`** with `dry-run: true`: runs plan only (useful for
  rollback verification — see [Rollback](#rollback)). With `dry-run: false`
  (default) it deploys the selected branch, like a push. Pass
  `--restrict-dispatch` to deploy only the target branch this way (see
  [Restricting manual deploys](#restricting-manual-deploys)).

Fork pull requests cannot read repository secrets. For forks, the plan step is
automatically skipped; `generate-check` and other non-secret checks still run.

#### ERD preview artifacts

Pass `--erd-preview` on a branch target to add TailorDB ERD preview artifacts
to pull requests:

```bash
tailor setup ci branch --name my-app-stg --erd-preview
```

The generated workflow runs `tailor tailordb erd`, which is provided by the
`@tailor-platform/sdk-plugin-tailordb-erd` CLI plugin — install it as a
dev-dependency in your project:

```bash
npm install -D @tailor-platform/sdk-plugin-tailordb-erd
```

The generated workflow builds one self-contained ERD viewer HTML file for each
owned TailorDB namespace in `tailor.config.ts`. The viewer compares the pull
request merge result with the base branch, can switch between the current schema
and highlighted diff, uploads the HTML files as unarchived Actions artifacts,
and upserts a PR comment with artifact links.

ERD preview does not use Tailor Platform credentials. Fork pull requests still
build artifacts, but the comment step is skipped because fork tokens cannot
write PR comments.

`--erd-preview` is only available for branch targets. The namespace list is
recorded in `.github/tailor.lock`; the pull request workflow compares the head
and base lock files so newly added or removed namespaces can still produce
all-added or all-removed viewer artifacts. Re-run `setup ci branch` after adding or
removing TailorDB namespaces. `setup check` reports drift when the recorded ERD
preview namespaces no longer match the current config.

### Tag target (recommended for production)

The tag target fires when a tag matching `--tag-pattern` (default `v*`) is
pushed:

```bash
tailor setup ci tag --name my-app-prod \
  --tag-pattern "v*" --branch main --environment production
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
  any tag). `dry-run: true` stops before the deploy job. With
  `--restrict-dispatch`, the deploy job runs only for a tag that passes the
  guard (see [Restricting manual deploys](#restricting-manual-deploys)).

### Choosing `--branch` for the tag target

The branch each target reads plays a different role, under a different flag:

| Target | Flag       | Role                                                                                           |
| ------ | ---------- | ---------------------------------------------------------------------------------------------- |
| Branch | `--target` | The branch that triggers the workflow (push + PR base). Defaults to the repo's default branch. |
| Tag    | `--branch` | The branch whose history the tag must be reachable from. Omit to disable the guard entirely.   |

The workspace name (`--name`, or the config `name` when omitted) must
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
   tailor workspace create   # copy the printed workspace id
   ```

2. Set the id as the Environment variable (the environment name is your
   `--environment` value, or the workspace name when omitted).
   `tailor setup ci env` prints this command together with the other secrets
   and variables each environment needs (see
   [Setting secrets and variables](#setting-secrets-and-variables)):

   ```bash
   gh variable set TAILOR_PLATFORM_WORKSPACE_ID --env=my-app-stg
   ```

If `TAILOR_PLATFORM_WORKSPACE_ID` is unset, `deploy` fails because the target
workspace is not provisioned, and `plan` reports that the workspace is not
provisioned yet instead of running a dry-run.

If the target environment has required reviewers, that approval gate applies to
the `plan` job as well as `deploy`, because `plan` must enter the environment to
read the variable. (A token-based read that lets `plan` run without entering the
environment is planned.)

## Generated files

Running a workflow setup subcommand creates or updates:

### `.github/workflows/tailor-<workspace-name>.yml`

The workflow file. The `name:` field is set to `Tailor (<workspace-name>)` so
you can distinguish multiple workspaces in the Actions UI.

Every checkout in the workflow sets `persist-credentials: false`, so the GitHub
token is not left in `.git/config` while the job installs and runs your
project's code. The tag guard step passes the job token only to its
`git fetch`, and the plan step passes it to its `git fetch` and to the step that
posts the plan comment on the pull request; neither writes it to `.git/config`.
If installing your dependencies fetches git repositories
that require authentication, configure the credentials in your own step.

See [Customizing the generated workflow](#customizing-the-generated-workflow)
for what you can edit.

### Customizing the generated workflow

The SDK owns the jobs and steps whose `id` starts with `tailor-`, and the
top-level keys it writes (`name:`, `on:`, and `permissions:` in a workflow; the
metadata, inputs, and outputs of a composite action). Do not edit or rename
them. Everything else is yours, and re-running `setup` keeps it:

- **Your own jobs and steps.** Add them anywhere, with an `id` (if any) that
  does not start with `tailor-`: the prefix is reserved for the SDK, even in a
  job of your own. A step you add inside a managed job stays right after the managed step it
  followed. For example, add private registry authentication or a system
  dependency _before_ the managed `tailor-setup` step, and post-install extras
  (such as `playwright install`) _after_ it. A job of your own can depend on a
  managed job with `needs: tailor-deploy`.
- **Your own top-level keys**, such as a workflow-level `env:` or `defaults:`.
- **Runtime settings of managed jobs:** `runs-on`, `timeout-minutes`,
  `container`, and `env`. On a managed job generated without an
  `environment:` (such as `tailor-tag-guard` or `tailor-erd-preview`), you can
  also add one, for example so a step you added there can read that GitHub
  Environment's secrets. The `environment:` of `tailor-plan`, `tailor-deploy`,
  and the preview jobs comes from `--environment`, so change it with that
  option instead.
- **These inputs of managed steps:** `ignore` on `tailor-generate-check` and
  `tailor-drift-check`, `fail-on-drift` on `tailor-drift-check`,
  `install-command` on `tailor-install`, `node-version-file` on
  `tailor-setup`, `label` on `tailor-plan`, and `user-mapping` on
  `tailor-notify` and on a coordinator's steps that call an app action.
- **The `run:` command of the `tailor-build-site` step** in a composite action.

In a preview workflow, the `tailor-preview-deploy` job exposes the per-PR
workspace as the outputs `workspace-id`, `workspace-name`, and `app-url`, so a
job of your own can run tests or deploy extra assets against it:

```yaml
deploy-assets:
  needs: tailor-preview-deploy
  runs-on: ubuntu-latest
  environment: my-app
  env:
    TAILOR_PLATFORM_WORKSPACE_ID: ${{ needs.tailor-preview-deploy.outputs.workspace-id }}
    TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID: ${{ secrets.TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID }}
    TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET: ${{ secrets.TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET }}
  steps:
    # checkout, dependency installation, and your tailor commands
```

A job that runs `tailor` against the workspace needs the machine-user
[secrets](#secrets), so it declares the preview target's GitHub Environment
(the `--environment` value, or the workspace name when omitted) as above. A job
that only uses `app-url`, such as end-to-end tests, does not.

The job is skipped whenever `tailor-preview-deploy` is skipped: when a pull
request is closed, for draft and fork pull requests, and for unlabeled ones with
`--require-preview-label`.

Likewise, the `tailor-deploy` job of a branch or tag workflow exposes the
deployed workspace as the outputs `workspace-id` and `app-url` to a job with
`needs: tailor-deploy`. Reading them does not require the target's GitHub
Environment; a job that runs `tailor` against the workspace declares it for the
machine-user secrets, as in the preview example above.

Comments above your own jobs and steps and at the end of the file are kept too.
Comments inside managed jobs and steps, and edits to the header comment, are
not kept.

`setup check` reports an edit to a managed part, and re-running `setup` stops
on it; both name the edited job, step, or top-level key. Revert the edit, or
pass `--force` to reset the managed parts to the current template; `--force`
still keeps your own jobs, steps, and settings. A managed step you renamed to
an id without the `tailor-` prefix counts as your own, so `--force` adds the
managed one back next to it; rename it back instead of forcing. A managed job
you renamed still holds the SDK's `tailor-` steps, so `setup check` reports
them as reserved ids and `setup` stops on them, even with `--force`; rename the
job back. To start over from a clean template, delete the file and re-run
`setup`.

When a template update removes a managed job that contains steps of yours, or
a job of yours `needs` a removed job, `setup` stops and names them. Move those
steps into a job of your own (or update the `needs`) and re-run. `--force` drops
steps left inside a removed job.

`setup check` reports a job or step of yours whose `id` starts with `tailor-`,
and re-running `setup` stops on it, naming the id. Rename it; `--force` does
not rename or remove it.

Files generated by an older SDK version are compared as a whole, so the first
re-run after upgrading stops if you edited the file in any way. Re-run once with
`--force` to switch it to this model; your own jobs and steps are kept.

### `.github/tailor.lock`

A machine-owned JSON file that tracks which files the SDK manages, the inputs
they were generated from, and their content hashes, plus the id of every app in
the repository (see [App id](#app-id)). **Commit this file.** The SDK uses it to
recognize its own files on re-runs and to detect hand edits. The only part
meant for hand editing is `appIds`, and only to re-key an entry after moving an
app directory or to delete the entry of a removed app.

### App id

Every application has a stable id (a UUID) that the SDK uses to recognize the
resources it owns across renames. In a repository set up with `tailor setup`,
the id lives in `.github/tailor.lock` under `appIds`, keyed by the config
file's repository-relative path:

```jsonc
{
  "version": 2,
  "targets": [/* generated workflows */],
  "appIds": {
    "apps/order/tailor.config.ts": "d0a3398a-…",
    "apps/billing/tailor.config.ts": "7f21c4e0-…",
  },
}
```

`setup` records the id when it generates a workflow, and a local `tailor
deploy` records one for any config that has none yet. Because the key is the
config path, renaming the app keeps its id, and copying a config to a new
directory gives the copy a fresh id instead of the original's. If
`tailor.config.ts` still has an `id` field from before, `setup` or a local
`deploy` moves it into the lock and removes it from the config; a config `id`
that disagrees with the lock stops the command so you can decide which value
to keep.

In CI, `tailor deploy` never assigns an id — if one were assigned fresh on
each run, every deploy would create a brand-new application and lose ownership
of previously deployed resources. A config without a recorded id fails the
plan job with instructions to run `tailor deploy` locally and commit the lock.
If your pipeline intentionally deploys a fresh, throwaway application on every
run (for example an end-to-end test harness that creates and deletes its own
workspace), set `TAILOR_CI_ALLOW_ID_INJECTION=true` to let CI assign one.

When you move an app directory, its `appIds` entry still points at the old
path. Locally, `deploy` and `setup` notice the single unmatched entry and ask
whether the app was moved; answering yes re-keys the entry so the app keeps
its id. In CI, or when more than one entry is unmatched, the command stops and
asks you to re-key the entry (or delete entries of removed apps) by hand.
Re-run the relevant `setup` subcommand as well so the workflow's paths follow
the move.

## Secrets

The generated workflow requires two secrets (the optional Slack token is listed in
[Setting secrets and variables](#setting-secrets-and-variables)):

| Secret                                       | Description                |
| -------------------------------------------- | -------------------------- |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID`     | Machine user client ID     |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET` | Machine user client secret |

Set them on the target GitHub Environment (the `--environment` value, or the
workspace name when omitted); `tailor setup ci env` prints the commands (see
[Setting secrets and variables](#setting-secrets-and-variables)).

Setting them at the environment level isolates each target's credentials and
keeps them alongside that environment's `TAILOR_PLATFORM_WORKSPACE_ID`
variable. You can also set them as repository-level secrets if every target
shares one machine user, but then any workflow on any branch can read them, so
the environment's protection rules no longer guard your deploys.

### Setting secrets and variables

`tailor setup ci env` reads `.github/tailor.lock` and prints, for every GitHub
Environment the generated workflows use, the commands that create the
environment (only when it does not exist yet) and set its secrets and
variables. It is read-only, so re-run it whenever you add a target. When the
`origin` remote points at github.com, the output names that repository, so the
commands work from any directory; otherwise `gh` resolves the repository from
the current directory and the Terraform output leaves it as a placeholder.

```bash
tailor setup ci env                          # gh CLI commands (default)
tailor setup ci env --format terraform       # Terraform for the integrations/github provider
tailor setup ci env --environment my-app-stg # only one environment (repeat for several)
```

The list follows what each generated workflow actually reads:

| Name                                         | Kind     | Targets                 | Required | Where the value comes from                                                                                                                                                                                                                                                                                      |
| -------------------------------------------- | -------- | ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID`     | secret   | all                     | yes      | Client ID of the platform machine user CI signs in as; it needs an editor or admin role on the organization or folder that holds the workspace. An organization or folder admin creates one in the Tailor Console and grants it a role; without the required permission you cannot view or create machine users |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET` | secret   | all                     | yes      | Client secret of the same platform machine user                                                                                                                                                                                                                                                                 |
| `TAILOR_PLATFORM_WORKSPACE_ID`               | variable | branch, tag, coordinate | yes      | `id` printed by `tailor workspace create`, or listed by `tailor workspace list`                                                                                                                                                                                                                                 |
| `TAILOR_PLATFORM_ORGANIZATION_ID`            | variable | preview                 | yes      | Organization to create the per-PR workspaces in (a machine user cannot create a workspace without one): `organizationId` listed by `tailor organization list`                                                                                                                                                   |
| `TAILOR_PLATFORM_FOLDER_ID`                  | variable | preview                 | no       | Folder to create the per-PR workspaces in: `id` listed by `tailor organization folder list -o <organization id>`. When unset they go directly under the organization, which needs the machine user's role on the organization itself                                                                            |
| `TAILOR_PLATFORM_FAIL_ON_DRIFT`              | variable | all                     | no       | `true` to fail the drift check when it finds drift                                                                                                                                                                                                                                                              |
| `TAILOR_SLACK_BOT_TOKEN`                     | secret   | branch, tag, coordinate | no       | Bot User OAuth Token (`xoxb-...`) of a Slack app with the `chat:write` scope                                                                                                                                                                                                                                    |
| `TAILOR_SLACK_CHANNEL_ID`                    | variable | branch, tag, coordinate | no       | Channel ID (`C...`) from the channel details in Slack; invite the bot to the channel                                                                                                                                                                                                                            |
| `TAILOR_SLACK_USER_MAPPING`                  | variable | branch, tag             | no       | JSON object mapping GitHub usernames to Slack member IDs (for example `{"alice":"U0123456"}`) so notifications mention the actor; read only after you uncomment the `user-mapping` input of the `tailor-notify` step                                                                                            |

See [Account management](https://docs.tailor.tech/administration/account-management)
for how organizations, folders, workspaces, and machine users relate.

Composite actions (`setup ci action`) read nothing themselves; the coordinator
that calls them does. Set `TAILOR_SLACK_BOT_TOKEN` and `TAILOR_SLACK_CHANNEL_ID`
together to enable Slack deploy notifications.

The `gh` output creates an environment only when GitHub reports it missing and
leaves optional entries commented out. Run the commands one at a time: each
`gh secret set` / `gh variable set` prompts for its value.

The Terraform output takes every value from an input variable (secrets are
`sensitive`) and creates an optional entry only when its variable is set, so no
value is written to the output. Terraform still stores the secret values in its
state in plain text, so keep the state encrypted and access-restricted, or set
the secrets with the `gh` output instead. Its header lists the steps with the variable
names for your environments: authenticate the provider, put non-secret values in
`terraform.tfvars`, pass secrets as `TF_VAR_<name>` environment variables, and
import each environment and variable that already exists (for example
`terraform import github_repository_environment.production my-repo:production`)
before `terraform apply`: creating a variable that already exists fails, while
secrets are overwritten. The generated environments ignore changes to their
protection settings (reviewers, wait timer, branch policy), so importing an
environment keeps the approval gate you configured; remove the `lifecycle` block
to manage those settings in Terraform instead.

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

By default you can select any branch or tag when dispatching manually, and it
deploys that ref. For tag targets, the tag-guard check is skipped for manual
dispatches, so you can deploy any commit regardless of branch membership.

### Restricting manual deploys

Pass `--restrict-dispatch` to `setup ci branch`, `setup ci tag`, or
`setup ci coordinate` to limit what a manual dispatch with `dry-run` off can
deploy:

- **Branch target:** only the target branch. Dispatching another branch skips
  the deploy job.
- **Tag target:** only a tag. With `--branch`, the tag must also pass the
  reachability guard. The tag does not have to match `--tag-pattern`.

Dry runs stay available from any ref. Re-run `setup` with the flag each time you
regenerate the workflow; it is not carried over from the previous run.

The flag guards against deploying the wrong ref by mistake. It is not an access
control: a manual dispatch runs the workflow file from the selected ref, so
anyone who can push a branch can remove the check there. To enforce which refs
can deploy, configure **Deployment branches and tags** on the target's GitHub
Environment and keep the machine-user secrets on that environment. Because the
plan job also enters the environment, allow `refs/pull/*/merge` as well so pull
request plans keep running, and note that dry runs from other branches are then
rejected too.

## Monorepo setup

For a monorepo where your SDK app lives in a subdirectory, pass `--dir`:

```bash
tailor setup ci branch --name my-app --dir apps/backend
```

The `working-directory` for SDK commands is set accordingly, and the workflow
only plans and deploys when that subdirectory changes. The workflow itself
starts on every pull request and push: a `tailor-changes` job checks whether
the change touches `apps/backend/**`, and the plan, deploy, and ERD preview jobs
are skipped when it does not. A skipped job reports success, so you can make
these checks required in branch protection; a workflow that a `paths` trigger
filter never started would leave them pending instead. If the `tailor-changes` job
itself fails (for example, on a GitHub API error), the plan, deploy, and ERD
preview jobs fail too instead of being skipped, so a required check blocks
merging and nothing is deployed. Re-run the failed jobs once the cause is gone.

### Deploying several apps together

To deploy several apps to the same workspace from one workflow, repeat `--dir`
and pass `--name` for the workflow:

```bash
tailor setup ci branch --name erp --dir apps/erp/backend --dir apps/users/backend
```

`setup ci branch`, `setup ci tag`, and `setup ci preview` accept repeated
`--dir`. The workflow plans and deploys every app's `tailor.config.ts` in one
[multi-config deploy](./cli/application.md#deploy) from the repository root, so
an app can reference resources of another app with `external: true`. Add
`@tailor-platform/sdk` to the root `package.json` so the `tailor` CLI resolves
there; setup stops until it is declared. The generate check runs for each app
directory, as do seed validation and the migration drift check on branch and tag
workflows, and a change under any app directory runs the workflow's jobs.

With `--erd-preview`, each TailorDB namespace is previewed from the app that
owns it. A namespace may be owned by only one app; the others reference it with
`external: true`.

With more than one app, the preview comment does not link an application URL.

### Running on changes outside the app directories

When the apps depend on code outside their directories, such as a frontend or
shared packages, add those paths with `--paths` on `setup ci branch` or
`setup ci preview`. Repeat it for each pattern:

```bash
tailor setup ci preview --name erp --region asia-northeast \
  --dir apps/erp/backend --dir apps/users/backend \
  --paths "apps/*/frontend/**" --paths "modules/**" --paths pnpm-lock.yaml
```

The patterns are checked after the app directories, in order, and the last
pattern that matches a changed file decides whether it counts. `*` matches
within one path segment, `**` matches any number of segments, and a pattern
starting with `!` excludes matching paths, so it can also exclude files inside
an app directory, for example `--paths '!apps/erp/backend/**/*.md'`. Other glob
characters (`?`, `+`, `[ ]`, `{ }`, `( )`, and `\`) are not supported, and
`setup ci` rejects a pattern that contains them. An app at the repository root already
runs on every change, so `--paths` is not accepted with `--dir .`.

## Rollback

`tailor deploy` is declarative: redeploying a past configuration returns
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
With `--restrict-dispatch`, step 4 deploys only a tag that passes the guard, and
a branch target deploys only its target branch, so use Option 1 there.

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
tailor setup ci branch --name my-app-stg

# Production: tagged commits → prod, with approval gate and branch guard
tailor setup ci tag --name my-app-prod \
  --branch main --environment production
```

Then provision each workspace and set its id and the machine-user credentials
on the matching environment (the staging target's environment defaults to
`my-app-stg`; production uses `production`). `tailor setup ci env` prints the
commands for both environments:

```bash
tailor setup ci env
```

Commit both workflow files and `.github/tailor.lock`.

## Keeping dependencies and actions updated

Run this command once from the repository root to add Renovate configuration:

```bash
tailor setup deps
```

It generates `renovate.json`, which extends Tailor's shared Renovate preset. The
preset groups `@tailor-platform/*` package updates into one pull request and
lets Renovate update the SHA-pinned GitHub Actions used by generated workflows.
Enable Renovate for the repository by following the
[Renovate onboarding guide](https://docs.renovatebot.com/getting-started/installing-onboarding/),
then commit the generated file.

If the repository already has Renovate configuration, the command adds
`github>tailor-inc/renovate-config` to its `extends` array in place instead of
writing a new file, leaving your other settings untouched. It checks Renovate's
standard root, `.github`, `.gitlab`, and `.renovaterc` locations, including the
deprecated `package.json` configuration. When that configuration already extends
the preset, the command reports that Renovate is set up and changes nothing.

JSONC and JSON5 configurations are updated in place while preserving their
comments and formatting. Configurations that Renovate itself cannot load — such
as invalid syntax, or duplicate keys outside JSON5 — are left unchanged and
reported for manual inspection.

`renovate.json` is yours to edit — it is not tracked in `.github/tailor.lock`.
Add your own rules freely; re-running `tailor setup deps` does not overwrite
them. To remove it, delete the file.

Renovate updates the SDK dependency and action pins, but it does not regenerate
the workflow template. After an SDK update, `tailor setup check` reports a
template-version warning until you run
[`tailor setup update`](#updating-the-generated-workflow).

## Checking for drift

`tailor setup check` audits the workflows recorded in
`.github/tailor.lock` against your current config and repository, without
writing anything. It reports when a workflow file is missing or its SDK-managed
parts were edited by hand, a job or step of yours uses the reserved `tailor-`
prefix, a newer template is available, `tailor.config.ts` is no longer under the recorded
`--dir`, or the repository default branch no longer matches a branch target's
trigger. It exits non-zero when it finds drift, so you can run it in CI. Each
finding names a stable rule key for future suppression. Run
[`tailor setup update`](#updating-the-generated-workflow) to regenerate the
targets it reports.

Workflows generated by `setup ci branch`, `setup ci tag`, `setup ci preview`, and
`setup ci coordinate` self-audit: each contains a `tailor-drift-check` step that
runs the check in CI. Preview workflows run it alongside each preview deploy,
so pull requests that deploy no preview (drafts, fork PRs, and unlabeled PRs
in label-triggered mode) skip the check. A single run audits every target
recorded in `.github/tailor.lock`, so per-app composite actions generated by
`setup ci action` are covered by their coordinator's step and do not carry one
of their own.

Drift findings are advisory by default. Set the repository variable
`TAILOR_PLATFORM_FAIL_ON_DRIFT` to `true` to make unsuppressed findings fail
the job. Execution and configuration errors fail regardless of this variable.

`check` compares only the generated files, `.github/tailor.lock`, and the
config; it does not read the GitHub Environment secrets and variables, so it
runs the same on your own machine and in CI. Run `tailor setup ci env` to list
what each environment needs.

## Updating the generated workflow

When you upgrade the SDK, run `tailor setup update` from the repository root to
pick up template improvements:

```bash
tailor setup update
```

It regenerates every workflow and composite action recorded in
`.github/tailor.lock` with the flags each one was generated with, so you do not
have to re-type `setup ci branch`, `setup ci tag`, and the rest one by one.
Your own jobs, steps, and settings are kept (see
[Customizing the generated workflow](#customizing-the-generated-workflow)). A
branch that was detected from the repository default branch is detected again,
and the parts that follow your config — the migration drift check, seed
validation, static website builds, and ERD preview namespaces — are derived
from the current `tailor.config.ts`.

A target that cannot be regenerated, for example because you edited a managed
part, does not stop the others: `update` regenerates the rest, then lists the
targets it could not update and exits non-zero. Revert the edit, or run
`tailor setup update --force` to reset the managed parts of every target.

Coordinators generated by an older plugin version did not record how their
`--action` values were grouped, so `update` lists them instead of guessing
which apps deploy together. Re-run `tailor setup ci coordinate` once with all
of its original flags and its original `--action` groups. The message `update`
prints fills in the recorded flags (`--tag`, `--branch`, `--environment`,
`--restrict-dispatch`), so you only add the `--action` values. Later updates
pick the grouping up from the lock.

To change a flag for one target, re-run its `setup ci` subcommand with the new
flags. `.github/tailor.lock` records them, and later updates reuse them.
