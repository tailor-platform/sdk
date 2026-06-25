# tailor

Tailor Platform SDK - The SDK to work with Tailor Platform

## Usage

```bash
tailor <command> [options]
```

## Global Options

<a id="global-options"></a>
| Option | Alias | Description | Required | Default |
|--------|-------|-------------|----------|---------|
| `--env-file <ENV_FILE>` | `-e` | Path to the environment file (error if not found) | No | - |
| `--env-file-if-exists <ENV_FILE_IF_EXISTS>` | - | Path to the environment file (ignored if not found) | No | - |
| `--verbose` | - | Enable verbose logging | No | `false` |
| `--json` | `-j` | Output as JSON | No | `false` |

### JSON Output

For commands that return structured results, passing `--json` writes one parseable JSON document
to stdout on success. Empty successful result sets are emitted as JSON values such as `[]`, not as
human-readable text or empty stdout.

Commands that only perform side effects and do not define a structured result may leave stdout empty
even when `--json` is passed.

Errors, warnings, progress, and diagnostic messages are written to stderr. On failure, check the
non-zero exit code and read stderr; stdout is not guaranteed to contain a JSON error object.

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

```bash
# Load .env (required) and .env.local (optional, if exists)
tailor deploy --env-file .env --env-file-if-exists .env.local

# Load multiple files
tailor deploy --env-file .env --env-file .env.production
```

## Environment Variables

You can use environment variables to configure workspace and authentication:

| Variable                                     | Description                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `TAILOR_PLATFORM_WORKSPACE_ID`               | Workspace ID for deployment commands                                                                         |
| `TAILOR_PLATFORM_ORGANIZATION_ID`            | Organization ID for organization commands                                                                    |
| `TAILOR_PLATFORM_FOLDER_ID`                  | Folder ID for folder commands                                                                                |
| `TAILOR_PLATFORM_TOKEN`                      | Authentication token (alternative to `login`)                                                                |
| `TAILOR_PLATFORM_PROFILE`                    | Workspace profile name                                                                                       |
| `TAILOR_CONFIG_PATH`                         | Path to Tailor config file                                                                                   |
| `TAILOR_DTS_PATH`                            | Output path for generated `tailor.d.ts` type definition file                                                 |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID`     | Client ID for `login --machine-user`                                                                         |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET` | Client secret for `login --machine-user`                                                                     |
| `TAILOR_PLATFORM_MACHINE_USER_NAME`          | Default machine user name for `query`, `workflow start`, `function test-run`, `machineuser token`            |
| `TAILOR_BUNDLE_CONCURRENCY`                  | Max concurrent bundle workers for `deploy` (resolvers/executors/workflows). Defaults to CPU count            |
| `TAILOR_APPLY_CONCURRENCY`                   | Max concurrent unary platform RPCs during `apply`/`deploy` (streaming uploads are not gated). Defaults to 16 |
| `TAILOR_PLATFORM_URL`                        | Tailor Platform API endpoint override                                                                        |
| `TAILOR_PLATFORM_OAUTH2_CLIENT_ID`           | OAuth2 client ID override for Tailor Platform login                                                          |
| `VISUAL` / `EDITOR`                          | Preferred editor for commands that open files (e.g., `vim`, `code`, `nano`)                                  |
| `TAILOR_CRASH_REPORTS_LOCAL`                 | Local crash log writing: `on` (default) or `off`                                                             |
| `TAILOR_CRASH_REPORTS_REMOTE`                | Automatic crash report submission: `off` (default) or `on`                                                   |

### Authentication Token Priority

Token resolution follows this priority order:

1. `TAILOR_PLATFORM_TOKEN` environment variable
2. Profile specified via `--profile` option or `TAILOR_PLATFORM_PROFILE`
3. Current user from platform config (`~/.config/tailor-platform/config.yaml`)

### Workspace ID Priority

Workspace ID resolution follows this priority order:

1. `--workspace-id` command option
2. `TAILOR_PLATFORM_WORKSPACE_ID` environment variable
3. Profile specified via `--profile` option or `TAILOR_PLATFORM_PROFILE`

## CLI Plugins

