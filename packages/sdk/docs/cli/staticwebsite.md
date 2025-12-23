# Static Website Commands

Commands for managing and deploying static websites.

## staticwebsite

Manage static websites in your workspace.

```bash
tailor-sdk staticwebsite <subcommand> [options]
```

### staticwebsite deploy

Deploy a static website from a local build directory.

```bash
tailor-sdk staticwebsite deploy [options]
```

**Options:**

- `-n, --name` - Static website name (required)
- `-d, --dir` - Path to the static website files (required)
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-j, --json` - Output as JSON

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

```bash
tailor-sdk staticwebsite list [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-j, --json` - Output as JSON

**Example:**

```bash
# List all static websites
tailor-sdk staticwebsite list

# List with JSON output
tailor-sdk staticwebsite list --json
```

### staticwebsite get

Get details of a specific static website.

```bash
tailor-sdk staticwebsite get <name> [options]
```

**Arguments:**

- `name` - Static website name (required)

**Options:**

- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-j, --json` - Output as JSON

**Example:**

```bash
# Get details of a static website
tailor-sdk staticwebsite get my-website

# Get with JSON output
tailor-sdk staticwebsite get my-website --json
```
