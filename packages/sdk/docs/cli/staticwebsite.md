# Static Website Commands

Commands for managing and deploying static websites.

<!-- politty:command:staticwebsite:heading:start -->

## staticwebsite

<!-- politty:command:staticwebsite:heading:end -->

<!-- politty:command:staticwebsite:description:start -->

Manage static websites in your workspace.

<!-- politty:command:staticwebsite:description:end -->

<!-- politty:command:staticwebsite:usage:start -->

**Usage**

```
tailor-sdk staticwebsite [command]
```

<!-- politty:command:staticwebsite:usage:end -->

<!-- politty:command:staticwebsite:subcommands:start -->

**Commands**

| Command                                         | Description                                           |
| ----------------------------------------------- | ----------------------------------------------------- |
| [`staticwebsite deploy`](#staticwebsite-deploy) | Deploy a static website from a local build directory. |
| [`staticwebsite domain`](#staticwebsite-domain) | Manage custom domains for static websites.            |
| [`staticwebsite list`](#staticwebsite-list)     | List all static websites in a workspace.              |
| [`staticwebsite get`](#staticwebsite-get)       | Get details of a specific static website.             |

<!-- politty:command:staticwebsite:subcommands:end -->

<!-- politty:command:staticwebsite:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:staticwebsite:global-options-link:end -->
<!-- politty:command:staticwebsite deploy:heading:start -->

### staticwebsite deploy

<!-- politty:command:staticwebsite deploy:heading:end -->

<!-- politty:command:staticwebsite deploy:description:start -->

Deploy a static website from a local build directory.

<!-- politty:command:staticwebsite deploy:description:end -->

<!-- politty:command:staticwebsite deploy:usage:start -->

**Usage**

```
tailor-sdk staticwebsite deploy [options]
```

<!-- politty:command:staticwebsite deploy:usage:end -->

<!-- politty:command:staticwebsite deploy:options:start -->

**Options**

| Option                          | Alias | Description                      | Required | Default | Env                            |
| ------------------------------- | ----- | -------------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                     | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--name <NAME>`                 | `-n`  | Static website name              | Yes      | -       | -                              |
| `--dir <DIR>`                   | `-d`  | Path to the static website files | Yes      | -       | -                              |

<!-- politty:command:staticwebsite deploy:options:end -->

<!-- politty:command:staticwebsite deploy:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:staticwebsite deploy:global-options-link:end -->
<!-- politty:command:staticwebsite list:heading:start -->

### staticwebsite list

<!-- politty:command:staticwebsite list:heading:end -->

<!-- politty:command:staticwebsite list:description:start -->

List all static websites in a workspace.

<!-- politty:command:staticwebsite list:description:end -->

<!-- politty:command:staticwebsite list:usage:start -->

**Usage**

```
tailor-sdk staticwebsite list [options]
```

<!-- politty:command:staticwebsite list:usage:end -->

<!-- politty:command:staticwebsite list:options:start -->

**Options**

| Option                          | Alias | Description                                              | Required | Default  | Env                            |
| ------------------------------- | ----- | -------------------------------------------------------- | -------- | -------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                             | No       | -        | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                        | No       | -        | `TAILOR_PLATFORM_PROFILE`      |
| `--order <ORDER>`               | -     | Sort order (asc or desc)                                 | No       | `"desc"` | -                              |
| `--limit <LIMIT>`               | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -        | -                              |

<!-- politty:command:staticwebsite list:options:end -->

<!-- politty:command:staticwebsite list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:staticwebsite list:global-options-link:end -->
<!-- politty:command:staticwebsite domain:heading:start -->

### staticwebsite domain

<!-- politty:command:staticwebsite domain:heading:end -->

<!-- politty:command:staticwebsite domain:description:start -->

Manage custom domains for static websites.

<!-- politty:command:staticwebsite domain:description:end -->

<!-- politty:command:staticwebsite domain:usage:start -->

**Usage**

```
tailor-sdk staticwebsite domain [command]
```

<!-- politty:command:staticwebsite domain:usage:end -->

<!-- politty:command:staticwebsite domain:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:staticwebsite domain:global-options-link:end -->

<!-- politty:command:staticwebsite domain:subcommands:start -->

**Commands**

| Command                                                   | Description                               |
| --------------------------------------------------------- | ----------------------------------------- |
| [`staticwebsite domain list`](#staticwebsite-domain-list) | List custom domains for a static website. |
| [`staticwebsite domain get`](#staticwebsite-domain-get)   | Get details of a custom domain.           |

<!-- politty:command:staticwebsite domain:subcommands:end -->
<!-- politty:command:staticwebsite domain get:heading:start -->

#### staticwebsite domain get

<!-- politty:command:staticwebsite domain get:heading:end -->

<!-- politty:command:staticwebsite domain get:description:start -->

Get details of a custom domain.

<!-- politty:command:staticwebsite domain get:description:end -->

<!-- politty:command:staticwebsite domain get:usage:start -->

**Usage**

```
tailor-sdk staticwebsite domain get [options] <domain>
```

<!-- politty:command:staticwebsite domain get:usage:end -->

<!-- politty:command:staticwebsite domain get:arguments:start -->

**Arguments**

| Argument | Description        | Required |
| -------- | ------------------ | -------- |
| `domain` | Custom domain name | Yes      |

<!-- politty:command:staticwebsite domain get:arguments:end -->

<!-- politty:command:staticwebsite domain get:options:start -->

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

<!-- politty:command:staticwebsite domain get:options:end -->

<!-- politty:command:staticwebsite domain get:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:staticwebsite domain get:global-options-link:end -->

<!-- politty:command:staticwebsite domain list:heading:start -->

#### staticwebsite domain list

<!-- politty:command:staticwebsite domain list:heading:end -->

<!-- politty:command:staticwebsite domain list:description:start -->

List custom domains for a static website.

<!-- politty:command:staticwebsite domain list:description:end -->

<!-- politty:command:staticwebsite domain list:usage:start -->

**Usage**

```
tailor-sdk staticwebsite domain list [options] <name>
```

<!-- politty:command:staticwebsite domain list:usage:end -->

<!-- politty:command:staticwebsite domain list:arguments:start -->

**Arguments**

| Argument | Description         | Required |
| -------- | ------------------- | -------- |
| `name`   | Static website name | Yes      |

<!-- politty:command:staticwebsite domain list:arguments:end -->

<!-- politty:command:staticwebsite domain list:options:start -->

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

<!-- politty:command:staticwebsite domain list:options:end -->

<!-- politty:command:staticwebsite domain list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:staticwebsite domain list:global-options-link:end -->

<!-- politty:command:staticwebsite get:heading:start -->

### staticwebsite get

<!-- politty:command:staticwebsite get:heading:end -->

<!-- politty:command:staticwebsite get:description:start -->

Get details of a specific static website.

<!-- politty:command:staticwebsite get:description:end -->

<!-- politty:command:staticwebsite get:usage:start -->

**Usage**

```
tailor-sdk staticwebsite get [options] <name>
```

<!-- politty:command:staticwebsite get:usage:end -->

<!-- politty:command:staticwebsite get:arguments:start -->

**Arguments**

| Argument | Description         | Required |
| -------- | ------------------- | -------- |
| `name`   | Static website name | Yes      |

<!-- politty:command:staticwebsite get:arguments:end -->

<!-- politty:command:staticwebsite get:options:start -->

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

<!-- politty:command:staticwebsite get:options:end -->

<!-- politty:command:staticwebsite get:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:staticwebsite get:global-options-link:end -->

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

**Example:**

```bash
# List all static websites
tailor-sdk staticwebsite list

# List with JSON output
tailor-sdk staticwebsite list --json
```

**Example:**

```bash
# Get details of a static website
tailor-sdk staticwebsite get my-website

# Get with JSON output
tailor-sdk staticwebsite get my-website --json
```
