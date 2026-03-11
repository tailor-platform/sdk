# User & Auth Commands

Commands for authentication and user management.

<!-- politty:command:login:heading:start -->

## login

<!-- politty:command:login:heading:end -->

<!-- politty:command:login:description:start -->

Login to Tailor Platform.

<!-- politty:command:login:description:end -->

<!-- politty:command:login:usage:start -->

**Usage**

```
tailor-sdk login
```

<!-- politty:command:login:usage:end -->

<!-- politty:command:login:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:login:global-options-link:end -->

<!-- politty:command:logout:heading:start -->

## logout

<!-- politty:command:logout:heading:end -->

<!-- politty:command:logout:description:start -->

Logout from Tailor Platform.

<!-- politty:command:logout:description:end -->

<!-- politty:command:logout:usage:start -->

**Usage**

```
tailor-sdk logout
```

<!-- politty:command:logout:usage:end -->

<!-- politty:command:logout:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:logout:global-options-link:end -->

<!-- politty:command:user:heading:start -->

## user

<!-- politty:command:user:heading:end -->

<!-- politty:command:user:description:start -->

Manage Tailor Platform users.

<!-- politty:command:user:description:end -->

<!-- politty:command:user:usage:start -->

**Usage**

```
tailor-sdk user [command]
```

<!-- politty:command:user:usage:end -->

<!-- politty:command:user:subcommands:start -->

**Commands**

