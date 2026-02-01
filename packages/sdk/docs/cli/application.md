# Application Commands

Commands for managing Tailor Platform applications. These commands work with `tailor.config.ts`.

<!-- politty:command:init:start -->
## init

Initialize a new project using create-sdk

**Usage**

```
tailor-sdk init [options] [name]
```

**Arguments**

| Argument | Description | Required |
|----------|-------------|----------|
| `name` | Project name | No |

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--env-file <ENV_FILE>` | `-e` | Path to the environment file (error if not found) | - |
| `--env-file-if-exists <ENV_FILE_IF_EXISTS>` | - | Path to the environment file (ignored if not found) | - |
| `--verbose` | - | Enable verbose logging | `false` |
| `--template <TEMPLATE>` | `-t` | Template name | - |

<!-- politty:command:init:end -->

<!-- politty:command:generate:start -->
## generate

Generate files using Tailor configuration

**Usage**

```
tailor-sdk generate [options]
```

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--env-file <ENV_FILE>` | `-e` | Path to the environment file (error if not found) | - |
| `--env-file-if-exists <ENV_FILE_IF_EXISTS>` | - | Path to the environment file (ignored if not found) | - |
| `--verbose` | - | Enable verbose logging | `false` |
| `--config <CONFIG>` | `-c` | Path to SDK config file | `"tailor.config.ts"` |
| `--watch` | `-W` | Watch for type/resolver changes and regenerate | `false` |

<!-- politty:command:generate:end -->

<!-- politty:command:apply:start -->
## apply

Deploy Tailor configuration to workspace

**Usage**

```
tailor-sdk apply [options]
```

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--env-file <ENV_FILE>` | `-e` | Path to the environment file (error if not found) | - |
| `--env-file-if-exists <ENV_FILE_IF_EXISTS>` | - | Path to the environment file (ignored if not found) | - |
| `--verbose` | - | Enable verbose logging | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |
| `--config <CONFIG>` | `-c` | Path to SDK config file | `"tailor.config.ts"` |
| `--yes` | `-y` | Skip confirmation prompts | `false` |
| `--dry-run` | `-d` | Run the command without making any changes | - |
| `--no-schema-check` | - | Skip schema diff check against migration snapshots | - |

<!-- politty:command:apply:end -->

**Migration Handling:**

When migrations are configured (`db.tailordb.migration` in config), the `apply` command automatically:

1. Detects pending migration scripts that haven't been executed
2. Applies schema changes in a safe order (pre-migration → script execution → post-migration)
3. Executes migration scripts via TestExecScript API
4. Updates migration state labels in TailorDB metadata

See [TailorDB Commands](./tailordb.md#automatic-migration-execution) for details on automatic migration execution.

**Schema Check:**

By default, `apply` performs two verification steps:

1. **Local schema check**: Verifies that local schema changes match the migration files. This ensures migrations are properly generated before deployment.
2. **Remote schema check**: Verifies that the remote schema matches the expected state based on migration history. This detects schema drift caused by manual changes or other developers.

If remote schema drift is detected, the apply will fail with an error showing the differences. This helps prevent applying migrations to an inconsistent state.

Use `--no-schema-check` to skip both verifications (not recommended for production).

<!-- politty:command:remove:start -->
## remove

Remove all resources managed by the application

**Usage**

```
tailor-sdk remove [options]
```

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--env-file <ENV_FILE>` | `-e` | Path to the environment file (error if not found) | - |
| `--env-file-if-exists <ENV_FILE_IF_EXISTS>` | - | Path to the environment file (ignored if not found) | - |
| `--verbose` | - | Enable verbose logging | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |
| `--config <CONFIG>` | `-c` | Path to SDK config file | `"tailor.config.ts"` |
| `--yes` | `-y` | Skip confirmation prompts | `false` |

<!-- politty:command:remove:end -->

<!-- politty:command:show:start -->
## show

Show applied application information

**Usage**

```
tailor-sdk show [options]
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
| `--config <CONFIG>` | `-c` | Path to SDK config file | `"tailor.config.ts"` |

<!-- politty:command:show:end -->

<!-- politty:command:open:start -->
## open

Open Tailor Platform Console for the application

**Usage**

```
tailor-sdk open [options]
```

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--env-file <ENV_FILE>` | `-e` | Path to the environment file (error if not found) | - |
| `--env-file-if-exists <ENV_FILE_IF_EXISTS>` | - | Path to the environment file (ignored if not found) | - |
| `--verbose` | - | Enable verbose logging | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |
| `--config <CONFIG>` | `-c` | Path to SDK config file | `"tailor.config.ts"` |

<!-- politty:command:open:end -->

<!-- politty:command:api:start -->
## api

Call Tailor Platform API endpoints directly

**Usage**

```
tailor-sdk api [options] <endpoint>
```

**Arguments**

| Argument | Description | Required |
|----------|-------------|----------|
| `endpoint` | API endpoint to call (e.g., 'GetApplication' or 'tailor.v1.OperatorService/GetApplication') | Yes |

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--env-file <ENV_FILE>` | `-e` | Path to the environment file (error if not found) | - |
| `--env-file-if-exists <ENV_FILE_IF_EXISTS>` | - | Path to the environment file (ignored if not found) | - |
| `--verbose` | - | Enable verbose logging | `false` |
| `--json` | `-j` | Output as JSON | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |
| `--body <BODY>` | `-b` | Request body as JSON | `"{}"` |

<!-- politty:command:api:end -->
