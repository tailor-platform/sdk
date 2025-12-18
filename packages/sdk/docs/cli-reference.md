# CLI Reference

The Tailor Platform SDK provides a command-line interface for managing projects and workspaces.

## Usage

```bash
tailor-sdk <command> [options]
```

## Common Options

The following options are available for most commands:

- `-e, --env-file` - Specify a custom environment file path
- `-v, --verbose` - Enable detailed logging output

## Environment Variables

You can use environment variables to configure workspace and authentication:

- `TAILOR_PLATFORM_WORKSPACE_ID` - Specify workspace ID for the `apply` command
- `TAILOR_PLATFORM_TOKEN` - Specify authentication token (alternative to using `login`)
- `TAILOR_PLATFORM_PROFILE` - Specify workspace profile name to use (see [profile commands](./cli/workspace.md#profile))
- `TAILOR_PLATFORM_SDK_CONFIG_PATH` - Specify path to the SDK config file (alternative to using `--config` option)

## Commands

### [Application Commands](./cli/application.md)

Commands for managing Tailor Platform applications (work with `tailor.config.ts`).

| Command                                                     | Description                       |
| ----------------------------------------------------------- | --------------------------------- |
| [init](./cli/application.md#init)                           | Initialize a new project          |
| [generate](./cli/application.md#generate)                   | Generate files from configuration |
| [apply](./cli/application.md#apply)                         | Deploy application to workspace   |
| [remove](./cli/application.md#remove)                       | Remove application from workspace |
| [show](./cli/application.md#show)                           | Show deployed application info    |
| [tailordb truncate](./cli/application.md#tailordb-truncate) | Truncate TailorDB tables          |

### [User & Auth Commands](./cli/user.md)

Commands for authentication and user management.

| Command                                          | Description                    |
| ------------------------------------------------ | ------------------------------ |
| [login](./cli/user.md#login)                     | Login to Tailor Platform       |
| [logout](./cli/user.md#logout)                   | Logout from Tailor Platform    |
| [user current](./cli/user.md#user-current)       | Show current user              |
| [user list](./cli/user.md#user-list)             | List all users                 |
| [user use](./cli/user.md#user-use)               | Set current user               |
| [user pat list](./cli/user.md#user-pat-list)     | List personal access tokens    |
| [user pat create](./cli/user.md#user-pat-create) | Create a personal access token |
| [user pat delete](./cli/user.md#user-pat-delete) | Delete a personal access token |
| [user pat update](./cli/user.md#user-pat-update) | Update a personal access token |

### [Workspace Commands](./cli/workspace.md)

Commands for managing workspaces and profiles.

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

| Command                                              | Description                   |
| ---------------------------------------------------- | ----------------------------- |
| [machineuser list](./cli/auth.md#machineuser-list)   | List machine users            |
| [machineuser token](./cli/auth.md#machineuser-token) | Get machine user access token |
| [oauth2client list](./cli/auth.md#oauth2client-list) | List OAuth2 clients           |
| [oauth2client get](./cli/auth.md#oauth2client-get)   | Get OAuth2 client credentials |

### [Workflow Commands](./cli/workflow.md)

Commands for managing workflows and executions.

| Command                                                      | Description                |
| ------------------------------------------------------------ | -------------------------- |
| [workflow list](./cli/workflow.md#workflow-list)             | List all workflows         |
| [workflow get](./cli/workflow.md#workflow-get)               | Get workflow details       |
| [workflow start](./cli/workflow.md#workflow-start)           | Start a workflow execution |
| [workflow executions](./cli/workflow.md#workflow-executions) | List or get executions     |
| [workflow resume](./cli/workflow.md#workflow-resume)         | Resume a failed execution  |

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
