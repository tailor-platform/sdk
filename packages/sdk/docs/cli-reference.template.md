---
description: "Reference for the tailor CLI, including usage, global options, JSON output, workspace selection, and an index of every command."
---

# tailor

Tailor Platform SDK - The SDK to work with Tailor Platform

## Usage

```bash
tailor <command> [options]
```

## Global Options

{{politty:global-options}}

### Progress and Detailed Logs

`generate` and `deploy` show service progress and failures on stderr. Pass `--verbose`
to include individual loaded files, plugin table changes, and generated file paths.
Generation reports completion for each plugin that finishes processing its output files.

### JSON Output

For commands that return structured results, passing `--json` writes one parseable JSON document
to stdout on success. Empty successful result sets are emitted as JSON values such as `[]`, not as
human-readable text or empty stdout.

Many commands that change state print a JSON object describing the outcome. Its `changed` field is
`true` when the command did work and `false` when it did nothing, for example because the requested
state was already in place. The other fields identify what the command acted on and report details of
the outcome. Other state-changing commands print a result without `changed`, or do not report a
result yet and leave stdout empty even when `--json` is passed.

List commands return at most `--limit` items. When more exist, the list is followed by a notice on
stderr, `More results exist beyond --limit N. Raise --limit to see more.`, so `--json` output stays a
plain array of the listed items. Log listings such as `executor jobs`, `function logs`, and
`workflow executions` default to `--limit 50`; pass `--limit 0` to list everything.

Set `TAILOR_JSON_OUTPUT=true` (or `1`) to default every command to JSON without passing `--json`
each time. This is intended for agents, scripts, and CI steps that parse CLI output. An explicit
flag always wins, so `--json=false` forces table output even when the variable is enabled. The values
`true`, `True`, `TRUE`, `t`, `T`, and `1` enable JSON; `false`, `False`, `FALSE`, `f`, `F`, and `0`
keep table output. Other values are rejected. JSON mode also disables interactive prompts, so set the
variable per invocation or per job rather than exporting it from a shell profile; a command that
needed a prompt names what selected JSON when it refuses. In JSON mode, pass `--yes` to commands that
ask for confirmation, and pass the options that a command would otherwise prompt for.

When an AI coding agent such as Claude Code, Codex, Cursor, or Gemini CLI runs the CLI, every
command defaults to JSON as if `TAILOR_JSON_OUTPUT=true` were set, and `--help` starts with a short
guide for the agent. The CLI recognizes an agent by the environment variables it sets for the
commands it runs; a non-blank `AI_AGENT` also counts as one. An explicit `--json` or
`TAILOR_JSON_OUTPUT` still wins, so `--json=false` or `TAILOR_JSON_OUTPUT=false` keeps table output
under an agent, and setting `POLITTY_NO_AGENT` to any non-empty value, such as `1`, turns agent
detection off. Set `AI_AGENT` and `POLITTY_NO_AGENT` in the environment itself: values loaded with
`--env-file` do not change agent detection. CLI plugins keep table output under an agent unless they
receive `--json` or `TAILOR_JSON_OUTPUT`, and their `--help` does not include the guide.

