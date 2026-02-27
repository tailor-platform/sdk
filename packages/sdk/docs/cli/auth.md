# Auth Resource Commands

Commands for managing Auth service resources (machine users and OAuth2 clients).

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

| Option                          | Alias | Description             | Required | Default              |
| ------------------------------- | ----- | ----------------------- | -------- | -------------------- |
| `--json`                        | `-j`  | Output as JSON          | No       | `false`              |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | No       | -                    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | No       | -                    |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | No       | `"tailor.config.ts"` |

<!-- politty:command:machineuser list:options:end -->
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

| Option                          | Alias | Description             | Required | Default              |
| ------------------------------- | ----- | ----------------------- | -------- | -------------------- |
| `--json`                        | `-j`  | Output as JSON          | No       | `false`              |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | No       | -                    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | No       | -                    |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | No       | `"tailor.config.ts"` |

<!-- politty:command:machineuser token:options:end -->
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
| [`oauth2client get`](#oauth2client-get)   | Get OAuth2 client credentials (including client secret). |
| [`oauth2client list`](#oauth2client-list) | List all OAuth2 clients in the application.              |

<!-- politty:command:oauth2client:subcommands:end -->
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

| Option                          | Alias | Description             | Required | Default              |
| ------------------------------- | ----- | ----------------------- | -------- | -------------------- |
| `--json`                        | `-j`  | Output as JSON          | No       | `false`              |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | No       | -                    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | No       | -                    |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | No       | `"tailor.config.ts"` |

<!-- politty:command:oauth2client list:options:end -->
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

| Option                          | Alias | Description             | Required | Default              |
| ------------------------------- | ----- | ----------------------- | -------- | -------------------- |
| `--json`                        | `-j`  | Output as JSON          | No       | `false`              |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | No       | -                    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | No       | -                    |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | No       | `"tailor.config.ts"` |

<!-- politty:command:oauth2client get:options:end -->

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