You can extend the CLI with external plugins, similar to `gh` extensions. When you run a command that
is not a built-in, the CLI looks for an executable named `tailor-<name>` and runs it, forwarding the
remaining arguments:

```bash
# Runs the `tailor-hello` executable with: world --loud
tailor hello world --loud
```

This also works under a built-in command group. The command path is joined with hyphens, so a plugin
nested under `tailordb` is named `tailor-tailordb-erd`:

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
and auth-free plugins still run when you are not logged in. A long-running plugin (or one started on its
own) can obtain a fresh token at any time with `tailor auth token`, which prints a valid access token to
stdout, refreshing it first if it has expired.

## Commands

### [Application Commands](./cli/application.md)

Commands for managing Tailor Platform applications (work with `tailor.config.ts`).

| Command                                         | Description                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| [init](./cli/application.md#init)               | Initialize a new project using create-sdk.                          |
| [generate](./cli/application.md#generate)       | Generate files using Tailor configuration.                          |
| [deploy](./cli/application.md#deploy)           | Deploy your application by applying the Tailor configuration.       |
| [remove](./cli/application.md#remove)           | Remove all resources managed by the application from the workspace. |
| [show](./cli/application.md#show)               | Show information about the deployed application.                    |
| [open](./cli/application.md#open)               | Open Tailor Platform Console.                                       |
| [api](./cli/application.md#api)                 | Call Tailor Platform API endpoints directly.                        |
| [api inspect](./cli/application.md#api-inspect) | Print the input message tree of an OperatorService endpoint.        |
| [api list](./cli/application.md#api-list)       | List all invocable OperatorService methods.                         |

### [TailorDB Commands](./cli/tailordb.md)

Commands for managing TailorDB tables, data, and schema migrations.

| Command                                                                      | Description                                                                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [tailordb](./cli/tailordb.md#tailordb)                                       | Manage TailorDB tables and data.                                                                                          |
| [tailordb truncate](./cli/tailordb.md#tailordb-truncate)                     | Truncate (delete all records from) TailorDB tables.                                                                       |
| [tailordb migration](./cli/tailordb.md#tailordb-migration)                   | Manage TailorDB schema migrations.                                                                                        |
| [tailordb migration generate](./cli/tailordb.md#tailordb-migration-generate) | Generate migration files by detecting schema differences between current local types and the previous migration snapshot. |
| [tailordb migration script](./cli/tailordb.md#tailordb-migration-script)     | Add a migration script (migrate.ts) template to an existing migration directory.                                          |
| [tailordb migration set](./cli/tailordb.md#tailordb-migration-set)           | Set migration checkpoint to a specific number.                                                                            |
| [tailordb migration status](./cli/tailordb.md#tailordb-migration-status)     | Show the current migration status for TailorDB namespaces, including applied and pending migrations.                      |
| [tailordb migration sync](./cli/tailordb.md#tailordb-migration-sync)         | Sync remote TailorDB schema to a specific migration snapshot (recovery from --no-schema-check drift).                     |
| [tailordb erd](./cli/tailordb.md#tailordb-erd)                               | Generate TailorDB ERD viewer artifacts from local TailorDB schema. (beta)                                                 |
| [tailordb erd export](./cli/tailordb.md#tailordb-erd-export)                 | Export TailorDB ERD static viewer from local TailorDB schema.                                                             |
| [tailordb erd serve](./cli/tailordb.md#tailordb-erd-serve)                   | Generate and serve TailorDB ERD locally with watch reload. (beta)                                                         |
| [tailordb erd deploy](./cli/tailordb.md#tailordb-erd-deploy)                 | Deploy ERD static website for TailorDB namespace(s).                                                                      |

### [Query Commands](./cli/query.md)

Run ad-hoc SQL/GraphQL queries or enter the interactive REPL.

| Command                       | Description            |
| ----------------------------- | ---------------------- |
| [query](./cli/query.md#query) | Run SQL/GraphQL query. |

### [User & Auth Commands](./cli/user.md)

Commands for authentication and user management.

| Command                                          | Description                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [login](./cli/user.md#login)                     | Login to Tailor Platform.                                                             |
| [logout](./cli/user.md#logout)                   | Logout from Tailor Platform.                                                          |
| [auth](./cli/user.md#auth)                       | Authentication helpers for scripts and plugins.                                       |
| [auth token](./cli/user.md#auth-token)           | Print a valid Tailor Platform access token to stdout, refreshing it first if expired. |
| [user](./cli/user.md#user)                       | Manage Tailor Platform users.                                                         |
| [user current](./cli/user.md#user-current)       | Show current user.                                                                    |
| [user list](./cli/user.md#user-list)             | List all users.                                                                       |
| [user pat](./cli/user.md#user-pat)               | Manage personal access tokens.                                                        |
| [user pat create](./cli/user.md#user-pat-create) | Create a new personal access token.                                                   |
| [user pat delete](./cli/user.md#user-pat-delete) | Delete a personal access token.                                                       |
| [user pat list](./cli/user.md#user-pat-list)     | List all personal access tokens.                                                      |
| [user pat update](./cli/user.md#user-pat-update) | Update a personal access token (delete and recreate).                                 |
| [user switch](./cli/user.md#user-switch)         | Set current user.                                                                     |

### [Organization Commands](./cli/organization.md)

Commands for managing organizations and folders.

| Command                                                                        | Description                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------ |
| [organization](./cli/organization.md#organization)                             | Manage Tailor Platform organizations.            |
| [organization folder](./cli/organization.md#organization-folder)               | Manage organization folders.                     |
| [organization folder create](./cli/organization.md#organization-folder-create) | Create a new folder in an organization.          |
| [organization folder delete](./cli/organization.md#organization-folder-delete) | Delete a folder from an organization.            |
| [organization folder get](./cli/organization.md#organization-folder-get)       | Show detailed information about a folder.        |
| [organization folder list](./cli/organization.md#organization-folder-list)     | List folders in an organization.                 |
| [organization folder update](./cli/organization.md#organization-folder-update) | Update a folder's name.                          |
| [organization get](./cli/organization.md#organization-get)                     | Show detailed information about an organization. |
| [organization list](./cli/organization.md#organization-list)                   | List organizations you belong to.                |
| [organization tree](./cli/organization.md#organization-tree)                   | Display organization folder hierarchy as a tree. |
| [organization update](./cli/organization.md#organization-update)               | Update an organization's name.                   |

### [Workspace Commands](./cli/workspace.md)

Commands for managing workspaces and profiles.

| Command                                                           | Description                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------------- |
| [workspace](./cli/workspace.md#workspace)                         | Manage Tailor Platform workspaces.                         |
| [workspace app](./cli/workspace.md#workspace-app)                 | Manage workspace applications                              |
| [workspace app health](./cli/workspace.md#workspace-app-health)   | Check application schema health                            |
| [workspace app list](./cli/workspace.md#workspace-app-list)       | List applications in a workspace                           |
| [workspace create](./cli/workspace.md#workspace-create)           | Create a new Tailor Platform workspace.                    |
| [workspace delete](./cli/workspace.md#workspace-delete)           | Delete a Tailor Platform workspace.                        |
| [workspace get](./cli/workspace.md#workspace-get)                 | Show detailed information about a workspace                |
| [workspace list](./cli/workspace.md#workspace-list)               | List all Tailor Platform workspaces.                       |
| [workspace restore](./cli/workspace.md#workspace-restore)         | Restore a deleted workspace                                |
| [workspace user](./cli/workspace.md#workspace-user)               | Manage workspace users                                     |
| [workspace user invite](./cli/workspace.md#workspace-user-invite) | Invite a user to a workspace                               |
| [workspace user list](./cli/workspace.md#workspace-user-list)     | List users in a workspace                                  |
| [workspace user remove](./cli/workspace.md#workspace-user-remove) | Remove a user from a workspace                             |
| [workspace user update](./cli/workspace.md#workspace-user-update) | Update a user's role in a workspace                        |
| [profile](./cli/workspace.md#profile)                             | Manage workspace profiles (user + workspace combinations). |
| [profile create](./cli/workspace.md#profile-create)               | Create a new profile.                                      |
| [profile delete](./cli/workspace.md#profile-delete)               | Delete a profile.                                          |
| [profile list](./cli/workspace.md#profile-list)                   | List all profiles.                                         |
| [profile update](./cli/workspace.md#profile-update)               | Update profile properties.                                 |

### [Auth Resource Commands](./cli/auth.md)

Commands for managing Auth service resources.

| Command                                                            | Description                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [authconnection](./cli/auth.md#authconnection)                     | Manage auth connections.                                                              |
| [authconnection authorize](./cli/auth.md#authconnection-authorize) | Authorize an auth connection via OAuth2 flow.                                         |
| [authconnection delete](./cli/auth.md#authconnection-delete)       | Delete an auth connection entirely.                                                   |
| [authconnection list](./cli/auth.md#authconnection-list)           | List all auth connections.                                                            |
| [authconnection open](./cli/auth.md#authconnection-open)           | Open the auth connections page in the Tailor Platform Console.                        |
| [authconnection revoke](./cli/auth.md#authconnection-revoke)       | Revoke an auth connection's tokens (keeps the connection; use 'delete' to remove it). |
| [machineuser](./cli/auth.md#machineuser)                           | Manage machine users in your Tailor Platform application.                             |
| [machineuser list](./cli/auth.md#machineuser-list)                 | List all machine users in the application.                                            |
| [machineuser token](./cli/auth.md#machineuser-token)               | Get an access token for a machine user.                                               |
| [oauth2client](./cli/auth.md#oauth2client)                         | Manage OAuth2 clients in your Tailor Platform application.                            |
| [oauth2client list](./cli/auth.md#oauth2client-list)               | List all OAuth2 clients in the application.                                           |
| [oauth2client get](./cli/auth.md#oauth2client-get)                 | Get OAuth2 client credentials (including client secret).                              |

### [Workflow Commands](./cli/workflow.md)

Commands for managing workflows and executions.

| Command                                                      | Description                                    |
| ------------------------------------------------------------ | ---------------------------------------------- |
| [workflow](./cli/workflow.md#workflow)                       | Manage workflows and workflow executions.      |
| [workflow list](./cli/workflow.md#workflow-list)             | List all workflows in the workspace.           |
| [workflow get](./cli/workflow.md#workflow-get)               | Get workflow details.                          |
| [workflow start](./cli/workflow.md#workflow-start)           | Start a workflow execution.                    |
| [workflow wait](./cli/workflow.md#workflow-wait)             | Wait for a workflow execution.                 |
| [workflow executions](./cli/workflow.md#workflow-executions) | List or get workflow executions.               |
| [workflow resume](./cli/workflow.md#workflow-resume)         | Resume a failed or pending workflow execution. |

### [Function Commands](./cli/function.md)

Commands for managing function registries and viewing function execution logs.

| Command                                                  | Description                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| [function](./cli/function.md#function)                   | Manage functions                                                |
| [function get](./cli/function.md#function-get)           | Get a function registry by name                                 |
| [function list](./cli/function.md#function-list)         | List function registries in a workspace                         |
| [function logs](./cli/function.md#function-logs)         | List or get function execution logs.                            |
| [function test-run](./cli/function.md#function-test-run) | Run a function on the Tailor Platform server without deploying. |

### [Executor Commands](./cli/executor.md)

Commands for managing executors and executor jobs.

| Command                                                          | Description                                   |
| ---------------------------------------------------------------- | --------------------------------------------- |
| [executor](./cli/executor.md#executor)                           | Manage executors                              |
| [executor list](./cli/executor.md#executor-list)                 | List all executors                            |
| [executor get](./cli/executor.md#executor-get)                   | Get executor details                          |
| [executor jobs](./cli/executor.md#executor-jobs)                 | List or get executor jobs.                    |
| [executor trigger](./cli/executor.md#executor-trigger)           | Trigger an executor manually.                 |
| [executor webhook](./cli/executor.md#executor-webhook)           | Manage executor webhooks                      |
| [executor webhook list](./cli/executor.md#executor-webhook-list) | List executors with incoming webhook triggers |

### [Secret Commands](./cli/secret.md)

Commands for managing secrets and vaults.

| Command                                                    | Description                                      |
| ---------------------------------------------------------- | ------------------------------------------------ |
| [secret](./cli/secret.md#secret)                           | Manage Secret Manager vaults and secrets.        |
| [secret create](./cli/secret.md#secret-create)             | Create a secret in a vault.                      |
| [secret delete](./cli/secret.md#secret-delete)             | Delete a secret in a vault.                      |
| [secret list](./cli/secret.md#secret-list)                 | List all secrets in a vault.                     |
| [secret update](./cli/secret.md#secret-update)             | Update a secret in a vault.                      |
| [secret vault](./cli/secret.md#secret-vault)               | Manage Secret Manager vaults.                    |
| [secret vault create](./cli/secret.md#secret-vault-create) | Create a new Secret Manager vault.               |
| [secret vault delete](./cli/secret.md#secret-vault-delete) | Delete a Secret Manager vault.                   |
| [secret vault list](./cli/secret.md#secret-vault-list)     | List all Secret Manager vaults in the workspace. |

### [Static Website Commands](./cli/staticwebsite.md)

Commands for managing and deploying static websites.

| Command                                                                       | Description                                           |
| ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| [staticwebsite](./cli/staticwebsite.md#staticwebsite)                         | Manage static websites in your workspace.             |
| [staticwebsite deploy](./cli/staticwebsite.md#staticwebsite-deploy)           | Deploy a static website from a local build directory. |
| [staticwebsite list](./cli/staticwebsite.md#staticwebsite-list)               | List all static websites in a workspace.              |
| [staticwebsite domain](./cli/staticwebsite.md#staticwebsite-domain)           | Manage custom domains for static websites.            |
| [staticwebsite domain get](./cli/staticwebsite.md#staticwebsite-domain-get)   | Get details of a custom domain.                       |
| [staticwebsite domain list](./cli/staticwebsite.md#staticwebsite-domain-list) | List custom domains for a static website.             |
| [staticwebsite get](./cli/staticwebsite.md#staticwebsite-get)                 | Get details of a specific static website.             |

### [Crash Report Commands](./cli/crashreport.md)

Commands for managing crash reports.

| Command                                                   | Description                                    |
| --------------------------------------------------------- | ---------------------------------------------- |
| [crashreport](./cli/crashreport.md#crashreport)           | Manage crash reports.                          |
| [crashreport list](./cli/crashreport.md#crashreport-list) | List local crash report files.                 |
| [crashreport send](./cli/crashreport.md#crashreport-send) | Submit a crash report to help improve the SDK. |

### [Setup Commands](./cli/setup.md)

Commands for setting up project infrastructure.

| Command                                   | Description                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| [setup](./cli/setup.md#setup)             | Generate a CI deploy workflow for your project. (beta)                           |
| [setup check](./cli/setup.md#setup-check) | Audit generated workflows for drift against the current config/repo (read-only). |

### [Upgrade Commands](./cli/upgrade.md)

Commands for upgrading SDK versions with automated code migration.

| Command                             | Description                                                  |
| ----------------------------------- | ------------------------------------------------------------ |
| [upgrade](./cli/upgrade.md#upgrade) | Run codemods to upgrade your project to a newer SDK version. |

### [Skills Commands](./cli/skills.md)

Commands for installing Tailor SDK agent skills.

| Command                                          | Description                                                    |
| ------------------------------------------------ | -------------------------------------------------------------- |
| [skills](./cli/skills.md#skills)                 | Manage Tailor SDK agent skills.                                |
| [skills install](./cli/skills.md#skills-install) | Install the tailor agent skill from the installed SDK package. |

### [Plugin Commands](./cli/plugin.md)

Discover and inspect CLI plugins (external `tailor-<name>` executables).

| Command                                    | Description                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [plugin](./cli/plugin.md#plugin)           | Manage and inspect CLI plugins.                                                          |
| [plugin list](./cli/plugin.md#plugin-list) | List discovered plugins (executables named `<cli>-<name>` on PATH or node_modules/.bin). |

### [Completion](./cli/completion.md)

Generate shell completion scripts for bash, zsh, and fish.

| Command                                      | Description                      |
| -------------------------------------------- | -------------------------------- |
| [completion](./cli/completion.md#completion) | Generate shell completion script |
