# User & Auth Commands

Commands for authentication and user management.

## login

Login to Tailor Platform.

**Usage**

```
tailor login [options]
```

**Options**

| Option                | Alias | Description                                                         | Required | Default | Env                       |
| --------------------- | ----- | ------------------------------------------------------------------- | -------- | ------- | ------------------------- |
| `--profile <PROFILE>` | `-p`  | Workspace profile whose platform settings should be used for login. | No       | -       | `TAILOR_PLATFORM_PROFILE` |

> One of the following option groups is required:

**User Login:**

_no options_

**Machine User Login:**

| Option                            | Alias | Description                       | Required | Default | Env                                          |
| --------------------------------- | ----- | --------------------------------- | -------- | ------- | -------------------------------------------- |
| `--machine-user <MACHINE_USER>`   | -     | Login as a platform machine user. | Yes      | -       | -                                            |
| `--client-id <CLIENT_ID>`         | -     | Client ID                         | Yes      | -       | `TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID`     |
| `--client-secret <CLIENT_SECRET>` | -     | Client secret                     | No       | -       | `TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

## logout

Logout from Tailor Platform.

**Usage**

```
tailor logout [options]
```

**Options**

| Option                | Alias | Description                                                          | Required | Default | Env                       |
| --------------------- | ----- | -------------------------------------------------------------------- | -------- | ------- | ------------------------- |
| `--profile <PROFILE>` | `-p`  | Workspace profile whose platform settings should be used for logout. | No       | -       | `TAILOR_PLATFORM_PROFILE` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

## auth

Authentication helpers for scripts and plugins.

**Usage**

```
tailor auth <command>
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                       | Description                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| [`auth status`](#auth-status) | Show the active Tailor Platform authentication status without printing tokens.        |
| [`auth token`](#auth-token)   | Print a valid Tailor Platform access token to stdout, refreshing it first if expired. |

### auth status

Show the active Tailor Platform authentication status without printing tokens.

**Usage**

```
tailor auth status [options]
```

**Options**

| Option                | Alias | Description       | Required | Default | Env                       |
| --------------------- | ----- | ----------------- | -------- | ------- | ------------------------- |
| `--profile <PROFILE>` | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### auth token

Print a valid Tailor Platform access token to stdout, refreshing it first if expired.

**Usage**

```
tailor auth token [options]
```

**Options**

| Option                | Alias | Description       | Required | Default | Env                       |
| --------------------- | ----- | ----------------- | -------- | ------- | ------------------------- |
| `--profile <PROFILE>` | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

## user

Manage Tailor Platform users.

**Usage**

```
tailor user [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                         | Description                                                                |
| ------------------------------- | -------------------------------------------------------------------------- |
| [`user current`](#user-current) | Show current user.                                                         |
| [`user list`](#user-list)       | List all users.                                                            |
| [`user switch`](#user-switch)   | Set current user.                                                          |
| [`user update`](#user-update)   | Set the current user's default organization and folder for new workspaces. |
| [`user pat`](#user-pat)         | Manage personal access tokens.                                             |

### user current

Show current user.

**Usage**

```
tailor user current [options]
```

**Options**

| Option                | Alias | Description       | Required | Default | Env                       |
| --------------------- | ----- | ----------------- | -------- | ------- | ------------------------- |
| `--profile <PROFILE>` | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### user list

List all users.

**Usage**

```
tailor user list [options]
```

**Options**

| Option                | Alias | Description       | Required | Default | Env                       |
| --------------------- | ----- | ----------------- | -------- | ------- | ------------------------- |
| `--profile <PROFILE>` | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### user pat

Manage personal access tokens.

**Usage**

```
tailor user pat [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                               | Description                                           |
| ------------------------------------- | ----------------------------------------------------- |
| [`user pat list`](#user-pat-list)     | List all personal access tokens.                      |
| [`user pat create`](#user-pat-create) | Create a new personal access token.                   |
| [`user pat delete`](#user-pat-delete) | Delete a personal access token.                       |
| [`user pat update`](#user-pat-update) | Update a personal access token (delete and recreate). |

#### user pat create

Create a new personal access token.

**Usage**

```
tailor user pat create [options] <name>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Token name  | Yes      |

**Options**

| Option                | Alias | Description                                 | Required | Default | Env                       |
| --------------------- | ----- | ------------------------------------------- | -------- | ------- | ------------------------- |
| `--write`             | `-W`  | Grant write permission (default: read-only) | No       | `false` | -                         |
| `--profile <PROFILE>` | `-p`  | Workspace profile                           | No       | -       | `TAILOR_PLATFORM_PROFILE` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### user pat delete

Delete a personal access token.

**Usage**

```
tailor user pat delete [options] <name>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Token name  | Yes      |

**Options**

| Option                | Alias | Description       | Required | Default | Env                       |
| --------------------- | ----- | ----------------- | -------- | ------- | ------------------------- |
| `--profile <PROFILE>` | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### user pat list

List all personal access tokens.

**Usage**

```
tailor user pat list [options]
```

**Options**

| Option                | Alias | Description                                              | Required | Default  | Env                       |
| --------------------- | ----- | -------------------------------------------------------- | -------- | -------- | ------------------------- |
| `--order <ORDER>`     | -     | Sort order (asc or desc)                                 | No       | `"desc"` | -                         |
| `--limit <LIMIT>`     | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -        | -                         |
| `--profile <PROFILE>` | `-p`  | Workspace profile                                        | No       | -        | `TAILOR_PLATFORM_PROFILE` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### user pat update

Update a personal access token (delete and recreate).

**Usage**

```
tailor user pat update [options] <name>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Token name  | Yes      |

**Options**

| Option                | Alias | Description                                                | Required | Default | Env                       |
| --------------------- | ----- | ---------------------------------------------------------- | -------- | ------- | ------------------------- |
| `--write`             | `-W`  | Grant write permission (if not specified, keeps read-only) | No       | `false` | -                         |
| `--profile <PROFILE>` | `-p`  | Workspace profile                                          | No       | -       | `TAILOR_PLATFORM_PROFILE` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### user switch

Set current user.

**Usage**

```
tailor user switch [options] <user>
```

**Arguments**

| Argument | Description                                  | Required |
| -------- | -------------------------------------------- | -------- |
| `user`   | User email address or machine user client ID | Yes      |

**Options**

| Option                | Alias | Description       | Required | Default | Env                       |
| --------------------- | ----- | ----------------- | -------- | ------- | ------------------------- |
| `--profile <PROFILE>` | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### user update

Set the current user's default organization and folder for new workspaces.

**Usage**

```
tailor user update [options]
```

**Options**

| Option                                                | Alias | Description                                                                                                      | Required | Default | Env                       |
| ----------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------------------------- |
| `--default-organization-id <DEFAULT_ORGANIZATION_ID>` | `-o`  | Organization that `workspace create` uses when no location is given. Pass an empty string to clear the defaults. | No       | -       | -                         |
| `--default-folder-id <DEFAULT_FOLDER_ID>`             | `-f`  | Folder in the default organization that `workspace create` uses (requires --default-organization-id)             | No       | -       | -                         |
| `--profile <PROFILE>`                                 | `-p`  | Workspace profile                                                                                                | No       | -       | `TAILOR_PLATFORM_PROFILE` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Notes**

`workspace create` creates a workspace in the default folder, or directly under the default organization when no folder is set. Giving --organization-id or --folder-id to `workspace create`, on the command line or through TAILOR_PLATFORM_ORGANIZATION_ID / TAILOR_PLATFORM_FOLDER_ID, replaces both defaults for that run. The defaults are not used while TAILOR_PLATFORM_TOKEN is set, because that token does not belong to a user logged in here.

Each run replaces both defaults: --default-organization-id alone clears the default folder, --default-folder-id is accepted only together with --default-organization-id, and --default-organization-id "" clears both. The IDs are not checked against the Platform here; `workspace create` points back to them when it cannot use them.

The defaults belong to this user's login on the selected platform, so `logout` removes them, and older SDK versions drop them when they rewrite the CLI config file.

When no subcommand is provided, defaults to `list`.

**Output (default):**

```
┌──────────────┬────────────┬──────────────┬──────────────┐
│ name         │ scopes     │ createdAt    │ lastUsedAt   │
├──────────────┼────────────┼──────────────┼──────────────┤
│ token-name-1 │ read/write │ 8 months ago │ 6 months ago │
│ token-name-2 │ read       │ 8 months ago │ never        │
└──────────────┴────────────┴──────────────┴──────────────┘
```

`lastUsedAt` reads `never` until the token has been used to authenticate, and is
updated at most once per hour.

**Output (`-j, --json`):**

```json
[
  {
    "name": "token-name-1",
    "scopes": ["read", "write"],
    "createdAt": "2026-01-02T03:04:05.000Z",
    "lastUsedAt": "2026-03-04T05:06:07.000Z"
  },
  {
    "name": "token-name-2",
    "scopes": ["read"],
    "createdAt": "2026-01-02T03:04:05.000Z",
    "lastUsedAt": null
  }
]
```

**Output (default):**

```
Personal access token created successfully.

  name: token-name
scopes: read/write
 token: tpp_xxxxxxxxxxxxx

Please save this token in a secure location. You won't be able to see it again.
```

**Output (`-j, --json`):**

```json
{ "name": "token-name", "scopes": ["read", "write"], "token": "eyJhbGc..." }
```

**Output (default):**

```
Personal access token updated successfully.

  name: token-name
scopes: read/write
 token: tpp_xxxxxxxxxxxxx

Please save this token in a secure location. You won't be able to see it again.
```

**Output (`-j, --json`):**

```json
{
  "name": "token-name",
  "scopes": ["read", "write"],
  "token": "tpp_xxxxxxxxxxxxx"
}
```
