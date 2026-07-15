# User & Auth Commands

Commands for authentication and user management.

## login

Login to Tailor Platform.

**Usage**

```
tailor-sdk login [options]
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
tailor-sdk logout [options]
```

**Options**

| Option                | Alias | Description                                                          | Required | Default | Env                       |
| --------------------- | ----- | -------------------------------------------------------------------- | -------- | ------- | ------------------------- |
| `--profile <PROFILE>` | `-p`  | Workspace profile whose platform settings should be used for logout. | No       | -       | `TAILOR_PLATFORM_PROFILE` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

## user

Manage Tailor Platform users.

**Usage**

```
tailor-sdk user [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                         | Description                    |
| ------------------------------- | ------------------------------ |
| [`user current`](#user-current) | Show current user.             |
| [`user list`](#user-list)       | List all users.                |
| [`user switch`](#user-switch)   | Set current user.              |
| [`user pat`](#user-pat)         | Manage personal access tokens. |

### user current

Show current user.

**Usage**

```
tailor-sdk user current
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### user list

List all users.

**Usage**

```
tailor-sdk user list
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### user pat

Manage personal access tokens.

**Usage**

```
tailor-sdk user pat [command]
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
tailor-sdk user pat create [options] <name>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Token name  | Yes      |

**Options**

| Option    | Alias | Description                                 | Required | Default |
| --------- | ----- | ------------------------------------------- | -------- | ------- |
| `--write` | `-W`  | Grant write permission (default: read-only) | No       | `false` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### user pat delete

Delete a personal access token.

**Usage**

```
tailor-sdk user pat delete <name>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Token name  | Yes      |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### user pat list

List all personal access tokens.

**Usage**

```
tailor-sdk user pat list [options]
```

**Options**

| Option            | Alias | Description                                              | Required | Default  |
| ----------------- | ----- | -------------------------------------------------------- | -------- | -------- |
| `--order <ORDER>` | -     | Sort order (asc or desc)                                 | No       | `"desc"` |
| `--limit <LIMIT>` | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -        |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### user pat update

Update a personal access token (delete and recreate).

**Usage**

```
tailor-sdk user pat update [options] <name>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Token name  | Yes      |

**Options**

| Option    | Alias | Description                                                | Required | Default |
| --------- | ----- | ---------------------------------------------------------- | -------- | ------- |
| `--write` | `-W`  | Grant write permission (if not specified, keeps read-only) | No       | `false` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### user switch

Set current user.

**Usage**

```
tailor-sdk user switch <user>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `user`   | User email  | Yes      |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.
When no subcommand is provided, defaults to `list`.

**Output (default):**

```
 token-name-1: read/write
 token-name-2: read
```

**Output (`-j, --json`):**

```json
[
  { "name": "token-name-1", "scopes": ["read", "write"] },
  { "name": "token-name-2", "scopes": ["read"] }
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
