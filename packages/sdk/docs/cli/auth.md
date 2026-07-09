# Auth Resource Commands

Commands for managing Auth service resources (auth connections, machine users, and OAuth2 clients).

## authconnection

Manage auth connections.

**Usage**

```
tailor-sdk authconnection [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                                 | Description                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`authconnection authorize`](#authconnection-authorize) | Authorize an auth connection via OAuth2 flow.                                         |
| [`authconnection list`](#authconnection-list)           | List all auth connections.                                                            |
| [`authconnection open`](#authconnection-open)           | Open the auth connections page in the Tailor Platform Console.                        |
| [`authconnection revoke`](#authconnection-revoke)       | Revoke an auth connection's tokens (keeps the connection; use 'delete' to remove it). |
| [`authconnection delete`](#authconnection-delete)       | Delete an auth connection entirely.                                                   |

### authconnection authorize

Authorize an auth connection via OAuth2 flow.

**Usage**

```
tailor-sdk authconnection authorize [options]
```

**Options**

| Option                          | Alias | Description                                | Required | Default                  | Env                            |
| ------------------------------- | ----- | ------------------------------------------ | -------- | ------------------------ | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                               | No       | -                        | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                          | No       | -                        | `TAILOR_PLATFORM_PROFILE`      |
| `--name <NAME>`                 | `-n`  | Auth connection name                       | Yes      | -                        | -                              |
| `--scopes <SCOPES>`             | -     | OAuth2 scopes to request (comma-separated) | No       | `"openid,profile,email"` | -                              |
| `--port <PORT>`                 | -     | Local callback server port                 | No       | `8080`                   | -                              |
| `--no-browser`                  | -     | Don't open browser automatically           | No       | `false`                  | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### authconnection delete

Delete an auth connection entirely.

**Usage**

```
tailor-sdk authconnection delete [options]
```

**Options**

| Option                          | Alias | Description               | Required | Default | Env                            |
| ------------------------------- | ----- | ------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID              | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile         | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--name <NAME>`                 | `-n`  | Auth connection name      | Yes      | -       | -                              |
| `--yes`                         | `-y`  | Skip confirmation prompts | No       | `false` | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### authconnection list

List all auth connections.

**Usage**

```
tailor-sdk authconnection list [options]
```

**Options**

| Option                          | Alias | Description                                              | Required | Default  | Env                            |
| ------------------------------- | ----- | -------------------------------------------------------- | -------- | -------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                             | No       | -        | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                        | No       | -        | `TAILOR_PLATFORM_PROFILE`      |
| `--order <ORDER>`               | -     | Sort order (asc or desc)                                 | No       | `"desc"` | -                              |
| `--limit <LIMIT>`               | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -        | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### authconnection open

Open the auth connections page in the Tailor Platform Console.

**Usage**

```
tailor-sdk authconnection open [options]
```

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### authconnection revoke

Revoke an auth connection's tokens (keeps the connection; use 'delete' to remove it).

**Usage**

```
tailor-sdk authconnection revoke [options]
```

**Options**

| Option                          | Alias | Description               | Required | Default | Env                            |
| ------------------------------- | ----- | ------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID              | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile         | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--name <NAME>`                 | `-n`  | Auth connection name      | Yes      | -       | -                              |
| `--yes`                         | `-y`  | Skip confirmation prompts | No       | `false` | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Notes**

Revoke invalidates the connection's active session and tokens but keeps the connection and its stored credentials, so it can be re-authorized later. Use `delete` to remove the connection entirely.

## machineuser

Manage machine users in your Tailor Platform application.

**Usage**

```
tailor-sdk machineuser [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                   | Description                                |
| ----------------------------------------- | ------------------------------------------ |
| [`machineuser list`](#machineuser-list)   | List all machine users in the application. |
| [`machineuser token`](#machineuser-token) | Get an access token for a machine user.    |

### machineuser list

List all machine users in the application.

**Usage**

```
tailor-sdk machineuser list [options]
```

**Options**

| Option                          | Alias | Description                                              | Required | Default              | Env                               |
| ------------------------------- | ----- | -------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                             | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                        | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                  | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--order <ORDER>`               | -     | Sort order (asc or desc)                                 | No       | `"desc"`             | -                                 |
| `--limit <LIMIT>`               | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -                    | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### machineuser token

Get an access token for a machine user.

**Usage**

```
tailor-sdk machineuser token [options] [name]
```

**Arguments**

| Argument | Description                                                                                                         | Required |
| -------- | ------------------------------------------------------------------------------------------------------------------- | -------- |
| `name`   | Machine user name. Falls back to TAILOR_PLATFORM_MACHINE_USER_NAME, then the active profile's default machine user. | No       |

**Options**

| Option                          | Alias | Description             | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

## oauth2client

Manage OAuth2 clients in your Tailor Platform application.

**Usage**

```
tailor-sdk oauth2client [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                   | Description                                              |
| ----------------------------------------- | -------------------------------------------------------- |
| [`oauth2client list`](#oauth2client-list) | List all OAuth2 clients in the application.              |
| [`oauth2client get`](#oauth2client-get)   | Get OAuth2 client credentials (including client secret). |

### oauth2client list

List all OAuth2 clients in the application.

**Usage**

```
tailor-sdk oauth2client list [options]
```

**Options**

| Option                          | Alias | Description                                              | Required | Default              | Env                               |
| ------------------------------- | ----- | -------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                             | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                        | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                  | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--order <ORDER>`               | -     | Sort order (asc or desc)                                 | No       | `"desc"`             | -                                 |
| `--limit <LIMIT>`               | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -                    | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Output:**

Returns a list of OAuth2 clients with the following fields:

- `name` - Client name
- `description` - Client description
- `clientId` - OAuth2 client ID
- `grantTypes` - Supported grant types (e.g., `authorization_code`, `refresh_token`)
- `redirectUris` - Registered redirect URIs
- `createdAt` - Creation timestamp

### oauth2client get

Get OAuth2 client credentials (including client secret).

**Usage**

```
tailor-sdk oauth2client get [options] <name>
```

**Arguments**

| Argument | Description        | Required |
| -------- | ------------------ | -------- |
| `name`   | OAuth2 client name | Yes      |

**Options**

| Option                          | Alias | Description             | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Output:**

Returns the OAuth2 client credentials with the following fields:

- `name` - Client name
- `description` - Client description
- `clientId` - OAuth2 client ID
- `clientSecret` - OAuth2 client secret
- `grantTypes` - Supported grant types
- `redirectUris` - Registered redirect URIs
- `createdAt` - Creation timestamp
