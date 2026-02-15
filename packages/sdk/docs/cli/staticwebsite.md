# Static Website Commands

Commands for managing and deploying static websites.

<!-- politty:command:staticwebsite:start -->

## staticwebsite

Manage static websites in your workspace.

**Usage**

```
tailor-sdk staticwebsite [command]
```

**Commands**

| Command                                         | Description                                           |
| ----------------------------------------------- | ----------------------------------------------------- |
| [`staticwebsite deploy`](#staticwebsite-deploy) | Deploy a static website from a local build directory. |
| [`staticwebsite get`](#staticwebsite-get)       | Get details of a specific static website.             |
| [`staticwebsite list`](#staticwebsite-list)     | List all static websites in a workspace.              |

<!-- politty:command:staticwebsite:end -->
<!-- politty:command:staticwebsite deploy:start -->

### staticwebsite deploy

Deploy a static website from a local build directory.

**Usage**

```
tailor-sdk staticwebsite deploy [options]
```

**Options**

| Option                          | Alias | Description                      | Required | Default |
| ------------------------------- | ----- | -------------------------------- | -------- | ------- |
| `--json`                        | `-j`  | Output as JSON                   | No       | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                     | No       | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                | No       | -       |
| `--name <NAME>`                 | `-n`  | Static website name              | Yes      | -       |
| `--dir <DIR>`                   | `-d`  | Path to the static website files | Yes      | -       |

<!-- politty:command:staticwebsite deploy:end -->
<!-- politty:command:staticwebsite list:start -->

### staticwebsite list

List all static websites in a workspace.

**Usage**

```
tailor-sdk staticwebsite list [options]
```

**Options**

| Option                          | Alias | Description       | Required | Default |
| ------------------------------- | ----- | ----------------- | -------- | ------- |
| `--json`                        | `-j`  | Output as JSON    | No       | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       |

<!-- politty:command:staticwebsite list:end -->
<!-- politty:command:staticwebsite get:start -->

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

| Option                          | Alias | Description       | Required | Default |
| ------------------------------- | ----- | ----------------- | -------- | ------- |
| `--json`                        | `-j`  | Output as JSON    | No       | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       |

<!-- politty:command:staticwebsite get:end -->

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
