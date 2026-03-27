# tailor-sdk

Tailor Platform SDK - The SDK to work with Tailor Platform

## Usage

```bash
tailor-sdk <command> [options]
```

## Global Options

<!-- politty:global-options:start -->

<a id="global-options"></a>
| Option | Alias | Description | Required | Default |
|--------|-------|-------------|----------|---------|
| `--env-file <ENV_FILE>` | `-e` | Path to the environment file (error if not found) | No | - |
| `--env-file-if-exists <ENV_FILE_IF_EXISTS>` | - | Path to the environment file (ignored if not found) | No | - |
| `--verbose` | - | Enable verbose logging | No | `false` |
| `--json` | `-j` | Output as JSON | No | `false` |

<!-- politty:global-options:end -->

## Common Options

The following options are available for most commands:

| Option           | Short | Description                            |
| ---------------- | ----- | -------------------------------------- |
| `--workspace-id` | `-w`  | Workspace ID (for deployment commands) |
| `--profile`      | `-p`  | Workspace profile                      |
| `--config`       | `-c`  | Path to SDK config file                |
| `--yes`          | `-y`  | Skip confirmation prompts              |

### Environment File Loading

Both `--env-file` and `--env-file-if-exists` can be specified multiple times and follow Node.js `--env-file` behavior:

- Variables already set in the environment are **not** overwritten
- Later files override earlier files
- `--env-file` files are loaded first, then `--env-file-if-exists` files

```bash
# Load .env (required) and .env.local (optional, if exists)
tailor-sdk apply --env-file .env --env-file-if-exists .env.local

# Load multiple files
tailor-sdk apply --env-file .env --env-file .env.production
```

## Environment Variables

You can use environment variables to configure workspace and authentication:

| Variable                                     | Description                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `TAILOR_PLATFORM_WORKSPACE_ID`               | Workspace ID for deployment commands                                        |
| `TAILOR_PLATFORM_ORGANIZATION_ID`            | Organization ID for organization commands                                   |
| `TAILOR_PLATFORM_FOLDER_ID`                  | Folder ID for folder commands                                               |
| `TAILOR_PLATFORM_TOKEN`                      | Authentication token (alternative to `login`)                               |
| `TAILOR_TOKEN`                               | **Deprecated.** Use `TAILOR_PLATFORM_TOKEN` instead                         |
| `TAILOR_PLATFORM_PROFILE`                    | Workspace profile name                                                      |
| `TAILOR_PLATFORM_SDK_CONFIG_PATH`            | Path to SDK config file                                                     |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID`     | Client ID for `login --machineuser`                                         |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET` | Client secret for `login --machineuser`                                     |
| `VISUAL` / `EDITOR`                          | Preferred editor for commands that open files (e.g., `vim`, `code`, `nano`) |
| `TAILOR_CRASH_REPORTS_LOCAL`                 | Local crash log writing: `on` (default) or `off`                            |
| `TAILOR_CRASH_REPORTS_REMOTE`                | Automatic crash report submission: `off` (default) or `on`                  |

### Authentication Token Priority

Token resolution follows this priority order:

1. `TAILOR_PLATFORM_TOKEN` environment variable
2. `TAILOR_TOKEN` environment variable (deprecated)
3. Profile specified via `--profile` option or `TAILOR_PLATFORM_PROFILE`
4. Current user from platform config (`~/.config/tailor-platform/config.yaml`)

### Workspace ID Priority

Workspace ID resolution follows this priority order:

1. `--workspace-id` command option
2. `TAILOR_PLATFORM_WORKSPACE_ID` environment variable
3. Profile specified via `--profile` option or `TAILOR_PLATFORM_PROFILE`

## Commands

### [Application Commands](./cli/application.md)

Commands for managing Tailor Platform applications (work with `tailor.config.ts`).

