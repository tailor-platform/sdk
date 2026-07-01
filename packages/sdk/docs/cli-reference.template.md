# tailor

Tailor Platform SDK - The SDK to work with Tailor Platform

## Usage

```bash
tailor <command> [options]
```

## Global Options

{{politty:global-options}}

### JSON Output

For commands that return structured results, passing `--json` writes one parseable JSON document
to stdout on success. Empty successful result sets are emitted as JSON values such as `[]`, not as
human-readable text or empty stdout.

Commands that only perform side effects and do not define a structured result may leave stdout empty
even when `--json` is passed.

Errors, warnings, progress, and diagnostic messages are written to stderr. On failure, check the
non-zero exit code and read stderr; stdout is not guaranteed to contain a JSON error object.

## Common Options

The following options are available for most commands:

| Option           | Short | Description                            |
| ---------------- | ----- | -------------------------------------- |
| `--workspace-id` | `-w`  | Workspace ID (for deployment commands) |
| `--profile`      | `-p`  | Workspace profile                      |
| `--config`       | `-c`  | Path to Tailor config file             |
| `--yes`          | `-y`  | Skip confirmation prompts              |

### Environment File Loading

Both `--env-file` and `--env-file-if-exists` can be specified multiple times and follow Node.js `--env-file` behavior:

- Variables already set in the environment are **not** overwritten
- Later files override earlier files
- `--env-file` files are loaded first, then `--env-file-if-exists` files

```bash
# Load .env (required) and .env.local (optional, if exists)
tailor deploy --env-file .env --env-file-if-exists .env.local

# Load multiple files
tailor deploy --env-file .env --env-file .env.production
```

## Environment Variables

You can use environment variables to configure workspace and authentication:

| Variable                                     | Description                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `TAILOR_PLATFORM_WORKSPACE_ID`               | Workspace ID for deployment commands                                                                         |
| `TAILOR_PLATFORM_ORGANIZATION_ID`            | Organization ID for organization commands                                                                    |
| `TAILOR_PLATFORM_FOLDER_ID`                  | Folder ID for folder commands                                                                                |
| `TAILOR_PLATFORM_TOKEN`                      | Authentication token (alternative to `login`)                                                                |
| `TAILOR_PLATFORM_PROFILE`                    | Workspace profile name                                                                                       |
| `TAILOR_CONFIG_PATH`                         | Path to Tailor config file                                                                                   |
| `TAILOR_DTS_PATH`                            | Output path for generated `tailor.d.ts` type definition file                                                 |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID`     | Client ID for `login --machine-user`                                                                         |
| `TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET` | Client secret for `login --machine-user`                                                                     |
| `TAILOR_PLATFORM_MACHINE_USER_NAME`          | Default machine user name for `query`, `workflow start`, `function test-run`, `machineuser token`            |
| `TAILOR_PLATFORM_URL`                        | Platform API base URL. Saved into profiles created with `profile create --platform-url`                      |
| `TAILOR_PLATFORM_OAUTH2_CLIENT_ID`           | OAuth2 client ID for user login. Saved into profiles created with `profile create --oauth2-client-id`        |
| `TAILOR_PLATFORM_CONSOLE_URL`                | Console base URL. Saved into profiles created with `profile create --console-url`                            |
| `TAILOR_BUNDLE_CONCURRENCY`                  | Max concurrent bundle workers for `deploy` (resolvers/executors/workflows). Defaults to CPU count            |
| `TAILOR_APPLY_CONCURRENCY`                   | Max concurrent unary platform RPCs during `apply`/`deploy` (streaming uploads are not gated). Defaults to 16 |
| `TAILOR_PLATFORM_URL`                        | Tailor Platform API endpoint override                                                                        |
| `TAILOR_PLATFORM_OAUTH2_CLIENT_ID`           | OAuth2 client ID override for Tailor Platform login                                                          |
| `VISUAL` / `EDITOR`                          | Preferred editor for commands that open files (e.g., `vim`, `code`, `nano`)                                  |
| `TAILOR_CRASH_REPORTS_LOCAL`                 | Local crash log writing: `on` (default) or `off`                                                             |
| `TAILOR_CRASH_REPORTS_REMOTE`                | Automatic crash report submission: `off` (default) or `on`                                                   |

### Authentication Token Priority

Token resolution follows this priority order:

1. `TAILOR_PLATFORM_TOKEN` environment variable
2. Profile specified via `--profile` option or `TAILOR_PLATFORM_PROFILE`
3. Current user from platform config (`~/.config/tailor-platform/config.yaml`)

Config-backed login tokens are scoped to the Platform API URL. Profiles with `--platform-url` use the token saved for that URL, so switching profiles can also switch between Platform API environments.

### Workspace ID Priority

Workspace ID resolution follows this priority order:

1. `--workspace-id` command option
2. `TAILOR_PLATFORM_WORKSPACE_ID` environment variable
3. Profile specified via `--profile` option or `TAILOR_PLATFORM_PROFILE`

## Commands

{{politty:index}}
