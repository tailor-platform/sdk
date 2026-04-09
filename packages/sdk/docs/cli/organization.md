<!-- politty:command:organization:heading:start -->

## organization

<!-- politty:command:organization:heading:end -->

<!-- politty:command:organization:description:start -->

Manage Tailor Platform organizations.

<!-- politty:command:organization:description:end -->

<!-- politty:command:organization:usage:start -->

**Usage**

```
tailor-sdk organization [command]
```

<!-- politty:command:organization:usage:end -->

<!-- politty:command:organization:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:organization:global-options-link:end -->

<!-- politty:command:organization:subcommands:start -->

**Commands**

| Command                                       | Description                                      |
| --------------------------------------------- | ------------------------------------------------ |
| [`organization folder`](#organization-folder) | Manage organization folders.                     |
| [`organization get`](#organization-get)       | Show detailed information about an organization. |
| [`organization list`](#organization-list)     | List organizations you belong to.                |
| [`organization tree`](#organization-tree)     | Display organization folder hierarchy as a tree. |
| [`organization update`](#organization-update) | Update an organization's name.                   |

<!-- politty:command:organization:subcommands:end -->
<!-- politty:command:organization folder:heading:start -->

### organization folder

<!-- politty:command:organization folder:heading:end -->

<!-- politty:command:organization folder:description:start -->

Manage organization folders.

<!-- politty:command:organization folder:description:end -->

<!-- politty:command:organization folder:usage:start -->

**Usage**

```
tailor-sdk organization folder [command]
```

<!-- politty:command:organization folder:usage:end -->

<!-- politty:command:organization folder:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:organization folder:global-options-link:end -->

<!-- politty:command:organization folder:subcommands:start -->

**Commands**

| Command                                                     | Description                               |
| ----------------------------------------------------------- | ----------------------------------------- |
| [`organization folder create`](#organization-folder-create) | Create a new folder in an organization.   |
| [`organization folder delete`](#organization-folder-delete) | Delete a folder from an organization.     |
| [`organization folder get`](#organization-folder-get)       | Show detailed information about a folder. |
| [`organization folder list`](#organization-folder-list)     | List folders in an organization.          |
| [`organization folder update`](#organization-folder-update) | Update a folder's name.                   |

<!-- politty:command:organization folder:subcommands:end -->
<!-- politty:command:organization folder create:heading:start -->

#### organization folder create

<!-- politty:command:organization folder create:heading:end -->

<!-- politty:command:organization folder create:description:start -->

Create a new folder in an organization.

<!-- politty:command:organization folder create:description:end -->

<!-- politty:command:organization folder create:usage:start -->

**Usage**

```
tailor-sdk organization folder create [options]
```

<!-- politty:command:organization folder create:usage:end -->

<!-- politty:command:organization folder create:options:start -->

**Options**

| Option                                  | Alias | Description      | Required | Default | Env                               |
| --------------------------------------- | ----- | ---------------- | -------- | ------- | --------------------------------- |
| `--organization-id <ORGANIZATION_ID>`   | `-o`  | Organization ID  | Yes      | -       | `TAILOR_PLATFORM_ORGANIZATION_ID` |
| `--parent-folder-id <PARENT_FOLDER_ID>` | -     | Parent folder ID | No       | -       | -                                 |
| `--name <NAME>`                         | `-n`  | Folder name      | Yes      | -       | -                                 |

<!-- politty:command:organization folder create:options:end -->

<!-- politty:command:organization folder create:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:organization folder create:global-options-link:end -->
<!-- politty:command:organization folder delete:heading:start -->

#### organization folder delete

<!-- politty:command:organization folder delete:heading:end -->

<!-- politty:command:organization folder delete:description:start -->

Delete a folder from an organization.

<!-- politty:command:organization folder delete:description:end -->

<!-- politty:command:organization folder delete:usage:start -->

**Usage**

```
tailor-sdk organization folder delete [options]
```

<!-- politty:command:organization folder delete:usage:end -->

<!-- politty:command:organization folder delete:options:start -->

**Options**

| Option                                | Alias | Description               | Required | Default | Env                               |
| ------------------------------------- | ----- | ------------------------- | -------- | ------- | --------------------------------- |
| `--organization-id <ORGANIZATION_ID>` | `-o`  | Organization ID           | Yes      | -       | `TAILOR_PLATFORM_ORGANIZATION_ID` |
| `--folder-id <FOLDER_ID>`             | `-f`  | Folder ID                 | Yes      | -       | `TAILOR_PLATFORM_FOLDER_ID`       |
| `--yes`                               | `-y`  | Skip confirmation prompts | No       | `false` | -                                 |

<!-- politty:command:organization folder delete:options:end -->

<!-- politty:command:organization folder delete:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:organization folder delete:global-options-link:end -->
<!-- politty:command:organization folder get:heading:start -->

#### organization folder get

<!-- politty:command:organization folder get:heading:end -->

<!-- politty:command:organization folder get:description:start -->

Show detailed information about a folder.

<!-- politty:command:organization folder get:description:end -->

<!-- politty:command:organization folder get:usage:start -->

**Usage**

```
tailor-sdk organization folder get [options]
```

<!-- politty:command:organization folder get:usage:end -->

<!-- politty:command:organization folder get:options:start -->

**Options**

| Option                                | Alias | Description     | Required | Default | Env                               |
| ------------------------------------- | ----- | --------------- | -------- | ------- | --------------------------------- |
| `--organization-id <ORGANIZATION_ID>` | `-o`  | Organization ID | Yes      | -       | `TAILOR_PLATFORM_ORGANIZATION_ID` |
| `--folder-id <FOLDER_ID>`             | `-f`  | Folder ID       | Yes      | -       | `TAILOR_PLATFORM_FOLDER_ID`       |

<!-- politty:command:organization folder get:options:end -->

<!-- politty:command:organization folder get:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:organization folder get:global-options-link:end -->
<!-- politty:command:organization folder list:heading:start -->

#### organization folder list

<!-- politty:command:organization folder list:heading:end -->

<!-- politty:command:organization folder list:description:start -->

List folders in an organization.

<!-- politty:command:organization folder list:description:end -->

<!-- politty:command:organization folder list:usage:start -->

**Usage**

```
tailor-sdk organization folder list [options]
```

<!-- politty:command:organization folder list:usage:end -->

<!-- politty:command:organization folder list:options:start -->

**Options**

| Option                                  | Alias | Description                          | Required | Default | Env                               |
| --------------------------------------- | ----- | ------------------------------------ | -------- | ------- | --------------------------------- |
| `--organization-id <ORGANIZATION_ID>`   | `-o`  | Organization ID                      | Yes      | -       | `TAILOR_PLATFORM_ORGANIZATION_ID` |
| `--parent-folder-id <PARENT_FOLDER_ID>` | -     | Parent folder ID to list children of | No       | -       | -                                 |
| `--limit <LIMIT>`                       | `-l`  | Maximum number of folders to list    | No       | -       | -                                 |

<!-- politty:command:organization folder list:options:end -->

<!-- politty:command:organization folder list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:organization folder list:global-options-link:end -->
<!-- politty:command:organization folder update:heading:start -->

#### organization folder update

<!-- politty:command:organization folder update:heading:end -->

<!-- politty:command:organization folder update:description:start -->

Update a folder's name.

<!-- politty:command:organization folder update:description:end -->

<!-- politty:command:organization folder update:usage:start -->

**Usage**

```
tailor-sdk organization folder update [options]
```

<!-- politty:command:organization folder update:usage:end -->

<!-- politty:command:organization folder update:options:start -->

**Options**

| Option                                | Alias | Description     | Required | Default | Env                               |
| ------------------------------------- | ----- | --------------- | -------- | ------- | --------------------------------- |
| `--organization-id <ORGANIZATION_ID>` | `-o`  | Organization ID | Yes      | -       | `TAILOR_PLATFORM_ORGANIZATION_ID` |
| `--folder-id <FOLDER_ID>`             | `-f`  | Folder ID       | Yes      | -       | `TAILOR_PLATFORM_FOLDER_ID`       |
| `--name <NAME>`                       | `-n`  | New folder name | Yes      | -       | -                                 |

<!-- politty:command:organization folder update:options:end -->

<!-- politty:command:organization folder update:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:organization folder update:global-options-link:end -->
<!-- politty:command:organization get:heading:start -->

### organization get

<!-- politty:command:organization get:heading:end -->

<!-- politty:command:organization get:description:start -->

Show detailed information about an organization.

<!-- politty:command:organization get:description:end -->

<!-- politty:command:organization get:usage:start -->

**Usage**

```
tailor-sdk organization get [options]
```

<!-- politty:command:organization get:usage:end -->

<!-- politty:command:organization get:options:start -->

**Options**

| Option                                | Alias | Description     | Required | Default | Env                               |
| ------------------------------------- | ----- | --------------- | -------- | ------- | --------------------------------- |
| `--organization-id <ORGANIZATION_ID>` | `-o`  | Organization ID | Yes      | -       | `TAILOR_PLATFORM_ORGANIZATION_ID` |

<!-- politty:command:organization get:options:end -->

<!-- politty:command:organization get:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:organization get:global-options-link:end -->
<!-- politty:command:organization list:heading:start -->

### organization list

<!-- politty:command:organization list:heading:end -->

<!-- politty:command:organization list:description:start -->

List organizations you belong to.

<!-- politty:command:organization list:description:end -->

<!-- politty:command:organization list:usage:start -->

**Usage**

```
tailor-sdk organization list [options]
```

<!-- politty:command:organization list:usage:end -->

<!-- politty:command:organization list:options:start -->

**Options**

| Option            | Alias | Description                             | Required | Default |
| ----------------- | ----- | --------------------------------------- | -------- | ------- |
| `--limit <LIMIT>` | `-l`  | Maximum number of organizations to list | No       | -       |

<!-- politty:command:organization list:options:end -->

<!-- politty:command:organization list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:organization list:global-options-link:end -->
<!-- politty:command:organization tree:heading:start -->

### organization tree

<!-- politty:command:organization tree:heading:end -->

<!-- politty:command:organization tree:description:start -->

Display organization folder hierarchy as a tree.

<!-- politty:command:organization tree:description:end -->

<!-- politty:command:organization tree:usage:start -->

**Usage**

```
tailor-sdk organization tree [options]
```

<!-- politty:command:organization tree:usage:end -->

<!-- politty:command:organization tree:options:start -->

**Options**

| Option                                | Alias | Description                           | Required | Default | Env                               |
| ------------------------------------- | ----- | ------------------------------------- | -------- | ------- | --------------------------------- |
| `--organization-id <ORGANIZATION_ID>` | `-o`  | Organization ID (show all if omitted) | No       | -       | `TAILOR_PLATFORM_ORGANIZATION_ID` |
| `--depth <DEPTH>`                     | `-d`  | Maximum folder depth to display       | No       | -       | -                                 |

<!-- politty:command:organization tree:options:end -->

<!-- politty:command:organization tree:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:organization tree:global-options-link:end -->
<!-- politty:command:organization update:heading:start -->

### organization update

<!-- politty:command:organization update:heading:end -->

<!-- politty:command:organization update:description:start -->

Update an organization's name.

<!-- politty:command:organization update:description:end -->

<!-- politty:command:organization update:usage:start -->

**Usage**

```
tailor-sdk organization update [options]
```

<!-- politty:command:organization update:usage:end -->

<!-- politty:command:organization update:options:start -->

**Options**

| Option                                | Alias | Description           | Required | Default | Env                               |
| ------------------------------------- | ----- | --------------------- | -------- | ------- | --------------------------------- |
| `--organization-id <ORGANIZATION_ID>` | `-o`  | Organization ID       | Yes      | -       | `TAILOR_PLATFORM_ORGANIZATION_ID` |
| `--name <NAME>`                       | `-n`  | New organization name | Yes      | -       | -                                 |

<!-- politty:command:organization update:options:end -->

<!-- politty:command:organization update:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:organization update:global-options-link:end -->
