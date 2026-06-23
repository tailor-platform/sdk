# Static Website Commands

Commands for managing and deploying static websites.

## staticwebsite

Manage static websites in your workspace.

**Usage**

```
tailor-sdk staticwebsite [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                         | Description                                           |
| ----------------------------------------------- | ----------------------------------------------------- |
| [`staticwebsite deploy`](#staticwebsite-deploy) | Deploy a static website from a local build directory. |
| [`staticwebsite domain`](#staticwebsite-domain) | Manage custom domains for static websites.            |
| [`staticwebsite list`](#staticwebsite-list)     | List all static websites in a workspace.              |
| [`staticwebsite get`](#staticwebsite-get)       | Get details of a specific static website.             |

### staticwebsite deploy

Deploy a static website from a local build directory.

**Usage**

```
tailor-sdk staticwebsite deploy [options]
```

**Options**

| Option                          | Alias | Description                      | Required | Default | Env                            |
| ------------------------------- | ----- | -------------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                     | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--name <NAME>`                 | `-n`  | Static website name              | Yes      | -       | -                              |
| `--dir <DIR>`                   | `-d`  | Path to the static website files | Yes      | -       | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.
**Example:**

```bash
# Deploy a static website from the dist directory
tailor-sdk staticwebsite deploy --name my-website --dir ./dist

# Deploy with workspace ID
tailor-sdk staticwebsite deploy -n my-website -d ./dist -w ws_abc123
```

**Notes:**

- The deployment process uploads all files from the specified directory
- Files are uploaded with appropriate MIME types based on file extensions
- Unsupported file types or invalid files will be skipped with warnings
- The deployment URL is returned after successful deployment

### staticwebsite list

List all static websites in a workspace.

**Usage**

```
tailor-sdk staticwebsite list [options]
```

**Options**

| Option                          | Alias | Description                                              | Required | Default  | Env                            |
| ------------------------------- | ----- | -------------------------------------------------------- | -------- | -------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                             | No       | -        | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                        | No       | -        | `TAILOR_PLATFORM_PROFILE`      |
| `--order <ORDER>`               | -     | Sort order (asc or desc)                                 | No       | `"desc"` | -                              |
| `--limit <LIMIT>`               | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -        | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.
**Example:**

```bash
# List all static websites
tailor-sdk staticwebsite list

# List with JSON output
tailor-sdk staticwebsite list --json
```

### staticwebsite domain

Manage custom domains for static websites.

**Usage**

```
tailor-sdk staticwebsite domain <command>
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                                   | Description                               |
| --------------------------------------------------------- | ----------------------------------------- |
| [`staticwebsite domain list`](#staticwebsite-domain-list) | List custom domains for a static website. |
| [`staticwebsite domain get`](#staticwebsite-domain-get)   | Get details of a custom domain.           |

#### staticwebsite domain get

Get details of a custom domain.

**Usage**

```
tailor-sdk staticwebsite domain get [options] <domain>
```

**Arguments**

| Argument | Description        | Required |
| -------- | ------------------ | -------- |
| `domain` | Custom domain name | Yes      |

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### staticwebsite domain list

List custom domains for a static website.

**Usage**

```
tailor-sdk staticwebsite domain list [options] <name>
```

**Arguments**

| Argument | Description         | Required |
| -------- | ------------------- | -------- |
| `name`   | Static website name | Yes      |

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### staticwebsite get

Get details of a specific static website.

**Usage**

```
tailor-sdk staticwebsite get [options] <name>
```

**Arguments**

| Argument | Description         | Required |
| -------- | ------------------- | -------- |
| `name`   | Static website name | Yes      |

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.
**Example:**

```bash
# Get details of a static website
tailor-sdk staticwebsite get my-website

# Get with JSON output
tailor-sdk staticwebsite get my-website --json
```
