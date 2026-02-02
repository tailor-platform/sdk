# User & Auth Commands

Commands for authentication and user management.

<!-- politty:command:login:start -->

## login

Login to Tailor Platform.

**Usage**

```
tailor-sdk login [options]
```

<!-- politty:command:login:end -->

<!-- politty:command:logout:start -->

## logout

Logout from Tailor Platform.

**Usage**

```
tailor-sdk logout [options]
```

<!-- politty:command:logout:end -->

<!-- politty:command:user:start -->

## user

Manage Tailor Platform users.

**Usage**

```
tailor-sdk user [command]
```

**Commands**

| Command                         | Description                    |
| ------------------------------- | ------------------------------ |
| [`user current`](#user-current) | Show current user.             |
| [`user list`](#user-list)       | List all users.                |
| [`user pat`](#user-pat)         | Manage personal access tokens. |
| [`user switch`](#user-switch)   | Set current user.              |

<!-- politty:command:user:end -->
<!-- politty:command:user current:start -->

### user current

Show current user.

**Usage**

```
tailor-sdk user current [options]
```

<!-- politty:command:user current:end -->
<!-- politty:command:user list:start -->

### user list

List all users.

**Usage**

```
tailor-sdk user list [options]
```

**Options**

| Option   | Alias | Description    | Default |
| -------- | ----- | -------------- | ------- |
| `--json` | `-j`  | Output as JSON | `false` |

<!-- politty:command:user list:end -->
<!-- politty:command:user switch:start -->

### user switch

Set current user.

**Usage**

```
tailor-sdk user switch [options] <user>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `user`   | User email  | Yes      |

<!-- politty:command:user switch:end -->
<!-- politty:command:user pat:start -->

### user pat

Manage personal access tokens.

**Usage**

```
tailor-sdk user pat [options] [command]
```

**Options**

| Option   | Alias | Description    | Default |
| -------- | ----- | -------------- | ------- |
| `--json` | `-j`  | Output as JSON | `false` |

**Commands**

| Command                               | Description                                           |
| ------------------------------------- | ----------------------------------------------------- |
| [`user pat create`](#user-pat-create) | Create a new personal access token.                   |
| [`user pat delete`](#user-pat-delete) | Delete a personal access token.                       |
| [`user pat list`](#user-pat-list)     | List all personal access tokens.                      |
| [`user pat update`](#user-pat-update) | Update a personal access token (delete and recreate). |

<!-- politty:command:user pat:end -->
<!-- politty:command:user pat list:start -->

#### user pat list

List all personal access tokens.

**Usage**

```
tailor-sdk user pat list [options]
```

**Options**

| Option   | Alias | Description    | Default |
| -------- | ----- | -------------- | ------- |
| `--json` | `-j`  | Output as JSON | `false` |

<!-- politty:command:user pat list:end -->
<!-- politty:command:user pat create:start -->

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

| Option    | Alias | Description                                 | Default |
| --------- | ----- | ------------------------------------------- | ------- |
| `--json`  | `-j`  | Output as JSON                              | `false` |
| `--write` | `-W`  | Grant write permission (default: read-only) | `false` |

<!-- politty:command:user pat create:end -->
<!-- politty:command:user pat delete:start -->

#### user pat delete

Delete a personal access token.

**Usage**

```
tailor-sdk user pat delete [options] <name>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Token name  | Yes      |

<!-- politty:command:user pat delete:end -->
<!-- politty:command:user pat update:start -->

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

| Option    | Alias | Description                                                | Default |
| --------- | ----- | ---------------------------------------------------------- | ------- |
| `--json`  | `-j`  | Output as JSON                                             | `false` |
| `--write` | `-W`  | Grant write permission (if not specified, keeps read-only) | `false` |

<!-- politty:command:user pat update:end -->

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
