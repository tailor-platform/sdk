## organization

Manage Tailor Platform organizations.

**Usage**

```
tailor-sdk organization [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                       | Description                                      |
| --------------------------------------------- | ------------------------------------------------ |
| [`organization folder`](#organization-folder) | Manage organization folders.                     |
| [`organization get`](#organization-get)       | Show detailed information about an organization. |
| [`organization list`](#organization-list)     | List organizations you belong to.                |
| [`organization tree`](#organization-tree)     | Display organization folder hierarchy as a tree. |
| [`organization update`](#organization-update) | Update an organization's name.                   |

### organization folder

Manage organization folders.

**Usage**

```
tailor-sdk organization folder <command>
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                                     | Description                               |
| ----------------------------------------------------------- | ----------------------------------------- |
| [`organization folder create`](#organization-folder-create) | Create a new folder in an organization.   |
| [`organization folder delete`](#organization-folder-delete) | Delete a folder from an organization.     |
| [`organization folder get`](#organization-folder-get)       | Show detailed information about a folder. |
| [`organization folder list`](#organization-folder-list)     | List folders in an organization.          |
| [`organization folder update`](#organization-folder-update) | Update a folder's name.                   |

#### organization folder create

Create a new folder in an organization.

**Usage**

```
tailor-sdk organization folder create [options]
```

**Options**

| Option                                  | Alias | Description      | Required | Default | Env                               |
| --------------------------------------- | ----- | ---------------- | -------- | ------- | --------------------------------- |
| `--organization-id <ORGANIZATION_ID>`   | `-o`  | Organization ID  | Yes      | -       | `TAILOR_PLATFORM_ORGANIZATION_ID` |
| `--parent-folder-id <PARENT_FOLDER_ID>` | -     | Parent folder ID | No       | -       | -                                 |
| `--name <NAME>`                         | `-n`  | Folder name      | Yes      | -       | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### organization folder delete

Delete a folder from an organization.

**Usage**

```
tailor-sdk organization folder delete [options]
```

**Options**

| Option                                | Alias | Description               | Required | Default | Env                               |
| ------------------------------------- | ----- | ------------------------- | -------- | ------- | --------------------------------- |
| `--organization-id <ORGANIZATION_ID>` | `-o`  | Organization ID           | Yes      | -       | `TAILOR_PLATFORM_ORGANIZATION_ID` |
| `--folder-id <FOLDER_ID>`             | `-f`  | Folder ID                 | Yes      | -       | `TAILOR_PLATFORM_FOLDER_ID`       |
| `--yes`                               | `-y`  | Skip confirmation prompts | No       | `false` | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### organization folder get

Show detailed information about a folder.

**Usage**

```
tailor-sdk organization folder get [options]
```

**Options**

| Option                                | Alias | Description     | Required | Default | Env                               |
| ------------------------------------- | ----- | --------------- | -------- | ------- | --------------------------------- |
| `--organization-id <ORGANIZATION_ID>` | `-o`  | Organization ID | Yes      | -       | `TAILOR_PLATFORM_ORGANIZATION_ID` |
| `--folder-id <FOLDER_ID>`             | `-f`  | Folder ID       | Yes      | -       | `TAILOR_PLATFORM_FOLDER_ID`       |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### organization folder list

List folders in an organization.

**Usage**

```
tailor-sdk organization folder list [options]
```

**Options**

| Option                                  | Alias | Description                                              | Required | Default  | Env                               |
| --------------------------------------- | ----- | -------------------------------------------------------- | -------- | -------- | --------------------------------- |
| `--organization-id <ORGANIZATION_ID>`   | `-o`  | Organization ID                                          | Yes      | -        | `TAILOR_PLATFORM_ORGANIZATION_ID` |
| `--parent-folder-id <PARENT_FOLDER_ID>` | -     | Parent folder ID to list children of                     | No       | -        | -                                 |
| `--order <ORDER>`                       | -     | Sort order (asc or desc)                                 | No       | `"desc"` | -                                 |
| `--limit <LIMIT>`                       | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -        | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### organization folder update

Update a folder's name.

**Usage**

```
tailor-sdk organization folder update [options]
```

**Options**

| Option                                | Alias | Description     | Required | Default | Env                               |
| ------------------------------------- | ----- | --------------- | -------- | ------- | --------------------------------- |
| `--organization-id <ORGANIZATION_ID>` | `-o`  | Organization ID | Yes      | -       | `TAILOR_PLATFORM_ORGANIZATION_ID` |
| `--folder-id <FOLDER_ID>`             | `-f`  | Folder ID       | Yes      | -       | `TAILOR_PLATFORM_FOLDER_ID`       |
| `--name <NAME>`                       | `-n`  | New folder name | Yes      | -       | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### organization get

Show detailed information about an organization.

**Usage**

```
tailor-sdk organization get [options]
```

**Options**

| Option                                | Alias | Description     | Required | Default | Env                               |
| ------------------------------------- | ----- | --------------- | -------- | ------- | --------------------------------- |
| `--organization-id <ORGANIZATION_ID>` | `-o`  | Organization ID | Yes      | -       | `TAILOR_PLATFORM_ORGANIZATION_ID` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### organization list

List organizations you belong to.

**Usage**

```
tailor-sdk organization list [options]
```

**Options**

| Option            | Alias | Description                             | Required | Default |
| ----------------- | ----- | --------------------------------------- | -------- | ------- |
| `--limit <LIMIT>` | `-l`  | Maximum number of organizations to list | No       | -       |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### organization tree

Display organization folder hierarchy as a tree.

**Usage**

```
tailor-sdk organization tree [options]
```

**Options**

| Option                                | Alias | Description                           | Required | Default | Env                               |
| ------------------------------------- | ----- | ------------------------------------- | -------- | ------- | --------------------------------- |
| `--organization-id <ORGANIZATION_ID>` | `-o`  | Organization ID (show all if omitted) | No       | -       | `TAILOR_PLATFORM_ORGANIZATION_ID` |
| `--depth <DEPTH>`                     | `-d`  | Maximum folder depth to display       | No       | -       | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### organization update

Update an organization's name.

**Usage**

```
tailor-sdk organization update [options]
```

**Options**

| Option                                | Alias | Description           | Required | Default | Env                               |
| ------------------------------------- | ----- | --------------------- | -------- | ------- | --------------------------------- |
| `--organization-id <ORGANIZATION_ID>` | `-o`  | Organization ID       | Yes      | -       | `TAILOR_PLATFORM_ORGANIZATION_ID` |
| `--name <NAME>`                       | `-n`  | New organization name | Yes      | -       | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.
