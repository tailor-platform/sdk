# Workspace Commands

Commands for managing workspaces and profiles.

<!-- politty:command:workspace:start -->

## workspace

Manage Tailor Platform workspaces.

**Usage**

```
tailor-sdk workspace [command]
```

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

<!-- politty:command:workspace:end -->
<!-- politty:command:workspace create:start -->

### workspace create

Create a new Tailor Platform workspace.

**Usage**

```
tailor-sdk workspace create [options]
```

**Options**

| Option                                | Alias | Description                                           | Default |
| ------------------------------------- | ----- | ----------------------------------------------------- | ------- |
| `--json`                              | `-j`  | Output as JSON                                        | `false` |
| `--name <NAME>`                       | `-n`  | Workspace name                                        | -       |
| `--region <REGION>`                   | `-r`  | Workspace region (us-west, asia-northeast)            | -       |
| `--delete-protection`                 | `-d`  | Enable delete protection                              | `false` |
| `--organization-id <ORGANIZATION_ID>` | `-o`  | Organization ID to workspace associate with           | -       |
| `--folder-id <FOLDER_ID>`             | `-f`  | Folder ID to workspace associate with                 | -       |
| `--profile-name <PROFILE_NAME>`       | `-p`  | Profile name to create                                | -       |
| `--profile-user <PROFILE_USER>`       | -     | User email for the profile (defaults to current user) | -       |

<!-- politty:command:workspace create:end -->
<!-- politty:command:workspace list:start -->

### workspace list

List all Tailor Platform workspaces.

**Usage**

```
tailor-sdk workspace list [options]
```

**Options**

| Option            | Alias | Description                          | Default |
| ----------------- | ----- | ------------------------------------ | ------- |
| `--json`          | `-j`  | Output as JSON                       | `false` |
| `--limit <LIMIT>` | `-l`  | Maximum number of workspaces to list | -       |

<!-- politty:command:workspace list:end -->
<!-- politty:command:workspace delete:start -->

### workspace delete

Delete a Tailor Platform workspace.

**Usage**

```
tailor-sdk workspace delete [options]
```

**Options**

| Option                          | Alias | Description               | Default |
| ------------------------------- | ----- | ------------------------- | ------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID              | -       |
| `--yes`                         | `-y`  | Skip confirmation prompts | `false` |

<!-- politty:command:workspace delete:end -->
<!-- politty:command:profile:start -->

## profile

Manage workspace profiles (user + workspace combinations).

**Usage**

```
tailor-sdk profile [command]
```

**Commands**

