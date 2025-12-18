# Auth Resource Commands

Commands for managing Auth service resources (machine users and OAuth2 clients).

## machineuser

Manage machine users in your Tailor Platform application.

```bash
tailor-sdk machineuser <subcommand> [options]
```

### machineuser list

List all machine users in the application.

```bash
tailor-sdk machineuser list [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-j, --json` - Output as JSON

### machineuser token

Get an access token for a machine user.

```bash
tailor-sdk machineuser token <name> [options]
```

**Arguments:**

- `name` - Machine user name (required)

**Options:**

- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-j, --json` - Output as JSON

## oauth2client

Manage OAuth2 clients in your Tailor Platform application.

```bash
tailor-sdk oauth2client <subcommand> [options]
```

### oauth2client list

List all OAuth2 clients in the application.

```bash
tailor-sdk oauth2client list [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-j, --json` - Output as JSON

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

```bash
tailor-sdk oauth2client get <name> [options]
```

**Arguments:**

- `name` - OAuth2 client name (required)

**Options:**

- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-j, --json` - Output as JSON

**Output:**

Returns the OAuth2 client credentials with the following fields:

- `name` - Client name
- `description` - Client description
- `clientId` - OAuth2 client ID
- `clientSecret` - OAuth2 client secret
- `grantTypes` - Supported grant types
- `redirectUris` - Registered redirect URIs
- `createdAt` - Creation timestamp
