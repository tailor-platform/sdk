# Static Website Commands

Commands for managing and deploying static websites.

<!-- politty:command:staticwebsite:start -->
## staticwebsite

Manage static websites

**Usage**

```
tailor-sdk staticwebsite [command]
```

**Commands**

| Command | Description |
|---------|-------------|
| [`staticwebsite deploy`](#staticwebsite-deploy) | Deploy a static website |
| [`staticwebsite get`](#staticwebsite-get) | Get static website details |
| [`staticwebsite list`](#staticwebsite-list) | List static websites |

<!-- politty:command:staticwebsite:end -->
<!-- politty:command:staticwebsite deploy:start -->
### staticwebsite deploy

Deploy a static website

**Usage**

```
tailor-sdk staticwebsite deploy [options]
```

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--env-file <ENV_FILE>` | `-e` | Path to the environment file (error if not found) | - |
| `--env-file-if-exists <ENV_FILE_IF_EXISTS>` | - | Path to the environment file (ignored if not found) | - |
| `--verbose` | - | Enable verbose logging | `false` |
| `--json` | `-j` | Output as JSON | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |
| `--name <NAME>` | `-n` | Static website name | - |
| `--dir <DIR>` | `-d` | Path to the static website files | - |

<!-- politty:command:staticwebsite deploy:end -->
<!-- politty:command:staticwebsite list:start -->
### staticwebsite list

List static websites

**Usage**

```
tailor-sdk staticwebsite list [options]
```

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--env-file <ENV_FILE>` | `-e` | Path to the environment file (error if not found) | - |
| `--env-file-if-exists <ENV_FILE_IF_EXISTS>` | - | Path to the environment file (ignored if not found) | - |
| `--verbose` | - | Enable verbose logging | `false` |
| `--json` | `-j` | Output as JSON | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |

<!-- politty:command:staticwebsite list:end -->
<!-- politty:command:staticwebsite get:start -->
### staticwebsite get

Get static website details

**Usage**

```
tailor-sdk staticwebsite get [options] <name>
```

**Arguments**

| Argument | Description | Required |
|----------|-------------|----------|
| `name` | Static website name | Yes |

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--env-file <ENV_FILE>` | `-e` | Path to the environment file (error if not found) | - |
| `--env-file-if-exists <ENV_FILE_IF_EXISTS>` | - | Path to the environment file (ignored if not found) | - |
| `--verbose` | - | Enable verbose logging | `false` |
| `--json` | `-j` | Output as JSON | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |

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
