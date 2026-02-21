# Auth Resource Commands

Commands for managing Auth service resources (machine users and OAuth2 clients).

<!-- politty:command:machineuser:start -->

## machineuser

Manage machine users in your Tailor Platform application.

**Usage**

```
tailor-sdk machineuser [command]
```

**Commands**

| Command                                   | Description                                |
| ----------------------------------------- | ------------------------------------------ |
| [`machineuser list`](#machineuser-list)   | List all machine users in the application. |
| [`machineuser token`](#machineuser-token) | Get an access token for a machine user.    |

<!-- politty:command:machineuser:end -->
<!-- politty:command:machineuser list:start -->

### machineuser list

List all machine users in the application.

**Usage**

```
tailor-sdk machineuser list [options]
```

**Options**

| Option                          | Alias | Description             | Default              |
| ------------------------------- | ----- | ----------------------- | -------------------- |
| `--json`                        | `-j`  | Output as JSON          | `false`              |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | -                    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | -                    |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | `"tailor.config.ts"` |

<!-- politty:command:machineuser list:end -->
<!-- politty:command:machineuser token:start -->

### machineuser token

Get an access token for a machine user.

**Usage**

```
tailor-sdk machineuser token [options] <name>
```

**Arguments**

| Argument | Description       | Required |
| -------- | ----------------- | -------- |
| `name`   | Machine user name | Yes      |

**Options**

| Option                          | Alias | Description             | Default              |
| ------------------------------- | ----- | ----------------------- | -------------------- |
| `--json`                        | `-j`  | Output as JSON          | `false`              |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | -                    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | -                    |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | `"tailor.config.ts"` |

<!-- politty:command:machineuser token:end -->
<!-- politty:command:oauth2client:start -->

## oauth2client

Manage OAuth2 clients in your Tailor Platform application.

**Usage**

```
tailor-sdk oauth2client [command]
```

**Commands**

| Command                                   | Description                                              |
| ----------------------------------------- | -------------------------------------------------------- |
| [`oauth2client get`](#oauth2client-get)   | Get OAuth2 client credentials (including client secret). |
| [`oauth2client list`](#oauth2client-list) | List all OAuth2 clients in the application.              |

<!-- politty:command:oauth2client:end -->
<!-- politty:command:oauth2client list:start -->

### oauth2client list

List all OAuth2 clients in the application.

**Usage**

```
tailor-sdk oauth2client list [options]
```

**Options**

| Option                          | Alias | Description             | Default              |
| ------------------------------- | ----- | ----------------------- | -------------------- |
| `--json`                        | `-j`  | Output as JSON          | `false`              |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | -                    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | -                    |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | `"tailor.config.ts"` |

<!-- politty:command:oauth2client list:end -->
<!-- politty:command:oauth2client get:start -->

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

| Option                          | Alias | Description             | Default              |
| ------------------------------- | ----- | ----------------------- | -------------------- |
| `--json`                        | `-j`  | Output as JSON          | `false`              |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | -                    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | -                    |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | `"tailor.config.ts"` |

<!-- politty:command:oauth2client get:end -->

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