| Command                                   | Description                       |
| ----------------------------------------- | --------------------------------- |
| [init](./cli/application.md#init)         | Initialize a new project          |
| [generate](./cli/application.md#generate) | Generate files from configuration |
| [apply](./cli/application.md#apply)       | Deploy application to workspace   |
| [remove](./cli/application.md#remove)     | Remove application from workspace |
| [show](./cli/application.md#show)         | Show deployed application info    |

### [TailorDB Commands](./cli/tailordb.md)

Commands for managing TailorDB tables, data, and schema migrations.

| Command                                                                      | Description                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------ |
| [tailordb truncate](./cli/tailordb.md#tailordb-truncate)                     | Truncate TailorDB tables                         |
| [tailordb migration generate](./cli/tailordb.md#tailordb-migration-generate) | Generate migration files from schema snapshot    |
| [tailordb migration set](./cli/tailordb.md#tailordb-migration-set)           | Set migration checkpoint manually                |
| [tailordb migration status](./cli/tailordb.md#tailordb-migration-status)     | Show migration status                            |
| [tailordb erd export](./cli/tailordb.md#tailordb-erd-export)                 | Export ERD artifacts from TailorDB schema (beta) |
| [tailordb erd serve](./cli/tailordb.md#tailordb-erd-serve)                   | Serve ERD locally (beta)                         |
| [tailordb erd deploy](./cli/tailordb.md#tailordb-erd-deploy)                 | Deploy ERD static website (beta)                 |

Note: Migration scripts are automatically executed during `tailor-sdk apply`. See [Automatic Migration Execution](./cli/tailordb.md#automatic-migration-execution) for details.

### [User & Auth Commands](./cli/user.md)

Commands for authentication and user management.

| Command                                          | Description                    |
| ------------------------------------------------ | ------------------------------ |
| [login](./cli/user.md#login)                     | Login to Tailor Platform       |
| [logout](./cli/user.md#logout)                   | Logout from Tailor Platform    |
| [user current](./cli/user.md#user-current)       | Show current user              |
| [user list](./cli/user.md#user-list)             | List all users                 |
| [user switch](./cli/user.md#user-switch)         | Set current user               |
| [user pat list](./cli/user.md#user-pat-list)     | List personal access tokens    |
| [user pat create](./cli/user.md#user-pat-create) | Create a personal access token |
| [user pat delete](./cli/user.md#user-pat-delete) | Delete a personal access token |
| [user pat update](./cli/user.md#user-pat-update) | Update a personal access token |

### Workspace & Organization Commands

Commands for managing workspaces, profiles, organizations, and folders.

**[Organization Commands](./cli/organization.md)**

| Command                                                                        | Description                                     |
| ------------------------------------------------------------------------------ | ----------------------------------------------- |
| [organization list](./cli/organization.md#organization-list)                   | List organizations you belong to                |
| [organization get](./cli/organization.md#organization-get)                     | Show detailed information about an organization |
| [organization update](./cli/organization.md#organization-update)               | Update an organization's name                   |
| [organization tree](./cli/organization.md#organization-tree)                   | Display organization folder hierarchy as a tree |
| [organization folder list](./cli/organization.md#organization-folder-list)     | List folders in an organization                 |
| [organization folder get](./cli/organization.md#organization-folder-get)       | Show detailed information about a folder        |
| [organization folder create](./cli/organization.md#organization-folder-create) | Create a new folder in an organization          |
| [organization folder update](./cli/organization.md#organization-folder-update) | Update a folder's name                          |
| [organization folder delete](./cli/organization.md#organization-folder-delete) | Delete a folder from an organization            |

**[Workspace Commands](./cli/workspace.md)**

| Command                                                 | Description            |
| ------------------------------------------------------- | ---------------------- |
| [workspace create](./cli/workspace.md#workspace-create) | Create a new workspace |
| [workspace list](./cli/workspace.md#workspace-list)     | List all workspaces    |
| [workspace delete](./cli/workspace.md#workspace-delete) | Delete a workspace     |
| [profile create](./cli/workspace.md#profile-create)     | Create a new profile   |
| [profile list](./cli/workspace.md#profile-list)         | List all profiles      |
| [profile update](./cli/workspace.md#profile-update)     | Update a profile       |
| [profile delete](./cli/workspace.md#profile-delete)     | Delete a profile       |

### [Auth Resource Commands](./cli/auth.md)

Commands for managing Auth service resources.

| Command                                                            | Description                   |
| ------------------------------------------------------------------ | ----------------------------- |
| [authconnection authorize](./cli/auth.md#authconnection-authorize) | Authorize an auth connection  |
| [authconnection list](./cli/auth.md#authconnection-list)           | List all auth connections     |
| [authconnection revoke](./cli/auth.md#authconnection-revoke)       | Revoke an auth connection     |
| [machineuser list](./cli/auth.md#machineuser-list)                 | List machine users            |
| [machineuser token](./cli/auth.md#machineuser-token)               | Get machine user access token |
| [oauth2client list](./cli/auth.md#oauth2client-list)               | List OAuth2 clients           |
| [oauth2client get](./cli/auth.md#oauth2client-get)                 | Get OAuth2 client credentials |

### [Workflow Commands](./cli/workflow.md)

Commands for managing workflows and executions.

| Command                                                      | Description                |
| ------------------------------------------------------------ | -------------------------- |
| [workflow list](./cli/workflow.md#workflow-list)             | List all workflows         |
| [workflow get](./cli/workflow.md#workflow-get)               | Get workflow details       |
| [workflow start](./cli/workflow.md#workflow-start)           | Start a workflow execution |
| [workflow executions](./cli/workflow.md#workflow-executions) | List or get executions     |
| [workflow resume](./cli/workflow.md#workflow-resume)         | Resume a failed execution  |

### [Function Commands](./cli/function.md)

Commands for viewing function execution logs.

| Command                                          | Description                         |
| ------------------------------------------------ | ----------------------------------- |
| [function logs](./cli/function.md#function-logs) | List or get function execution logs |

### [Executor Commands](./cli/executor.md)

Commands for managing executors and executor jobs.

| Command                                                | Description                  |
| ------------------------------------------------------ | ---------------------------- |
| [executor trigger](./cli/executor.md#executor-trigger) | Trigger an executor manually |
| [executor jobs](./cli/executor.md#executor-jobs)       | List or get executor jobs    |

### [Secret Commands](./cli/secret.md)

Commands for managing secrets and vaults.

| Command                                                    | Description             |
| ---------------------------------------------------------- | ----------------------- |
| [secret vault create](./cli/secret.md#secret-vault-create) | Create a vault          |
| [secret vault delete](./cli/secret.md#secret-vault-delete) | Delete a vault          |
| [secret vault list](./cli/secret.md#secret-vault-list)     | List all vaults         |
| [secret create](./cli/secret.md#secret-create)             | Create a secret         |
| [secret update](./cli/secret.md#secret-update)             | Update a secret         |
| [secret list](./cli/secret.md#secret-list)                 | List secrets in a vault |
| [secret delete](./cli/secret.md#secret-delete)             | Delete a secret         |

### [Static Website Commands](./cli/staticwebsite.md)

Commands for managing and deploying static websites.

| Command                                                             | Description                                          |
| ------------------------------------------------------------------- | ---------------------------------------------------- |
| [staticwebsite deploy](./cli/staticwebsite.md#staticwebsite-deploy) | Deploy a static website from a local build directory |
| [staticwebsite list](./cli/staticwebsite.md#staticwebsite-list)     | List static websites in a workspace                  |
| [staticwebsite get](./cli/staticwebsite.md#staticwebsite-get)       | Get details of a static website                      |

### [Crash Report Commands](./cli/crash-report.md)

Commands for managing crash reports.

| Command                                                      | Description                                   |
| ------------------------------------------------------------ | --------------------------------------------- |
| [crash-report list](./cli/crash-report.md#crash-report-list) | List local crash report files                 |
| [crash-report send](./cli/crash-report.md#crash-report-send) | Submit a crash report to help improve the SDK |

### [Setup Commands](./cli/setup.md)

Commands for setting up project infrastructure.

| Command                                     | Description                                     |
| ------------------------------------------- | ----------------------------------------------- |
| [setup github](./cli/setup.md#setup-github) | Generate GitHub Actions workflow for deployment |

### [Completion](./cli/completion.md)

Generate shell completion scripts for bash, zsh, and fish.

| Command                                      | Description                      |
| -------------------------------------------- | -------------------------------- |
| [completion](./cli/completion.md#completion) | Generate shell completion script |