Errors, warnings, progress, and diagnostic messages are written to stderr. A command failure under
`--json` or `TAILOR_JSON_OUTPUT` emits a JSON error envelope to stderr, including a failure while
parsing arguments: an unknown option or subcommand, or an option value that fails validation, is
reported as `INVALID_ARGUMENTS`. Failures you can act on — an invalid or missing option, a resource
that does not exist, an invalid configuration, or an unmet precondition — carry a stable `error.code`
such as `PROFILE_NOT_FOUND`, `TAILORDB_NAMESPACE_NOT_FOUND`, or `MIGRATION_SCRIPT_REQUIRED`
([Migration Error Codes](#migration-error-codes-beta) lists the codes for migrations). Where a
remediation exists, the envelope also includes
`error.suggestion`, `error.help` (the `--help` invocation for the failing command), `error.next` (a
runnable command), or `error.context`. `UNEXPECTED_ERROR` marks failures without a dedicated code,
including SDK-internal errors. Diagnostic lines may precede the error envelope, and stdout is not
guaranteed to contain an error object. A failure that points at a file starts its message, in the
envelope and in plain output, with the file's path relative to the working directory and, when
known, the line: `tailordb/order.ts:3: Invalid syntax: Expression expected`.

`DEFINITION_NAME_DUPLICATE` reports names shared by multiple TailorDB types, resolvers in one namespace,
executors, workflow jobs, HTTP adapters, IdPs, static websites, or AI Gateways. `error.context.kind` identifies
the kind, and `error.context.duplicates` lists each duplicated name and its definitions, including
`file` and `exportName` when available. For IdPs, static websites, and AI Gateways, each definition also has a
`path` array identifying the config entry, such as `["staticWebsites", 2]`.

`FRONTEND_SITE_DUPLICATE` means `frontendPlugin()` selects a site more than once.
`error.context.pluginId` identifies the plugin, and `error.context.duplicates` lists each
duplicated `name` with its zero-based argument `indices`. Configure each site only once.

The exit code separates a mistyped command from a failed one without parsing output: `0` on success,
`2` when the CLI rejects the command line itself, such as an unknown option or subcommand, an
unexpected argument, or an option value that fails validation (including one set through its
environment variable), and `1` for other failures, including checks a command makes after reading
its arguments. A command that only warns about an unknown option or an extra argument keeps
running. Cancelling an interactive prompt exits with `130`, and a CLI plugin exits with its own
code.

Authentication failures distinguish missing credentials (`AUTH_TOKEN_NOT_FOUND`), a missing saved
user (`AUTH_USER_NOT_FOUND`), an expired token (`AUTH_TOKEN_EXPIRED`), and a failed token refresh
(`AUTH_TOKEN_REFRESH_FAILED`). `CONFIG_LOCK_TIMEOUT` means another `tailor` command kept the saved
credentials locked for too long; `error.context.lockPath` names the lock file to delete if no other
command is running. Login recovery preserves the selected profile. For saved identities,
the next step opens login help so you can reuse the original browser or machine-user login method. Permission and
connection failures include guidance in `error.suggestion`; API failures also identify the operation
and affected resources in `error.context`.

A table update that makes a field required while records have no value for it fails with
`TAILORDB_REQUIRED_FIELD_HAS_NULL_VALUES` in `tailor deploy`, `tailor tailordb migration sync`, and
`tailor tailordb migration resolve`, and `error.suggestion` says how to proceed. When a deploy
reports that failure as `MIGRATION_ROLLED_BACK` or `MIGRATION_PARTIALLY_APPLIED` instead (see
[Migration Error Codes](#migration-error-codes-beta)), the `error.suggestion` of that error ends
with the same advice.

If deployment fails and saving recovery metadata also fails, `DEPLOY_METADATA_RECOVERY_FAILED`
includes separate `error.context.apply` and `error.context.recovery` errors, each retaining its code
and available recovery information. Inspect the current resource state before retrying: some writes
may have completed. `--verbose --json` additionally includes stack traces for both causes.

When `tailor deploy` finds values the Tailor Platform would reject, it stops before applying
anything and reports `DEPLOY_VALIDATION_FAILED`. `error.context.issues` lists every rejected
value across all configs in the run, each with its `application`, `resourceType`, `name`,
`action`, `fieldPath`, and `message`. `resourceType` is a resource type id such as `idp.client`,
`action` is `create`, `update`, or `replace`, and `fieldPath` is a dotted field path in the
request sent to the Platform, such as `tailordb_type.name`. The IdP email-domain check instead
uses the config field path `userAuthPolicy.allowedEmailDomains`.

Generation hook failures use `PLUGIN_GENERATION_FAILED`. The error includes the failed hook
and each failing plugin's ID and error in `error.context.failures`; successful plugins are
excluded from that list.

#### Migration Error Codes (Beta)

`tailor deploy` and the `tailor tailordb migration` commands report these codes when migration
files, the migration state of a namespace, or a migration run stops them. Each entry says what
happened; the next step, where one exists, is in `error.suggestion` and `error.next`. `tailor
tailordb migration test` deploys the pending migrations to a test workspace, so it can also report
the `tailor deploy` codes. See [TailorDB Migrations](./services/tailordb/migration.md) for the terms
used here.

Migration files, reported by `tailor deploy` and by the `tailor tailordb migration` commands that
read them:

- `MIGRATION_DIRECTORY_CONFLICT`: two or more namespaces use the same migrations directory.
- `MIGRATION_FILES_INVALID`: a migrations directory has no `0000/schema.json`, a gap or a duplicate
  in its numbering, or a migration without `diff.json`.
- `MIGRATION_FILE_INVALID`: a `schema.json` or `diff.json` is not valid JSON or does not have the
  expected structure.
- `MIGRATION_FILE_VERSION_UNSUPPORTED`: a migration file uses a format version that this SDK version
  does not support.

`tailor deploy`, checked while planning, so `--dry-run` reports them too:

- `MIGRATION_SCHEMA_CHECK_FAILED`: the local table definitions have changes that no migration file
  records.
- `MIGRATION_REMOTE_DRIFT`: the workspace's tables differ from the schema of the migration that its
  checkpoint records.
- `MIGRATION_CHECKPOINT_UNKNOWN`: the workspace's checkpoint is not in the local migration history:
  it is past the latest local migration, or it belongs to another migration history.
- `MIGRATION_SCRIPT_REQUIRED`: a pending migration requires a `migrate.ts`, and it has neither one
  nor a recorded `--no-script` acknowledgment.
- `MIGRATION_SCRIPT_SKIP_CONFLICT`: a pending migration has both a `migrate.ts` and a recorded
  `--no-script` acknowledgment.
- `MIGRATION_SCRIPT_REVIEW_REQUIRED`: a pending migration's `migrate.ts` still has a `TODO()` call
  or review marker that the generated script left.
- `MIGRATION_SCRIPT_INVALID`: a pending migration's `migrate.ts` cannot be parsed, or its exports or
  `steps` are not valid.
- `MIGRATION_SCRIPT_BUNDLE_FAILED`: a pending migration's `migrate.ts` could not be bundled.
- `AUTH_CONFIG_REQUIRED`: a pending migration has a `migrate.ts`, but the config defines no auth to
  run it.
- `MACHINE_USER_REQUIRED`: a pending migration has a `migrate.ts`, but no machine user is selected
  to run the scripts of its namespace.
- `MACHINE_USER_NOT_FOUND`: the machine user selected to run a pending migration's `migrate.ts` is
  not defined in auth.
- `MIGRATION_OUTCOME_UNSETTLED`: an earlier deploy could not confirm whether a migration's script
  ran, and the migration has not been settled since.
- `MIGRATION_IN_PROGRESS_INVALID`: the migration recorded as in progress cannot be read, is not the
  next pending migration, or no longer exports `steps` although some of its steps ran.
- `MIGRATION_IN_PROGRESS_CONFLICT`: a namespace whose checkpoint the deploy would reset to `0000`
  has a migration in progress.
- `MIGRATION_SKIP_STEPS_FORMAT_INVALID`: a `--migration-skip-steps` entry is not in the form
  `<namespace>/<step>`.
- `MIGRATION_SKIP_STEPS_INVALID`: a `--migration-skip-steps` entry names a namespace that no
  deployed config defines or that has no partially applied migration, or a step that is not in the
  migration, that has no earlier run, or that did not succeed in the earlier run.
- `MIGRATION_SKIP_STEPS_UNVERIFIED`: the step results of the earlier run could not be read, so the
  steps passed to `--migration-skip-steps` could not be checked.

`tailor deploy`, while applying:

- `DEPLOY_PLAN_STALE`: the migration files, a checkpoint reset, or the tables to delete changed
  after the deploy was planned. `tailor tailordb migration test` reports it when the migration
  files changed after it planned its deploy.
- `MIGRATION_HISTORY_INVALID`: the schema before a pending migration could not be rebuilt from the
  migration files.
- `MIGRATION_CHECKPOINT_CONFLICT`: a namespace's checkpoint or migration history changed while the
  deploy ran, for example because another deploy moved it.
- `MIGRATION_CHECKPOINT_UNVERIFIED`: the deploy could not read a namespace's checkpoint to confirm
  that it had not changed.
- `MIGRATION_FAILED`: a migration's script failed, and the deploy rolled the migration back to the
  previous checkpoint.
- `MIGRATION_ROLLED_BACK`: a migration whose `migrate.ts` exports `steps` and
  `onFailure = "rollback"` failed, and the deploy rolled it back to the previous checkpoint.
- `MIGRATION_PARTIALLY_APPLIED`: a migration stopped partway and stays in progress: a `steps`
  migration failed after some of its steps may have been applied, or the deploy could not clear
  the in-progress record of a failed migration, so its schema was not rolled back.
- `MIGRATION_OUTCOME_UNKNOWN`: the deploy could not confirm whether a migration's script started or
  finished, or whether an earlier run of the script is still running.
- `MIGRATION_LOCAL_DEFINITIONS_FAILED`: with `--no-schema-check`, a local table definition that the
  pending migrations do not include could not be applied after the migrations completed.
- `MIGRATION_RESTORE_FAILED`: the settings of some tables, such as their maintenance mode, could not
  be restored after the migrations. When a migration had already failed, the deploy reports that
  failure instead and puts this error in its `error.context.restoration`.

`MIGRATION_FAILED`, `MIGRATION_ROLLED_BACK`, `MIGRATION_PARTIALLY_APPLIED`, and
`MIGRATION_OUTCOME_UNKNOWN` name the migration in `error.context.namespace` and
`error.context.migrationNumber`, unless the error carries `error.context.restoration`.

`tailor tailordb migration` commands:

- `MIGRATION_CONFIG_NOT_FOUND`: no TailorDB namespace in the config has `migration` configured.
- `MIGRATION_VALIDATION_FAILED`: `validate` found a problem in at least one namespace. Its result
  lists the problems of each namespace, including the migration file and deploy checks above.
- `MIGRATION_STATUS_FAILED`: `status` could not report at least one namespace, for example because
  its migration files are invalid, its migration history differs from the workspace's, or its
  checkpoint is past the latest local migration.
- `MIGRATION_IN_PROGRESS`: `rebaseline`, `sync`, or `test` found a migration in progress in the
  namespace: partially applied steps, a script run that is not settled, or an in-progress record
  that cannot be read.
- `MIGRATION_HISTORY_MISMATCH`: replaying the local migration files does not reproduce the current
  local table definitions (`rebaseline`, `sync`, `resolve`).
- `MIGRATION_BASELINE_NOT_FOUND`: the namespace has no `0000` migration to rebuild its schema from.
- `MIGRATION_HISTORY_NOT_FOUND`: `rebaseline` found no migrations for the namespace.
- `MIGRATION_NAMESPACE_NOT_DEPLOYED`: the namespace does not exist in the workspace (`sync`,
  `resolve`).
- `MIGRATION_NOT_FOUND`: the migration that `sync` was given, or that `resolve` would return the
  namespace to, is not in the local migration files.
- `MIGRATION_SYNC_HISTORY_MISMATCH`: the namespace records a different migration history ID, or one
  that cannot be read, and `sync` was run without `--force`.
- `MIGRATION_SYNC_CANCELLED`: the `sync` confirmation was declined.
- `MIGRATION_RESOLVE_DIRECTION_REQUIRED`: `resolve` was given neither or both of `--rollback` and
  `--complete`.
- `MIGRATION_RESOLVE_NO_IN_PROGRESS`: `resolve` found nothing to settle: no migration is in
  progress in the namespace, and with `--rollback`, no interrupted deploy left the pre-migration
  schema of a migration either.
- `MIGRATION_RESOLVE_RECORD_UNREADABLE`: the namespace's in-progress record cannot be read.
- `MIGRATION_RESOLVE_RECORD_INVALID`: the migration recorded as in progress is not the one after
  the checkpoint.
- `MIGRATION_RESOLVE_HISTORY_MISMATCH`: the namespace records a different migration history ID from
  the local migration files.
- `MIGRATION_EXECUTION_ACTIVE`: the script run of the migration that `resolve` would settle is still
  running.
- `MIGRATION_RESOLVE_STATE_CHANGED`: the namespace's checkpoint, migration history, or in-progress
  record changed while `resolve` was running.
- `MIGRATION_RESOLVE_CANCELLED`: the `resolve` confirmation was declined.
- `REBASELINE_CHECKPOINT_BEHIND`: the workspace's checkpoint is not the latest local migration.
- `REBASELINE_REMOTE_HISTORY_INVALID`: the workspace's migration history ID cannot be read.
- `REBASELINE_REMOTE_HISTORY_MISMATCH`: the workspace records a different migration history ID from
  the local migration files.
- `REBASELINE_REMOTE_SCHEMA_MISMATCH`: the workspace's tables do not match the latest migration.
- `REBASELINE_STATE_CHANGED`: the workspace's migration history ID, the migration files, or the
  local table or config files changed while `rebaseline` waited for confirmation.
- `REBASELINE_CANCELLED`: the `rebaseline` confirmation was declined.
- `REBASELINE_CHECKPOINT_UPDATE_FAILED`: the local migration history was replaced, but resetting
  the workspace's checkpoint to `0000` failed.
- `MIGRATION_TEST_OPTIONS_INVALID`: the options of `test` conflict, for example `--keep-ttl`
  without `--keep`, or `--organization-id` or `--folder-id` does not match the target workspace.
- `MIGRATION_TEST_TARGET_INVALID`: the target workspace is the source workspace.
- `MIGRATION_TEST_REGION_MISMATCH`: with `--data clone`, the target workspace is in a different
  region from the source.
- `MIGRATION_TEST_ASSERT_NAMESPACE_REQUIRED`: `--assert` was given, the pending migrations span
  several namespaces, and `--assert-namespace` was not given.
- `MIGRATION_TEST_NO_PENDING_MIGRATIONS`: the source workspace has no pending migration, or the
  `--assert-namespace` has none.
- `MIGRATION_TEST_SOURCE_CHECKPOINT_MISSING`: a namespace has not been deployed to the source
  workspace.
- `MIGRATION_TEST_SOURCE_INVALID`: a source namespace's tables do not match its checkpoint, or,
  without a checkpoint, do not match `0000`.
- `MIGRATION_TEST_SOURCE_AHEAD`: a source namespace's checkpoint is past the latest local migration.
- `MIGRATION_TEST_SOURCE_REPAIR_PENDING`: a source namespace's checkpoint is waiting for the reset
  to `0000` that a deploy applies after a re-baseline.
- `MIGRATION_TEST_SOURCE_CLEANUP_PENDING`: a source namespace still has tables that the migration
  at its checkpoint removed.
- `MIGRATION_TEST_SOURCE_CHANGED`: with `--data clone`, the source workspace changed between
  preparing the test and cloning its data.
- `MIGRATION_TEST_SNAPSHOT_NOT_FOUND`: the schema of the latest migration could not be rebuilt from
  the migration files.
- `MIGRATION_TEST_SNAPSHOT_INVALID`: the migration schemas to deploy to the target name a namespace
  that is not in the config, or define the same table name in two namespaces.
- `MIGRATION_TEST_CLONE_UNAVAILABLE`: data cloning is not enabled on the Platform.
- `MIGRATION_TEST_CLONE_FAILED`: cloning the source data failed.
- `MIGRATION_TEST_CLONE_TIMEOUT`: cloning the source data did not finish within `--clone-timeout`.
- `MIGRATION_TEST_SEED_FAILED`: the seed script failed.
- `MIGRATION_TEST_ASSERTION_FAILED`: the assertion script failed.
- `MIGRATION_TEST_WORKSPACE_CLEANUP_FAILED`: the test passed, but deleting its temporary workspace
  failed.

Codes of `tailor tailordb migration generate` and `tailor tailordb migration script`, and other
codes for options or arguments that cannot be used, such as a namespace or migration number that
does not exist, are not listed; their messages name the cause.

### Verbose Output

Use `--verbose` to include debug diagnostics and error stack traces. `DEBUG=true` or
`RUNNER_DEBUG=1` also enables verbose output, including stacks in JSON errors. GitHub Actions
sets `RUNNER_DEBUG=1` when debug logging is enabled, so the same command automatically includes
these details in a debug run. `--no-verbose` turns verbose output off even when these are set.
These settings do not enable JSON output; pass `--json` separately.

Capture the original failure's stderr and exit code before retrying. Failures before the CLI starts,
a rejected `--json` or `TAILOR_JSON_OUTPUT` value, argument errors in the bundled CLI plugins, and
the install hint for a CLI plugin that is not installed may still produce plain text when JSON output
is requested. A failed deployment may have already
applied changes, so inspect its output before deciding to run it again.

### GitHub Actions Annotations

When `GITHUB_ACTIONS` is exactly `true`, a command that ends in failure also writes one
`::error::` workflow command to stderr, so the failure appears as an annotation on the run
instead of only inside the scrolled log. The annotation repeats what the CLI already prints:
its `title` is the error code (`AUTH_TOKEN_NOT_FOUND`, `PLUGIN_GENERATION_FAILED`, ...), and its
body carries the same details, suggestion, and next action. Colors are stripped and newlines are
encoded, so the annotation is a single line.

Exactly one annotation is written per failed command, and only for the failure that ends it.
Warnings and individually reported problems stay plain stderr output. The bundled CLI plugins
(`seed`, `setup`, `tailordb-erd`) annotate their failures the same way. A command that exits
without reporting through the CLI's error path, such as one relaying a failed remote execution,
writes no annotation.

Set `TAILOR_GITHUB_ACTIONS_ANNOTATIONS=false` (also `off`, `no`, or `0`) to turn annotations off.
Passing `--json`, setting `TAILOR_JSON_OUTPUT`, or the JSON default under an AI coding agent also
suppresses them, so a workflow step that parses JSON output gets only the error envelope on stderr,
even when the command fails during argument parsing.

An annotation does not by itself fail a step: the step still fails on the CLI's exit code, which
is unchanged. Workflows that already echo their own `::error::` around the CLI keep working;
those messages describe the workflow's own checks, which can fail even when the CLI succeeds.

When the failure has a known source, the annotation carries it: `seed validate` reports the
offending JSONL file and line, including a line that is not valid JSON, and a rejected config or a
TailorDB type, resolver, executor, workflow, or HTTP adapter file that fails to load reports its
file. A `.ts` or `.mts` file that cannot be parsed — one of those files, the file passed to
`function run`, or a file one of them imports — reports that file and the line it failed on.
Locations are written relative to `GITHUB_WORKSPACE`; a file outside it is annotated without a
location rather than with a path the runner cannot resolve.

For a JSONL file containing a blank line, the annotation's line and the line printed in the report
text differ: the annotation counts every line in the file, while the printed line counts only the
records. The annotation points at the row as an editor numbers it. A line that is not valid JSON is
printed with the line an editor shows, so both agree.

`generate` and `deploy` do not group their per-service progress.

## Common Options

The following options are available for most commands:

| Option           | Short | Description                            |
| ---------------- | ----- | -------------------------------------- |
| `--workspace-id` | `-w`  | Workspace ID (for deployment commands) |
| `--profile`      | `-p`  | Workspace profile                      |
| `--config`       | `-c`  | Path to Tailor config file             |
| `--yes`          | `-y`  | Skip confirmation prompts              |

### Environment File Loading

Both `--env-file` and `--env-file-if-exists` can be specified multiple times and follow Node.js `--env-file` behavior:

- Variables already set in the environment are **not** overwritten
- Later files override earlier files
- `--env-file` files are loaded first, then `--env-file-if-exists` files
- Loaded values fill options backed by an environment variable, such as `--config` from `TAILOR_CONFIG_PATH`

```bash
# Load .env (required) and .env.local (optional, if exists)
tailor deploy --env-file .env --env-file-if-exists .env.local

# Load multiple files
tailor deploy --env-file .env --env-file .env.production
```

## Environment Variables

You can use environment variables to configure workspace and authentication:

| Variable                                     | Description                                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `TAILOR_PLATFORM_WORKSPACE_ID`               | Workspace ID for deployment commands                                                                             |
| `TAILOR_PLATFORM_ORGANIZATION_ID`            | Organization ID for organization commands                                                                        |
| `TAILOR_PLATFORM_FOLDER_ID`                  | Folder ID for folder commands                                                                                    |
| `TAILOR_PLATFORM_TOKEN`                      | Authentication token (alternative to `login`)                                                                    |
| `TAILOR_PLATFORM_PROFILE`                    | Workspace profile name                                                                                           |
| `TAILOR_CONFIG_PATH`                         | Path to Tailor config file                                                                                       |
| `TAILOR_DTS_PATH`                            | Output path for generated `tailor.d.ts` type definition file                                                     |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID`     | Client ID for `login --machine-user`                                                                             |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET` | Client secret for `login --machine-user`                                                                         |
| `TAILOR_PLATFORM_MACHINE_USER_NAME`          | Default machine user name for `query`, `workflow start`, `function run`, `machineuser token`                     |
| `TAILOR_PLATFORM_URL`                        | Platform API base URL. Saved into profiles created with `profile create --platform-url`                          |
| `TAILOR_PLATFORM_OAUTH2_CLIENT_ID`           | OAuth2 client ID for user login. Saved into profiles created with `profile create --oauth2-client-id`            |
| `TAILOR_PLATFORM_CONSOLE_URL`                | Console base URL. Saved into profiles created with `profile create --console-url`                                |
| `TAILOR_BUNDLE_CONCURRENCY`                  | Max concurrent bundle workers for `deploy` (resolvers/executors/workflows). Defaults to CPU count                |
| `TAILOR_APPLY_CONCURRENCY`                   | Max concurrent platform RPCs during `apply`/`deploy`. Defaults to 16                                             |
| `VISUAL` / `EDITOR`                          | Preferred editor for commands that open files (e.g., `vim`, `code`, `nano`)                                      |
| `TAILOR_GITHUB_ACTIONS_ANNOTATIONS`          | GitHub Actions failure annotations: `on` (default) or `off`                                                      |
| `TAILOR_CRASH_REPORTS_LOCAL`                 | Local crash log writing: `on` (default) or `off`                                                                 |
| `TAILOR_CRASH_REPORTS_REMOTE`                | Automatic crash report submission: `off` (default) or `on`                                                       |
| `TAILOR_NOTIFICATION_BANNER`                 | Unread WARNING/CRITICAL notifications listed after a command in an interactive terminal: `on` (default) or `off` |

### Authentication Token Priority

Token resolution follows this priority order:

1. `TAILOR_PLATFORM_TOKEN` environment variable
2. Profile specified via `--profile` option or `TAILOR_PLATFORM_PROFILE`
3. Current user from platform config (`~/.config/tailor-platform/config.yaml`)

Config-backed login tokens are scoped to the Platform API URL. Profiles with `--platform-url` use the token saved for that URL, so switching profiles can also switch between Platform API environments.

### Workspace ID Priority

Workspace ID resolution follows this priority order:

1. `--workspace-id` command option
2. `TAILOR_PLATFORM_WORKSPACE_ID` environment variable
3. Profile specified via `--profile` option or `TAILOR_PLATFORM_PROFILE`

## CLI Plugins (Beta)

> [!WARNING]
> CLI plugins are a **beta** feature. The dispatch behavior and the set of injected environment
> variables may change in a future release.

You can extend the CLI with external plugins, similar to `gh` extensions. When you run a command that
is not a built-in, the CLI looks for an executable named `tailor-<name>` and runs it, forwarding the
remaining arguments:

```bash
# Runs the `tailor-hello` executable with: world --loud
tailor hello world --loud
```

This is how the `@tailor-platform/sdk-plugin-seed` package provides the `seed` commands:

```bash
# Runs `tailor-seed` with: apply
tailor seed apply
```

This also works under a built-in command group. The command path is joined with hyphens, so a plugin
nested under `tailordb` is named `tailor-tailordb-erd`. This is how the
`@tailor-platform/sdk-plugin-tailordb-erd`
package provides the `tailordb erd` commands:

```bash
# Runs `tailor-tailordb-erd` with: export
tailor tailordb erd export
```

Resolution rules:

- **Built-ins always win.** A plugin is only used when no built-in command matches.
- **A command that takes its own arguments is never replaced.** Plugin dispatch applies only to command
  _groups_ (commands that just route to subcommands). A command that performs its own action — including
  one that accepts a positional argument — always runs itself, so a plugin can never shadow an argument value.
- **Lookup order:** the project's `node_modules/.bin` (nearest first, walking up from the current
  directory), then your `PATH`. So a plugin installed as a project dev-dependency takes precedence over a
  globally installed one.
- **Global flags reach the plugin from either side.** `tailor --json tailordb erd export` and
  `tailor tailordb erd export --json` both forward `--json`, and likewise `--verbose` and the
  `--env-file` options. A flag typed before the plugin name is consumed by the host CLI first and
  then forwarded, so when the same flag appears on both sides the later one wins; every
  `--env-file` and `--env-file-if-exists` still loads. A flag the host does not define — including
  one only some commands declare, such as `--profile` — still has to be typed after the plugin's own
  subcommand. `--help` and `--version` are answered by the host CLI and
  never dispatch a plugin. Setting `TAILOR_JSON_OUTPUT=true` also works, which plugins inherit from
  the environment.

Because resolution is based on `node_modules/.bin` and `PATH`, any package manager that populates
`node_modules/.bin` works for project-local plugins — npm, pnpm (its content-addressable store is
transparent here), Bun, and Yarn Classic. The exception is **Yarn Plug'n'Play**, which does not create a
`node_modules` directory: install such plugins globally so they resolve via `PATH`, or use Yarn's
`nodeLinker: node-modules` setting.

Run `tailor plugin list` to see which plugins are discovered and where they resolve from.

### Context passed to plugins

Before running a plugin, the CLI injects the current Tailor Platform context as environment variables so
the plugin does not need to re-implement authentication or re-resolve the active workspace:

| Variable                           | Description                                                              |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `TAILOR_PLATFORM_TOKEN`            | A valid access token (refreshed if needed). Omitted when not logged in.  |
| `TAILOR_PLATFORM_URL`              | The Tailor Platform endpoint in effect                                   |
| `TAILOR_PLATFORM_OAUTH2_CLIENT_ID` | The OAuth2 client ID in effect, for plugins that run their own auth flow |
| `TAILOR_PLATFORM_WORKSPACE_ID`     | The resolved workspace ID, when one can be determined                    |
| `TAILOR_PLATFORM_USER`             | The active user (email when known), when logged in                       |
| `TAILOR_CONFIG_PATH`               | Path to the resolved Tailor config file, when found                      |
| `TAILOR_VERSION`                   | The `tailor` version that invoked the plugin                             |
| `TAILOR_BIN`                       | Path to the `tailor` executable, for calling back into the CLI           |

The token, workspace ID, and user are best-effort: whatever the current context can resolve is injected,
and auth-free plugins still run when you are not logged in. The user is not injected when the token comes
from `TAILOR_PLATFORM_TOKEN`, since that token does not belong to a logged-in user. When the plugin's arguments
include `--env-file` or `--env-file-if-exists`, the CLI loads those files before resolving the context, so
the values they set apply as they would to any other command. A long-running plugin (or one started on its
own) can obtain a fresh token at any time with `tailor auth token`, which prints a valid access token to
stdout, refreshing it first if it expires within five minutes.

## Commands

{{politty:index}}
