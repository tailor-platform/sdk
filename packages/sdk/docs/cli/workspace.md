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

| Command                                 | Description                             |
| --------------------------------------- | --------------------------------------- |
| [`workspace create`](#workspace-create) | Create a new Tailor Platform workspace. |
| [`workspace delete`](#workspace-delete) | Delete a Tailor Platform workspace.     |
| [`workspace list`](#workspace-list)     | List all Tailor Platform workspaces.    |

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
