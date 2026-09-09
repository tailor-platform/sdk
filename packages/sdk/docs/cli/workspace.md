# Workspace Commands

Commands for managing workspaces and profiles.

## workspace

Manage Tailor Platform workspaces.

**Usage**

```
tailor workspace [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                   | Description                                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [`workspace app`](#workspace-app)         | Manage workspace applications                                                                  |
| [`workspace create`](#workspace-create)   | Create a new Tailor Platform workspace.                                                        |
| [`workspace delete`](#workspace-delete)   | Delete a Tailor Platform workspace.                                                            |
| [`workspace get`](#workspace-get)         | Show detailed information about a workspace                                                    |
| [`workspace list`](#workspace-list)       | List all Tailor Platform workspaces.                                                           |
| [`workspace prune`](#workspace-prune)     | Delete stale temporary workspaces, by name and age or by the expiry each recorded at creation. |
| [`workspace restore`](#workspace-restore) | Restore a deleted workspace                                                                    |
| [`workspace ttl`](#workspace-ttl)         | Manage when a workspace becomes prunable.                                                      |
| [`workspace user`](#workspace-user)       | Manage workspace users                                                                         |

### workspace app

Manage workspace applications

**Usage**

```
tailor workspace app [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                         | Description                      |
| ----------------------------------------------- | -------------------------------- |
| [`workspace app health`](#workspace-app-health) | Check application schema health  |
| [`workspace app list`](#workspace-app-list)     | List applications in a workspace |

#### workspace app health

Check application schema health

**Usage**

```
tailor workspace app health [options]
```

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--name <NAME>`                 | `-n`  | Application name  | Yes      | -       | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### workspace app list

List applications in a workspace

**Usage**

```
tailor workspace app list [options]
```

**Options**

| Option                          | Alias | Description                                              | Required | Default  | Env                            |
| ------------------------------- | ----- | -------------------------------------------------------- | -------- | -------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                             | No       | -        | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                        | No       | -        | `TAILOR_PLATFORM_PROFILE`      |
| `--order <ORDER>`               | -     | Sort order (asc or desc)                                 | No       | `"desc"` | -                              |
| `--limit <LIMIT>`               | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -        | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### workspace create

Create a new Tailor Platform workspace.

**Usage**

```
tailor workspace create [options]
```

**Options**

| Option                                | Alias | Description                                                                                                                                   | Required | Default   | Env                               |
| ------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------- | --------------------------------- |
| `--name <NAME>`                       | `-n`  | Workspace name                                                                                                                                | Yes      | -         | -                                 |
| `--region <REGION>`                   | `-r`  | Workspace region (us-west, asia-northeast)                                                                                                    | Yes      | -         | -                                 |
| `--delete-protection`                 | `-d`  | Enable delete protection                                                                                                                      | No       | `false`   | -                                 |
| `--organization-id <ORGANIZATION_ID>` | `-o`  | Organization ID to workspace associate with                                                                                                   | No       | -         | `TAILOR_PLATFORM_ORGANIZATION_ID` |
| `--folder-id <FOLDER_ID>`             | `-f`  | Folder ID to workspace associate with                                                                                                         | No       | -         | `TAILOR_PLATFORM_FOLDER_ID`       |
| `--ttl <TTL>`                         | -     | Record on the workspace itself when it becomes prunable, such as 30m, 24h, or 7d. `workspace prune --expired` deletes it once that has passed | No       | -         | -                                 |
| `--profile-name <PROFILE_NAME>`       | `-p`  | Profile name to create                                                                                                                        | No       | -         | -                                 |
| `--profile <PROFILE>`                 | -     | Workspace profile used for authentication and Platform selection                                                                              | No       | -         | `TAILOR_PLATFORM_PROFILE`         |
| `--profile-user <PROFILE_USER>`       | -     | User email address or machine user client ID for the profile (defaults to current user)                                                       | No       | -         | -                                 |
| `--permission <PERMISSION>`           | -     | Profile permission (requires --profile-name). 'read' blocks all write commands while the profile is active.                                   | No       | `"write"` | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### workspace delete

Delete a Tailor Platform workspace.

**Usage**

```
tailor workspace delete [options]
```

**Options**

| Option                          | Alias | Description               | Required | Default |
| ------------------------------- | ----- | ------------------------- | -------- | ------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID              | Yes      | -       |
| `--yes`                         | `-y`  | Skip confirmation prompts | No       | `false` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### workspace get

Show detailed information about a workspace

**Usage**

```
tailor workspace get [options]
```

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### workspace list

List all Tailor Platform workspaces.

**Usage**

```
tailor workspace list [options]
```

**Options**

| Option                | Alias | Description                                                      | Required | Default  | Env                       |
| --------------------- | ----- | ---------------------------------------------------------------- | -------- | -------- | ------------------------- |
| `--order <ORDER>`     | -     | Sort order (asc or desc)                                         | No       | `"desc"` | -                         |
| `--limit <LIMIT>`     | `-l`  | Maximum number of items to return (0 or omit: unlimited)         | No       | -        | -                         |
| `--profile <PROFILE>` | -     | Workspace profile used for authentication and Platform selection | No       | -        | `TAILOR_PLATFORM_PROFILE` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### workspace prune

Delete stale temporary workspaces, by name and age or by the expiry each recorded at creation.

**Usage**

```
tailor workspace prune [options]
```

**Options**

| Option                                | Alias | Description                                                                                                                                                      | Required | Default | Env                               |
| ------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | --------------------------------- |
| `--name-prefix <NAME_PREFIX>`         | -     | Select workspaces whose name starts with this prefix (repeatable)                                                                                                | No       | -       | -                                 |
| `--name-regex <NAME_REGEX>`           | -     | Select workspaces whose whole name matches this regular expression                                                                                               | No       | -       | -                                 |
| `--older-than <OLDER_THAN>`           | -     | Minimum age since creation, such as 30m, 24h, or 7d. 0s disables the age check and requires --organization-id or --folder-id. Required unless --expired is given | No       | -       | -                                 |
| `--expired`                           | -     | Select workspaces whose own --ttl expiry has passed, instead of by name and age                                                                                  | No       | `false` | -                                 |
| `--organization-id <ORGANIZATION_ID>` | `-o`  | Only consider workspaces in this organization                                                                                                                    | No       | -       | `TAILOR_PLATFORM_ORGANIZATION_ID` |
| `--folder-id <FOLDER_ID>`             | -     | Only consider workspaces in this folder                                                                                                                          | No       | -       | `TAILOR_PLATFORM_FOLDER_ID`       |
| `--exclude <EXCLUDE>`                 | -     | Keep a workspace with this exact name even when it matches (repeatable)                                                                                          | No       | -       | -                                 |
| `--limit <LIMIT>`                     | -     | Abort when more workspaces match than this, without deleting anything. 0 removes the cap                                                                         | No       | `20`    | -                                 |
| `--dry-run`                           | -     | List the workspaces that would be deleted without deleting them                                                                                                  | No       | `false` | -                                 |
| `--profile <PROFILE>`                 | -     | Workspace profile used for authentication and Platform selection                                                                                                 | No       | -       | `TAILOR_PLATFORM_PROFILE`         |
| `--yes`                               | `-y`  | Skip confirmation prompts                                                                                                                                        | No       | `false` | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Notes**

Use this to reclaim workspaces left behind by CI runs, preview deployments, or interrupted local test runs. A workspace is deleted only when its name matches --name-prefix or --name-regex, it was created at least --older-than ago, and it is not excluded, delete-protected, or outside the --organization-id / --folder-id scope. Run with --dry-run first to see what would be deleted.

With --expired the workspaces select themselves instead: each one is deleted only once the --ttl expiry it recorded at creation has passed, so callers need no name or age filter. A workspace that records no expiry is never deleted this way, and neither is one whose recorded expiry cannot be read. Because that expiry is recorded on the workspace rather than derived from its name, anything able to write the workspace's metadata can bring its deletion forward; --name-prefix, --name-regex, and the scope options still apply and are worth keeping in a shared organization.

Restoring a workspace does not clear its recorded expiry, so a workspace restored after expiring is deleted again by the next --expired run. Restore it, then run `workspace ttl set` or `workspace ttl clear` before the next run — or keep it out of that run with --exclude.

Safety guards: the command aborts without deleting anything when more workspaces match than --limit allows (--dry-run still lists them all), and --older-than 0s (no age check) is only accepted together with --organization-id or --folder-id. Unlike `workspace delete`, a single confirmation covers every listed candidate; pass --yes to skip it in CI. Deleted workspaces can be restored with `workspace restore` for a limited time.

Only workspaces visible to the current login (or the machine user in CI) are considered.

### workspace restore

Restore a deleted workspace

**Usage**

```
tailor workspace restore [options]
```

**Options**

| Option                          | Alias | Description               | Required | Default |
| ------------------------------- | ----- | ------------------------- | -------- | ------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID              | Yes      | -       |
| `--yes`                         | `-y`  | Skip confirmation prompts | No       | `false` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### workspace ttl

Manage when a workspace becomes prunable.

**Usage**

```
tailor workspace ttl [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                       | Description                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`workspace ttl set`](#workspace-ttl-set)     | Record when a workspace becomes prunable, replacing any expiry it already records. |
| [`workspace ttl clear`](#workspace-ttl-clear) | Drop a workspace's recorded prune expiry.                                          |

#### workspace ttl clear

Drop a workspace's recorded prune expiry.

**Usage**

```
tailor workspace ttl clear [options]
```

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Notes**

    A workspace recording no expiry is never deleted by `workspace prune --expired`. Clearing an expiry the workspace does not record succeeds without changing anything.

#### workspace ttl set

Record when a workspace becomes prunable, replacing any expiry it already records.

**Usage**

```
tailor workspace ttl set [options]
```

**Options**

| Option                          | Alias | Description                                                                 | Required | Default | Env                            |
| ------------------------------- | ----- | --------------------------------------------------------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                           | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--ttl <TTL>`                   | -     | Time from now until the workspace becomes prunable, such as 30m, 24h, or 7d | Yes      | -       | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Notes**

    The expiry runs from now, not from when the workspace was created, so `--ttl 24h` always leaves a full day regardless of the workspace's age. Use this to give a restored workspace a new expiry, or to record one after `workspace create --ttl` failed to.

    This is not an auto-delete timer: it only makes the workspace eligible for `workspace prune --expired`, which still honors delete protection and its own filters.

### workspace user

Manage workspace users

**Usage**

```
tailor workspace user [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                           | Description                         |
| ------------------------------------------------- | ----------------------------------- |
| [`workspace user invite`](#workspace-user-invite) | Invite a user to a workspace        |
| [`workspace user list`](#workspace-user-list)     | List users in a workspace           |
| [`workspace user remove`](#workspace-user-remove) | Remove a user from a workspace      |
| [`workspace user update`](#workspace-user-update) | Update a user's role in a workspace |

#### workspace user invite

Invite a user to a workspace

**Usage**

```
tailor workspace user invite [options]
```

**Options**

| Option                          | Alias | Description                            | Required | Default | Env                            |
| ------------------------------- | ----- | -------------------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                           | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                      | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--email <EMAIL>`               | -     | Email address of the user to invite    | Yes      | -       | -                              |
| `--role <ROLE>`                 | `-r`  | Role to assign (admin, editor, viewer) | Yes      | -       | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### workspace user list

List users in a workspace

**Usage**

```
tailor workspace user list [options]
```

**Options**

| Option                          | Alias | Description                                              | Required | Default  | Env                            |
| ------------------------------- | ----- | -------------------------------------------------------- | -------- | -------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                             | No       | -        | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                        | No       | -        | `TAILOR_PLATFORM_PROFILE`      |
| `--order <ORDER>`               | -     | Sort order (asc or desc)                                 | No       | `"desc"` | -                              |
| `--limit <LIMIT>`               | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -        | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### workspace user remove

Remove a user from a workspace

**Usage**

```
tailor workspace user remove [options]
```

**Options**

| Option                          | Alias | Description                         | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                        | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                   | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--email <EMAIL>`               | -     | Email address of the user to remove | Yes      | -       | -                              |
| `--yes`                         | `-y`  | Skip confirmation prompts           | No       | `false` | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### workspace user update

Update a user's role in a workspace

**Usage**

```
tailor workspace user update [options]
```

**Options**

| Option                          | Alias | Description                                | Required | Default | Env                            |
| ------------------------------- | ----- | ------------------------------------------ | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                               | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                          | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--email <EMAIL>`               | -     | Email address of the user to update        | Yes      | -       | -                              |
| `--role <ROLE>`                 | `-r`  | New role to assign (admin, editor, viewer) | Yes      | -       | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

## profile

Manage workspace profiles (user + workspace combinations).

**Usage**

```
tailor profile [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                             | Description                |
| ----------------------------------- | -------------------------- |
| [`profile create`](#profile-create) | Create a new profile.      |
| [`profile delete`](#profile-delete) | Delete a profile.          |
| [`profile list`](#profile-list)     | List all profiles.         |
| [`profile update`](#profile-update) | Update profile properties. |

### profile create

Create a new profile.

**Usage**

```
tailor profile create [options] <name>
```

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `name`   | Profile name | Yes      |

**Options**

| Option                                            | Alias | Description                                                                                                                            | Required | Default   | Env                                |
| ------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------- | ---------------------------------- |
| `--user <USER>`                                   | `-u`  | User email address or machine user client ID                                                                                           | Yes      | -         | -                                  |
| `--workspace-id <WORKSPACE_ID>`                   | `-w`  | Workspace ID                                                                                                                           | Yes      | -         | -                                  |
| `--permission <PERMISSION>`                       | -     | Profile permission. 'read' blocks all write commands while the profile is active.                                                      | No       | `"write"` | -                                  |
| `--machine-user <MACHINE_USER>`                   | `-m`  | Default machine user name for application-data commands (query, workflow start, function run, machineuser token).                      | No       | -         | -                                  |
| `--machine-user-override <MACHINE_USER_OVERRIDE>` | -     | Whether the command line or TAILOR_PLATFORM_MACHINE_USER_NAME may override the profile's machine user. 'deny' requires --machine-user. | No       | -         | -                                  |
| `--platform-url <PLATFORM_URL>`                   | -     | Platform API base URL for this profile.                                                                                                | No       | -         | `TAILOR_PLATFORM_URL`              |
| `--oauth2-client-id <OAUTH2_CLIENT_ID>`           | -     | OAuth2 client ID for logging in to this profile's platform.                                                                            | No       | -         | `TAILOR_PLATFORM_OAUTH2_CLIENT_ID` |
| `--console-url <CONSOLE_URL>`                     | -     | Console base URL for this profile.                                                                                                     | No       | -         | `TAILOR_PLATFORM_CONSOLE_URL`      |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### profile delete

Delete a profile.

**Usage**

```
tailor profile delete <name>
```

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `name`   | Profile name | Yes      |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### profile list

List all profiles.

**Usage**

```
tailor profile list
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### profile update

Update profile properties.

**Usage**

```
tailor profile update [options] <name>
```

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `name`   | Profile name | Yes      |

**Options**

| Option                                            | Alias | Description                                                                                                                                                           | Required | Default |
| ------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- |
| `--user <USER>`                                   | `-u`  | New user email address or machine user client ID                                                                                                                      | No       | -       |
| `--workspace-id <WORKSPACE_ID>`                   | `-w`  | New workspace ID                                                                                                                                                      | No       | -       |
| `--permission <PERMISSION>`                       | -     | Profile permission. 'read' blocks all write commands; 'write' lifts the restriction.                                                                                  | No       | -       |
| `--machine-user <MACHINE_USER>`                   | `-m`  | Default machine user name for application-data commands (query, workflow start, function run, machineuser token). Pass an empty string to clear.                      | No       | -       |
| `--machine-user-override <MACHINE_USER_OVERRIDE>` | -     | Whether the command line or TAILOR_PLATFORM_MACHINE_USER_NAME may override the profile's machine user. 'deny' requires --machine-user; 'allow' lifts the restriction. | No       | -       |
| `--platform-url <PLATFORM_URL>`                   | -     | Platform API base URL for this profile. Pass an empty string to clear.                                                                                                | No       | -       |
| `--oauth2-client-id <OAUTH2_CLIENT_ID>`           | -     | OAuth2 client ID for logging in to this profile's platform. Pass an empty string to clear.                                                                            | No       | -       |
| `--console-url <CONSOLE_URL>`                     | -     | Console base URL for this profile. Pass an empty string to clear.                                                                                                     | No       | -       |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.