| Command                             | Description                |
| ----------------------------------- | -------------------------- |
| [`profile create`](#profile-create) | Create a new profile.      |
| [`profile delete`](#profile-delete) | Delete a profile.          |
| [`profile list`](#profile-list)     | List all profiles.         |
| [`profile update`](#profile-update) | Update profile properties. |

<!-- politty:command:profile:end -->
<!-- politty:command:profile create:start -->

### profile create

Create a new profile.

**Usage**

```
tailor-sdk profile create [options] <name>
```

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `name`   | Profile name | Yes      |

**Options**

| Option                          | Alias | Description    | Default |
| ------------------------------- | ----- | -------------- | ------- |
| `--json`                        | `-j`  | Output as JSON | `false` |
| `--user <USER>`                 | `-u`  | User email     | -       |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID   | -       |

<!-- politty:command:profile create:end -->
<!-- politty:command:profile list:start -->

### profile list

List all profiles.

**Usage**

```
tailor-sdk profile list [options]
```

**Options**

| Option   | Alias | Description    | Default |
| -------- | ----- | -------------- | ------- |
| `--json` | `-j`  | Output as JSON | `false` |

<!-- politty:command:profile list:end -->
<!-- politty:command:profile update:start -->

### profile update

Update profile properties.

**Usage**

```
tailor-sdk profile update [options] <name>
```

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `name`   | Profile name | Yes      |

**Options**

| Option                          | Alias | Description      | Default |
| ------------------------------- | ----- | ---------------- | ------- |
| `--json`                        | `-j`  | Output as JSON   | `false` |
| `--user <USER>`                 | `-u`  | New user email   | -       |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | New workspace ID | -       |

<!-- politty:command:profile update:end -->
<!-- politty:command:profile delete:start -->

### profile delete

Delete a profile.

**Usage**

```
tailor-sdk profile delete [options] <name>
```

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `name`   | Profile name | Yes      |

<!-- politty:command:profile delete:end -->

<!-- politty:command:workspace app:start -->

### workspace app

Manage workspace applications

**Usage**

```
tailor-sdk workspace app [command]
```

**Commands**

| Command                                         | Description                      |
| ----------------------------------------------- | -------------------------------- |
| [`workspace app health`](#workspace-app-health) | Check application schema health  |
| [`workspace app list`](#workspace-app-list)     | List applications in a workspace |

<!-- politty:command:workspace app:end -->

<!-- politty:command:workspace app health:start -->

#### workspace app health

Check application schema health

**Usage**

```
tailor-sdk workspace app health [options]
```

**Options**

| Option                          | Alias | Description       | Default |
| ------------------------------- | ----- | ----------------- | ------- |
| `--json`                        | `-j`  | Output as JSON    | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | -       |
| `--name <NAME>`                 | `-n`  | Application name  | -       |

<!-- politty:command:workspace app health:end -->

<!-- politty:command:workspace app list:start -->

#### workspace app list

List applications in a workspace

**Usage**

```
tailor-sdk workspace app list [options]
```

**Options**

| Option                          | Alias | Description                            | Default |
| ------------------------------- | ----- | -------------------------------------- | ------- |
| `--json`                        | `-j`  | Output as JSON                         | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                           | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                      | -       |
| `--limit <LIMIT>`               | `-l`  | Maximum number of applications to list | -       |

<!-- politty:command:workspace app list:end -->

<!-- politty:command:workspace get:start -->

### workspace get

Show detailed information about a workspace

**Usage**

```
tailor-sdk workspace get [options]
```

**Options**

| Option                          | Alias | Description       | Default |
| ------------------------------- | ----- | ----------------- | ------- |
| `--json`                        | `-j`  | Output as JSON    | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | -       |

<!-- politty:command:workspace get:end -->

<!-- politty:command:workspace restore:start -->

### workspace restore

Restore a deleted workspace

**Usage**

```
tailor-sdk workspace restore [options]
```

**Options**

| Option                          | Alias | Description               | Default |
| ------------------------------- | ----- | ------------------------- | ------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID              | -       |
| `--yes`                         | `-y`  | Skip confirmation prompts | `false` |

<!-- politty:command:workspace restore:end -->

<!-- politty:command:workspace user:start -->

### workspace user

Manage workspace users

**Usage**

```
tailor-sdk workspace user [command]
```

**Commands**

| Command                                           | Description                         |
| ------------------------------------------------- | ----------------------------------- |
| [`workspace user invite`](#workspace-user-invite) | Invite a user to a workspace        |
| [`workspace user list`](#workspace-user-list)     | List users in a workspace           |
| [`workspace user remove`](#workspace-user-remove) | Remove a user from a workspace      |
| [`workspace user update`](#workspace-user-update) | Update a user's role in a workspace |

<!-- politty:command:workspace user:end -->

<!-- politty:command:workspace user invite:start -->

#### workspace user invite

Invite a user to a workspace

**Usage**

```
tailor-sdk workspace user invite [options]
```

**Options**

| Option                          | Alias | Description                            | Default |
| ------------------------------- | ----- | -------------------------------------- | ------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                           | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                      | -       |
| `--email <EMAIL>`               | -     | Email address of the user to invite    | -       |
| `--role <ROLE>`                 | `-r`  | Role to assign (admin, editor, viewer) | -       |

<!-- politty:command:workspace user invite:end -->

<!-- politty:command:workspace user list:start -->

#### workspace user list

List users in a workspace

**Usage**

```
tailor-sdk workspace user list [options]
```

**Options**

| Option                          | Alias | Description                     | Default |
| ------------------------------- | ----- | ------------------------------- | ------- |
| `--json`                        | `-j`  | Output as JSON                  | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                    | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile               | -       |
| `--limit <LIMIT>`               | `-l`  | Maximum number of users to list | -       |

<!-- politty:command:workspace user list:end -->

<!-- politty:command:workspace user remove:start -->

#### workspace user remove

Remove a user from a workspace

**Usage**

```
tailor-sdk workspace user remove [options]
```

**Options**

| Option                          | Alias | Description                         | Default |
| ------------------------------- | ----- | ----------------------------------- | ------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                        | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                   | -       |
| `--email <EMAIL>`               | -     | Email address of the user to remove | -       |
| `--yes`                         | `-y`  | Skip confirmation prompts           | `false` |

<!-- politty:command:workspace user remove:end -->

<!-- politty:command:workspace user update:start -->

#### workspace user update

Update a user's role in a workspace

**Usage**

```
tailor-sdk workspace user update [options]
```

**Options**

| Option                          | Alias | Description                                | Default |
| ------------------------------- | ----- | ------------------------------------------ | ------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                               | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                          | -       |
| `--email <EMAIL>`               | -     | Email address of the user to update        | -       |
| `--role <ROLE>`                 | `-r`  | New role to assign (admin, editor, viewer) | -       |

<!-- politty:command:workspace user update:end -->
