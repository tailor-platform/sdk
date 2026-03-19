# Workspace Commands

Commands for managing workspaces and profiles.

<!-- politty:command:workspace:heading:start -->

## workspace

<!-- politty:command:workspace:heading:end -->

<!-- politty:command:workspace:description:start -->

Manage Tailor Platform workspaces.

<!-- politty:command:workspace:description:end -->

<!-- politty:command:workspace:usage:start -->

**Usage**

```
tailor-sdk workspace [command]
```

<!-- politty:command:workspace:usage:end -->

<!-- politty:command:workspace:subcommands:start -->

**Commands**

| Command                                   | Description                                 |
| ----------------------------------------- | ------------------------------------------- |
| [`workspace app`](#workspace-app)         | Manage workspace applications               |
| [`workspace create`](#workspace-create)   | Create a new Tailor Platform workspace.     |
| [`workspace delete`](#workspace-delete)   | Delete a Tailor Platform workspace.         |
| [`workspace get`](#workspace-get)         | Show detailed information about a workspace |
| [`workspace list`](#workspace-list)       | List all Tailor Platform workspaces.        |
| [`workspace restore`](#workspace-restore) | Restore a deleted workspace                 |
| [`workspace user`](#workspace-user)       | Manage workspace users                      |

<!-- politty:command:workspace:subcommands:end -->

<!-- politty:command:workspace:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workspace:global-options-link:end -->
<!-- politty:command:workspace create:heading:start -->

### workspace create

<!-- politty:command:workspace create:heading:end -->

<!-- politty:command:workspace create:description:start -->

Create a new Tailor Platform workspace.

<!-- politty:command:workspace create:description:end -->

<!-- politty:command:workspace create:usage:start -->

**Usage**

```
tailor-sdk workspace create [options]
```

<!-- politty:command:workspace create:usage:end -->

<!-- politty:command:workspace create:options:start -->

**Options**

| Option                                | Alias | Description                                           | Required | Default | Env                               |
| ------------------------------------- | ----- | ----------------------------------------------------- | -------- | ------- | --------------------------------- |
| `--name <NAME>`                       | `-n`  | Workspace name                                        | Yes      | -       | -                                 |
| `--region <REGION>`                   | `-r`  | Workspace region (us-west, asia-northeast)            | Yes      | -       | -                                 |
| `--delete-protection`                 | `-d`  | Enable delete protection                              | No       | `false` | -                                 |
| `--organization-id <ORGANIZATION_ID>` | `-o`  | Organization ID to workspace associate with           | No       | -       | `TAILOR_PLATFORM_ORGANIZATION_ID` |
| `--folder-id <FOLDER_ID>`             | `-f`  | Folder ID to workspace associate with                 | No       | -       | `TAILOR_PLATFORM_FOLDER_ID`       |
| `--profile-name <PROFILE_NAME>`       | `-p`  | Profile name to create                                | No       | -       | -                                 |
| `--profile-user <PROFILE_USER>`       | -     | User email for the profile (defaults to current user) | No       | -       | -                                 |

<!-- politty:command:workspace create:options:end -->

<!-- politty:command:workspace create:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workspace create:global-options-link:end -->
<!-- politty:command:workspace list:heading:start -->

### workspace list

<!-- politty:command:workspace list:heading:end -->

<!-- politty:command:workspace list:description:start -->

List all Tailor Platform workspaces.

<!-- politty:command:workspace list:description:end -->

<!-- politty:command:workspace list:usage:start -->

**Usage**

```
tailor-sdk workspace list [options]
```

<!-- politty:command:workspace list:usage:end -->

<!-- politty:command:workspace list:options:start -->

**Options**

| Option            | Alias | Description                          | Required | Default |
| ----------------- | ----- | ------------------------------------ | -------- | ------- |
| `--limit <LIMIT>` | `-l`  | Maximum number of workspaces to list | No       | -       |

<!-- politty:command:workspace list:options:end -->

<!-- politty:command:workspace list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workspace list:global-options-link:end -->
<!-- politty:command:workspace delete:heading:start -->

### workspace delete

<!-- politty:command:workspace delete:heading:end -->

<!-- politty:command:workspace delete:description:start -->

Delete a Tailor Platform workspace.

<!-- politty:command:workspace delete:description:end -->

<!-- politty:command:workspace delete:usage:start -->

**Usage**

```
tailor-sdk workspace delete [options]
```

<!-- politty:command:workspace delete:usage:end -->

<!-- politty:command:workspace delete:options:start -->

**Options**

| Option                          | Alias | Description               | Required | Default |
| ------------------------------- | ----- | ------------------------- | -------- | ------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID              | Yes      | -       |
| `--yes`                         | `-y`  | Skip confirmation prompts | No       | `false` |

<!-- politty:command:workspace delete:options:end -->

<!-- politty:command:workspace delete:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workspace delete:global-options-link:end -->
<!-- politty:command:profile:heading:start -->

## profile

<!-- politty:command:profile:heading:end -->

<!-- politty:command:profile:description:start -->

Manage workspace profiles (user + workspace combinations).

<!-- politty:command:profile:description:end -->

<!-- politty:command:profile:usage:start -->

**Usage**

```
tailor-sdk profile [command]
```

<!-- politty:command:profile:usage:end -->

<!-- politty:command:profile:subcommands:start -->

**Commands**

| Command                             | Description                |
| ----------------------------------- | -------------------------- |
| [`profile create`](#profile-create) | Create a new profile.      |
| [`profile delete`](#profile-delete) | Delete a profile.          |
| [`profile list`](#profile-list)     | List all profiles.         |
| [`profile update`](#profile-update) | Update profile properties. |

<!-- politty:command:profile:subcommands:end -->

<!-- politty:command:profile:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:profile:global-options-link:end -->
<!-- politty:command:profile create:heading:start -->

### profile create

<!-- politty:command:profile create:heading:end -->

<!-- politty:command:profile create:description:start -->

Create a new profile.

<!-- politty:command:profile create:description:end -->

<!-- politty:command:profile create:usage:start -->

**Usage**

```
tailor-sdk profile create [options] <name>
```

<!-- politty:command:profile create:usage:end -->

<!-- politty:command:profile create:arguments:start -->

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `name`   | Profile name | Yes      |

<!-- politty:command:profile create:arguments:end -->

<!-- politty:command:profile create:options:start -->

**Options**

| Option                          | Alias | Description  | Required | Default |
| ------------------------------- | ----- | ------------ | -------- | ------- |
| `--user <USER>`                 | `-u`  | User email   | Yes      | -       |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID | Yes      | -       |

<!-- politty:command:profile create:options:end -->

<!-- politty:command:profile create:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:profile create:global-options-link:end -->
<!-- politty:command:profile list:heading:start -->

### profile list

<!-- politty:command:profile list:heading:end -->

<!-- politty:command:profile list:description:start -->

List all profiles.

<!-- politty:command:profile list:description:end -->

<!-- politty:command:profile list:usage:start -->

**Usage**

```
tailor-sdk profile list
```

<!-- politty:command:profile list:usage:end -->

<!-- politty:command:profile list:options:start -->
<!-- politty:command:profile list:options:end -->

<!-- politty:command:profile list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:profile list:global-options-link:end -->
<!-- politty:command:profile update:heading:start -->

### profile update

<!-- politty:command:profile update:heading:end -->

<!-- politty:command:profile update:description:start -->

Update profile properties.

<!-- politty:command:profile update:description:end -->

<!-- politty:command:profile update:usage:start -->

**Usage**

```
tailor-sdk profile update [options] <name>
```

<!-- politty:command:profile update:usage:end -->

<!-- politty:command:profile update:arguments:start -->

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `name`   | Profile name | Yes      |

<!-- politty:command:profile update:arguments:end -->

<!-- politty:command:profile update:options:start -->

**Options**

| Option                          | Alias | Description      | Required | Default |
| ------------------------------- | ----- | ---------------- | -------- | ------- |
| `--user <USER>`                 | `-u`  | New user email   | No       | -       |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | New workspace ID | No       | -       |

<!-- politty:command:profile update:options:end -->

<!-- politty:command:profile update:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:profile update:global-options-link:end -->
<!-- politty:command:profile delete:heading:start -->

### profile delete

<!-- politty:command:profile delete:heading:end -->

<!-- politty:command:profile delete:description:start -->

Delete a profile.

<!-- politty:command:profile delete:description:end -->

<!-- politty:command:profile delete:usage:start -->

**Usage**

```
tailor-sdk profile delete <name>
```

<!-- politty:command:profile delete:usage:end -->

<!-- politty:command:profile delete:arguments:start -->

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `name`   | Profile name | Yes      |

<!-- politty:command:profile delete:arguments:end -->

<!-- politty:command:profile delete:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:profile delete:global-options-link:end -->

<!-- politty:command:workspace app:heading:start -->

### workspace app

<!-- politty:command:workspace app:heading:end -->

<!-- politty:command:workspace app:description:start -->

Manage workspace applications

<!-- politty:command:workspace app:description:end -->

<!-- politty:command:workspace app:usage:start -->

**Usage**

```
tailor-sdk workspace app [command]
```

<!-- politty:command:workspace app:usage:end -->

<!-- politty:command:workspace app:subcommands:start -->

**Commands**

| Command                                         | Description                      |
| ----------------------------------------------- | -------------------------------- |
| [`workspace app health`](#workspace-app-health) | Check application schema health  |
| [`workspace app list`](#workspace-app-list)     | List applications in a workspace |

<!-- politty:command:workspace app:subcommands:end -->

<!-- politty:command:workspace app:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workspace app:global-options-link:end -->

<!-- politty:command:workspace app health:heading:start -->

#### workspace app health

<!-- politty:command:workspace app health:heading:end -->

<!-- politty:command:workspace app health:description:start -->

Check application schema health

<!-- politty:command:workspace app health:description:end -->

<!-- politty:command:workspace app health:usage:start -->

**Usage**

```
tailor-sdk workspace app health [options]
```

<!-- politty:command:workspace app health:usage:end -->

<!-- politty:command:workspace app health:options:start -->

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--name <NAME>`                 | `-n`  | Application name  | Yes      | -       | -                              |

<!-- politty:command:workspace app health:options:end -->

<!-- politty:command:workspace app health:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workspace app health:global-options-link:end -->

<!-- politty:command:workspace app list:heading:start -->

#### workspace app list

<!-- politty:command:workspace app list:heading:end -->

<!-- politty:command:workspace app list:description:start -->

List applications in a workspace

<!-- politty:command:workspace app list:description:end -->

<!-- politty:command:workspace app list:usage:start -->

**Usage**

```
tailor-sdk workspace app list [options]
```

<!-- politty:command:workspace app list:usage:end -->

<!-- politty:command:workspace app list:options:start -->

**Options**

| Option                          | Alias | Description                            | Required | Default | Env                            |
| ------------------------------- | ----- | -------------------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                           | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                      | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--limit <LIMIT>`               | `-l`  | Maximum number of applications to list | No       | -       | -                              |

<!-- politty:command:workspace app list:options:end -->

<!-- politty:command:workspace app list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workspace app list:global-options-link:end -->

<!-- politty:command:workspace get:heading:start -->

### workspace get

<!-- politty:command:workspace get:heading:end -->

<!-- politty:command:workspace get:description:start -->

Show detailed information about a workspace

<!-- politty:command:workspace get:description:end -->

<!-- politty:command:workspace get:usage:start -->

**Usage**

```
tailor-sdk workspace get [options]
```

<!-- politty:command:workspace get:usage:end -->

<!-- politty:command:workspace get:options:start -->

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

<!-- politty:command:workspace get:options:end -->

<!-- politty:command:workspace get:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workspace get:global-options-link:end -->

<!-- politty:command:workspace restore:heading:start -->

### workspace restore

<!-- politty:command:workspace restore:heading:end -->

<!-- politty:command:workspace restore:description:start -->

Restore a deleted workspace

<!-- politty:command:workspace restore:description:end -->

<!-- politty:command:workspace restore:usage:start -->

**Usage**

```
tailor-sdk workspace restore [options]
```

<!-- politty:command:workspace restore:usage:end -->

<!-- politty:command:workspace restore:options:start -->

**Options**

| Option                          | Alias | Description               | Required | Default |
| ------------------------------- | ----- | ------------------------- | -------- | ------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID              | Yes      | -       |
| `--yes`                         | `-y`  | Skip confirmation prompts | No       | `false` |

<!-- politty:command:workspace restore:options:end -->

<!-- politty:command:workspace restore:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workspace restore:global-options-link:end -->

<!-- politty:command:workspace user:heading:start -->

### workspace user

<!-- politty:command:workspace user:heading:end -->

<!-- politty:command:workspace user:description:start -->

Manage workspace users

<!-- politty:command:workspace user:description:end -->

<!-- politty:command:workspace user:usage:start -->

**Usage**

```
tailor-sdk workspace user [command]
```

<!-- politty:command:workspace user:usage:end -->

<!-- politty:command:workspace user:subcommands:start -->

**Commands**

| Command                                           | Description                         |
| ------------------------------------------------- | ----------------------------------- |
| [`workspace user invite`](#workspace-user-invite) | Invite a user to a workspace        |
| [`workspace user list`](#workspace-user-list)     | List users in a workspace           |
| [`workspace user remove`](#workspace-user-remove) | Remove a user from a workspace      |
| [`workspace user update`](#workspace-user-update) | Update a user's role in a workspace |

<!-- politty:command:workspace user:subcommands:end -->

<!-- politty:command:workspace user:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workspace user:global-options-link:end -->

<!-- politty:command:workspace user invite:heading:start -->

#### workspace user invite

<!-- politty:command:workspace user invite:heading:end -->

<!-- politty:command:workspace user invite:description:start -->

Invite a user to a workspace

<!-- politty:command:workspace user invite:description:end -->

<!-- politty:command:workspace user invite:usage:start -->

**Usage**

```
tailor-sdk workspace user invite [options]
```

<!-- politty:command:workspace user invite:usage:end -->

<!-- politty:command:workspace user invite:options:start -->

**Options**

| Option                          | Alias | Description                            | Required | Default | Env                            |
| ------------------------------- | ----- | -------------------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                           | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                      | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--email <EMAIL>`               | -     | Email address of the user to invite    | Yes      | -       | -                              |
| `--role <ROLE>`                 | `-r`  | Role to assign (admin, editor, viewer) | Yes      | -       | -                              |

<!-- politty:command:workspace user invite:options:end -->

<!-- politty:command:workspace user invite:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workspace user invite:global-options-link:end -->

<!-- politty:command:workspace user list:heading:start -->

#### workspace user list

<!-- politty:command:workspace user list:heading:end -->

<!-- politty:command:workspace user list:description:start -->

List users in a workspace

<!-- politty:command:workspace user list:description:end -->

<!-- politty:command:workspace user list:usage:start -->

**Usage**

```
tailor-sdk workspace user list [options]
```

<!-- politty:command:workspace user list:usage:end -->

<!-- politty:command:workspace user list:options:start -->

**Options**

| Option                          | Alias | Description                     | Required | Default | Env                            |
| ------------------------------- | ----- | ------------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                    | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile               | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--limit <LIMIT>`               | `-l`  | Maximum number of users to list | No       | -       | -                              |

<!-- politty:command:workspace user list:options:end -->

<!-- politty:command:workspace user list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workspace user list:global-options-link:end -->

<!-- politty:command:workspace user remove:heading:start -->

#### workspace user remove

<!-- politty:command:workspace user remove:heading:end -->

<!-- politty:command:workspace user remove:description:start -->

Remove a user from a workspace

<!-- politty:command:workspace user remove:description:end -->

<!-- politty:command:workspace user remove:usage:start -->

**Usage**

```
tailor-sdk workspace user remove [options]
```

<!-- politty:command:workspace user remove:usage:end -->

<!-- politty:command:workspace user remove:options:start -->

**Options**

| Option                          | Alias | Description                         | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                        | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                   | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--email <EMAIL>`               | -     | Email address of the user to remove | Yes      | -       | -                              |
| `--yes`                         | `-y`  | Skip confirmation prompts           | No       | `false` | -                              |

<!-- politty:command:workspace user remove:options:end -->

<!-- politty:command:workspace user remove:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workspace user remove:global-options-link:end -->

<!-- politty:command:workspace user update:heading:start -->

#### workspace user update

<!-- politty:command:workspace user update:heading:end -->

<!-- politty:command:workspace user update:description:start -->

Update a user's role in a workspace

<!-- politty:command:workspace user update:description:end -->

<!-- politty:command:workspace user update:usage:start -->

**Usage**

```
tailor-sdk workspace user update [options]
```

<!-- politty:command:workspace user update:usage:end -->

<!-- politty:command:workspace user update:options:start -->

**Options**

| Option                          | Alias | Description                                | Required | Default | Env                            |
| ------------------------------- | ----- | ------------------------------------------ | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                               | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                          | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--email <EMAIL>`               | -     | Email address of the user to update        | Yes      | -       | -                              |
| `--role <ROLE>`                 | `-r`  | New role to assign (admin, editor, viewer) | Yes      | -       | -                              |

<!-- politty:command:workspace user update:options:end -->

<!-- politty:command:workspace user update:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workspace user update:global-options-link:end -->