| Command                         | Description                    |
| ------------------------------- | ------------------------------ |
| [`user current`](#user-current) | Show current user.             |
| [`user list`](#user-list)       | List all users.                |
| [`user pat`](#user-pat)         | Manage personal access tokens. |
| [`user switch`](#user-switch)   | Set current user.              |

<!-- politty:command:user:subcommands:end -->

<!-- politty:command:user:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:user:global-options-link:end -->
<!-- politty:command:user current:heading:start -->

### user current

<!-- politty:command:user current:heading:end -->

<!-- politty:command:user current:description:start -->

Show current user.

<!-- politty:command:user current:description:end -->

<!-- politty:command:user current:usage:start -->

**Usage**

```
tailor-sdk user current
```

<!-- politty:command:user current:usage:end -->

<!-- politty:command:user current:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:user current:global-options-link:end -->
<!-- politty:command:user list:heading:start -->

### user list

<!-- politty:command:user list:heading:end -->

<!-- politty:command:user list:description:start -->

List all users.

<!-- politty:command:user list:description:end -->

<!-- politty:command:user list:usage:start -->

**Usage**

```
tailor-sdk user list
```

<!-- politty:command:user list:usage:end -->

<!-- politty:command:user list:options:start -->

**Options**

| Option   | Alias | Description    | Required | Default |
| -------- | ----- | -------------- | -------- | ------- |
| `--json` | `-j`  | Output as JSON | No       | `false` |

<!-- politty:command:user list:options:end -->

<!-- politty:command:user list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:user list:global-options-link:end -->
<!-- politty:command:user switch:heading:start -->

### user switch

<!-- politty:command:user switch:heading:end -->

<!-- politty:command:user switch:description:start -->

Set current user.

<!-- politty:command:user switch:description:end -->

<!-- politty:command:user switch:usage:start -->

**Usage**

```
tailor-sdk user switch <user>
```

<!-- politty:command:user switch:usage:end -->

<!-- politty:command:user switch:arguments:start -->

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `user`   | User email  | Yes      |

<!-- politty:command:user switch:arguments:end -->

<!-- politty:command:user switch:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:user switch:global-options-link:end -->
<!-- politty:command:user pat:heading:start -->

### user pat

<!-- politty:command:user pat:heading:end -->

<!-- politty:command:user pat:description:start -->

Manage personal access tokens.

<!-- politty:command:user pat:description:end -->

<!-- politty:command:user pat:usage:start -->

**Usage**

```
tailor-sdk user pat [command]
```

<!-- politty:command:user pat:usage:end -->

<!-- politty:command:user pat:options:start -->

**Options**

| Option   | Alias | Description    | Required | Default |
| -------- | ----- | -------------- | -------- | ------- |
| `--json` | `-j`  | Output as JSON | No       | `false` |

<!-- politty:command:user pat:options:end -->

<!-- politty:command:user pat:subcommands:start -->

**Commands**

| Command                               | Description                                           |
| ------------------------------------- | ----------------------------------------------------- |
| [`user pat create`](#user-pat-create) | Create a new personal access token.                   |
| [`user pat delete`](#user-pat-delete) | Delete a personal access token.                       |
| [`user pat list`](#user-pat-list)     | List all personal access tokens.                      |
| [`user pat update`](#user-pat-update) | Update a personal access token (delete and recreate). |

<!-- politty:command:user pat:subcommands:end -->

<!-- politty:command:user pat:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:user pat:global-options-link:end -->
<!-- politty:command:user pat list:heading:start -->

#### user pat list

<!-- politty:command:user pat list:heading:end -->

<!-- politty:command:user pat list:description:start -->

List all personal access tokens.

<!-- politty:command:user pat list:description:end -->

<!-- politty:command:user pat list:usage:start -->

**Usage**

```
tailor-sdk user pat list
```

<!-- politty:command:user pat list:usage:end -->

<!-- politty:command:user pat list:options:start -->

**Options**

| Option   | Alias | Description    | Required | Default |
| -------- | ----- | -------------- | -------- | ------- |
| `--json` | `-j`  | Output as JSON | No       | `false` |

<!-- politty:command:user pat list:options:end -->

<!-- politty:command:user pat list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:user pat list:global-options-link:end -->
<!-- politty:command:user pat create:heading:start -->

#### user pat create

<!-- politty:command:user pat create:heading:end -->

<!-- politty:command:user pat create:description:start -->

Create a new personal access token.

<!-- politty:command:user pat create:description:end -->

<!-- politty:command:user pat create:usage:start -->

**Usage**

```
tailor-sdk user pat create [options] <name>
```

<!-- politty:command:user pat create:usage:end -->

<!-- politty:command:user pat create:arguments:start -->

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Token name  | Yes      |

<!-- politty:command:user pat create:arguments:end -->

<!-- politty:command:user pat create:options:start -->

**Options**

| Option    | Alias | Description                                 | Required | Default |
| --------- | ----- | ------------------------------------------- | -------- | ------- |
| `--write` | `-W`  | Grant write permission (default: read-only) | No       | `false` |

<!-- politty:command:user pat create:options:end -->

<!-- politty:command:user pat create:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:user pat create:global-options-link:end -->
<!-- politty:command:user pat delete:heading:start -->

#### user pat delete

<!-- politty:command:user pat delete:heading:end -->

<!-- politty:command:user pat delete:description:start -->

Delete a personal access token.

<!-- politty:command:user pat delete:description:end -->

<!-- politty:command:user pat delete:usage:start -->

**Usage**

```
tailor-sdk user pat delete <name>
```

<!-- politty:command:user pat delete:usage:end -->

<!-- politty:command:user pat delete:arguments:start -->

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Token name  | Yes      |

<!-- politty:command:user pat delete:arguments:end -->

<!-- politty:command:user pat delete:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:user pat delete:global-options-link:end -->
<!-- politty:command:user pat update:heading:start -->

#### user pat update

<!-- politty:command:user pat update:heading:end -->

<!-- politty:command:user pat update:description:start -->

Update a personal access token (delete and recreate).

<!-- politty:command:user pat update:description:end -->

<!-- politty:command:user pat update:usage:start -->

**Usage**

```
tailor-sdk user pat update [options] <name>
```

<!-- politty:command:user pat update:usage:end -->

<!-- politty:command:user pat update:arguments:start -->

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Token name  | Yes      |

<!-- politty:command:user pat update:arguments:end -->

<!-- politty:command:user pat update:options:start -->

**Options**

| Option    | Alias | Description                                                | Required | Default |
| --------- | ----- | ---------------------------------------------------------- | -------- | ------- |
| `--write` | `-W`  | Grant write permission (if not specified, keeps read-only) | No       | `false` |

<!-- politty:command:user pat update:options:end -->

<!-- politty:command:user pat update:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:user pat update:global-options-link:end -->

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
