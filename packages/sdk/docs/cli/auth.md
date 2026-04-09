# Auth Resource Commands

Commands for managing Auth service resources (auth connections, machine users, and OAuth2 clients).

<!-- politty:command:authconnection:heading:start -->

## authconnection

<!-- politty:command:authconnection:heading:end -->

<!-- politty:command:authconnection:description:start -->

Manage auth connections.

<!-- politty:command:authconnection:description:end -->

<!-- politty:command:authconnection:usage:start -->

**Usage**

```
tailor-sdk authconnection [command]
```

<!-- politty:command:authconnection:usage:end -->

<!-- politty:command:authconnection:subcommands:start -->

**Commands**

| Command                                                 | Description                                   |
| ------------------------------------------------------- | --------------------------------------------- |
| [`authconnection authorize`](#authconnection-authorize) | Authorize an auth connection via OAuth2 flow. |
| [`authconnection list`](#authconnection-list)           | List all auth connections.                    |
| [`authconnection revoke`](#authconnection-revoke)       | Revoke an auth connection.                    |

<!-- politty:command:authconnection:subcommands:end -->

<!-- politty:command:authconnection:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:authconnection:global-options-link:end -->
<!-- politty:command:authconnection authorize:heading:start -->

### authconnection authorize

<!-- politty:command:authconnection authorize:heading:end -->

<!-- politty:command:authconnection authorize:description:start -->

Authorize an auth connection via OAuth2 flow.

<!-- politty:command:authconnection authorize:description:end -->

<!-- politty:command:authconnection authorize:usage:start -->

**Usage**

```
tailor-sdk authconnection authorize [options]
```

<!-- politty:command:authconnection authorize:usage:end -->

<!-- politty:command:authconnection authorize:options:start -->

**Options**

| Option                          | Alias | Description                                | Required | Default                  | Env                            |
| ------------------------------- | ----- | ------------------------------------------ | -------- | ------------------------ | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                               | No       | -                        | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                          | No       | -                        | `TAILOR_PLATFORM_PROFILE`      |
| `--name <NAME>`                 | `-n`  | Auth connection name                       | Yes      | -                        | -                              |
| `--scopes <SCOPES>`             | -     | OAuth2 scopes to request (comma-separated) | No       | `"openid,profile,email"` | -                              |
| `--port <PORT>`                 | -     | Local callback server port                 | No       | `8080`                   | -                              |
| `--no-browser`                  | -     | Don't open browser automatically           | No       | `false`                  | -                              |

<!-- politty:command:authconnection authorize:options:end -->

<!-- politty:command:authconnection authorize:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:authconnection authorize:global-options-link:end -->

<!-- politty:command:authconnection list:heading:start -->

### authconnection list

<!-- politty:command:authconnection list:heading:end -->

<!-- politty:command:authconnection list:description:start -->

List all auth connections.

<!-- politty:command:authconnection list:description:end -->

<!-- politty:command:authconnection list:usage:start -->

**Usage**

```
tailor-sdk authconnection list [options]
```

<!-- politty:command:authconnection list:usage:end -->

<!-- politty:command:authconnection list:options:start -->

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

<!-- politty:command:authconnection list:options:end -->

<!-- politty:command:authconnection list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:authconnection list:global-options-link:end -->
<!-- politty:command:authconnection revoke:heading:start -->

### authconnection revoke

<!-- politty:command:authconnection revoke:heading:end -->

<!-- politty:command:authconnection revoke:description:start -->

Revoke an auth connection.

<!-- politty:command:authconnection revoke:description:end -->

<!-- politty:command:authconnection revoke:usage:start -->

**Usage**

```
tailor-sdk authconnection revoke [options]
```

<!-- politty:command:authconnection revoke:usage:end -->

<!-- politty:command:authconnection revoke:options:start -->

**Options**

| Option                          | Alias | Description               | Required | Default | Env                            |
| ------------------------------- | ----- | ------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID              | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile         | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--name <NAME>`                 | `-n`  | Auth connection name      | Yes      | -       | -                              |
| `--yes`                         | `-y`  | Skip confirmation prompts | No       | `false` | -                              |

<!-- politty:command:authconnection revoke:options:end -->

<!-- politty:command:authconnection revoke:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:authconnection revoke:global-options-link:end -->

<!-- politty:command:machineuser:heading:start -->

## machineuser

<!-- politty:command:machineuser:heading:end -->

<!-- politty:command:machineuser:description:start -->

Manage machine users in your Tailor Platform application.

<!-- politty:command:machineuser:description:end -->

<!-- politty:command:machineuser:usage:start -->

**Usage**

```
tailor-sdk machineuser [command]
```

<!-- politty:command:machineuser:usage:end -->

<!-- politty:command:machineuser:subcommands:start -->

**Commands**

| Command                                   | Description                                |
| ----------------------------------------- | ------------------------------------------ |
| [`machineuser list`](#machineuser-list)   | List all machine users in the application. |
| [`machineuser token`](#machineuser-token) | Get an access token for a machine user.    |

<!-- politty:command:machineuser:subcommands:end -->

<!-- politty:command:machineuser:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:machineuser:global-options-link:end -->
<!-- politty:command:machineuser list:heading:start -->

### machineuser list

<!-- politty:command:machineuser list:heading:end -->

<!-- politty:command:machineuser list:description:start -->

List all machine users in the application.

<!-- politty:command:machineuser list:description:end -->

<!-- politty:command:machineuser list:usage:start -->

**Usage**

```
tailor-sdk machineuser list [options]
```

<!-- politty:command:machineuser list:usage:end -->

<!-- politty:command:machineuser list:options:start -->

**Options**

| Option                          | Alias | Description             | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |

<!-- politty:command:machineuser list:options:end -->

<!-- politty:command:machineuser list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:machineuser list:global-options-link:end -->
<!-- politty:command:machineuser token:heading:start -->

### machineuser token

<!-- politty:command:machineuser token:heading:end -->

<!-- politty:command:machineuser token:description:start -->

Get an access token for a machine user.

<!-- politty:command:machineuser token:description:end -->

<!-- politty:command:machineuser token:usage:start -->

**Usage**

```
tailor-sdk machineuser token [options] <name>
```

<!-- politty:command:machineuser token:usage:end -->

<!-- politty:command:machineuser token:arguments:start -->

**Arguments**

| Argument | Description       | Required |
| -------- | ----------------- | -------- |
| `name`   | Machine user name | Yes      |

<!-- politty:command:machineuser token:arguments:end -->

<!-- politty:command:machineuser token:options:start -->

**Options**

| Option                          | Alias | Description             | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |

<!-- politty:command:machineuser token:options:end -->

<!-- politty:command:machineuser token:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:machineuser token:global-options-link:end -->
<!-- politty:command:oauth2client:heading:start -->

## oauth2client

<!-- politty:command:oauth2client:heading:end -->

<!-- politty:command:oauth2client:description:start -->

Manage OAuth2 clients in your Tailor Platform application.

<!-- politty:command:oauth2client:description:end -->

<!-- politty:command:oauth2client:usage:start -->

**Usage**

```
tailor-sdk oauth2client [command]
```

<!-- politty:command:oauth2client:usage:end -->

<!-- politty:command:oauth2client:subcommands:start -->

**Commands**

| Command                                   | Description                                              |
| ----------------------------------------- | -------------------------------------------------------- |
| [`oauth2client list`](#oauth2client-list) | List all OAuth2 clients in the application.              |
| [`oauth2client get`](#oauth2client-get)   | Get OAuth2 client credentials (including client secret). |

<!-- politty:command:oauth2client:subcommands:end -->

<!-- politty:command:oauth2client:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:oauth2client:global-options-link:end -->
<!-- politty:command:oauth2client list:heading:start -->

### oauth2client list

<!-- politty:command:oauth2client list:heading:end -->

<!-- politty:command:oauth2client list:description:start -->

List all OAuth2 clients in the application.

<!-- politty:command:oauth2client list:description:end -->

<!-- politty:command:oauth2client list:usage:start -->

**Usage**

```
tailor-sdk oauth2client list [options]
```

<!-- politty:command:oauth2client list:usage:end -->

<!-- politty:command:oauth2client list:options:start -->

**Options**

| Option                          | Alias | Description             | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |

<!-- politty:command:oauth2client list:options:end -->

<!-- politty:command:oauth2client list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:oauth2client list:global-options-link:end -->
<!-- politty:command:oauth2client get:heading:start -->

### oauth2client get

<!-- politty:command:oauth2client get:heading:end -->

<!-- politty:command:oauth2client get:description:start -->

Get OAuth2 client credentials (including client secret).

<!-- politty:command:oauth2client get:description:end -->

<!-- politty:command:oauth2client get:usage:start -->

**Usage**

```
tailor-sdk oauth2client get [options] <name>
```

<!-- politty:command:oauth2client get:usage:end -->

<!-- politty:command:oauth2client get:arguments:start -->

**Arguments**

| Argument | Description        | Required |
| -------- | ------------------ | -------- |
| `name`   | OAuth2 client name | Yes      |

<!-- politty:command:oauth2client get:arguments:end -->

<!-- politty:command:oauth2client get:options:start -->

**Options**

| Option                          | Alias | Description             | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |

<!-- politty:command:oauth2client get:options:end -->

<!-- politty:command:oauth2client get:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:oauth2client get:global-options-link:end -->

**Output:**

Returns a list of OAuth2 clients with the following fields:

- `name` - Client name
- `description` - Client description
- `clientId` - OAuth2 client ID
- `grantTypes` - Supported grant types (e.g., `authorization_code`, `refresh_token`)
- `redirectUris` - Registered redirect URIs
- `createdAt` - Creation timestamp

**Output:**

Returns the OAuth2 client credentials with the following fields:

- `name` - Client name
- `description` - Client description
- `clientId` - OAuth2 client ID
- `clientSecret` - OAuth2 client secret
- `grantTypes` - Supported grant types
- `redirectUris` - Registered redirect URIs
- `createdAt` - Creation timestamp
