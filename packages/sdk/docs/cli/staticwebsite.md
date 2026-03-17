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
| [`staticwebsite get`](#staticwebsite-get)       | Get details of a specific static website.             |
| [`staticwebsite list`](#staticwebsite-list)     | List all static websites in a workspace.              |

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

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

<!-- politty:command:staticwebsite list:options:end -->

<!-- politty:command:staticwebsite list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:staticwebsite list:global-options-link:end -->
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
