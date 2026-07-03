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

## CLI Plugins

> [!WARNING]
> CLI plugins are a **beta** feature. The dispatch behavior and the set of injected environment
> variables may change in a future release.

You can extend the CLI with external plugins, similar to `gh` extensions. When you run a command that
is not a built-in, the CLI looks for an executable named `tailor-<name>` and runs it, forwarding the
remaining arguments:

```bash
# Runs the `tailor-hello` executable with: world --loud
tailor hello world --loud
```

This also works under a built-in command group. The command path is joined with hyphens, so a plugin
nested under `tailordb` is named `tailor-tailordb-erd`:

```bash
# Runs `tailor-tailordb-erd` with: export
tailor tailordb erd export
```

Resolution rules:

- **Built-ins always win.** A plugin is only used when no built-in command matches.
- **A command that takes its own arguments is never replaced.** Plugin dispatch applies only to command
  _groups_ (commands that just route to subcommands). A command that performs its own action — including
  one that accepts a positional argument — always runs itself, so a plugin can never shadow an argument value.
- **Lookup order:** the project's `node_modules/.bin` (nearest first, walking up from the current
  directory), then your `PATH`. So a plugin installed as a project dev-dependency takes precedence over a
  globally installed one.

Because resolution is based on `node_modules/.bin` and `PATH`, any package manager that populates
`node_modules/.bin` works for project-local plugins — npm, pnpm (its content-addressable store is
transparent here), Bun, and Yarn Classic. The exception is **Yarn Plug'n'Play**, which does not create a
`node_modules` directory: install such plugins globally so they resolve via `PATH`, or use Yarn's
`nodeLinker: node-modules` setting.

Run `tailor plugin list` to see which plugins are discovered and where they resolve from.

### Context passed to plugins

Before running a plugin, the CLI injects the current Tailor Platform context as environment variables so
the plugin does not need to re-implement authentication or re-resolve the active workspace:

| Variable                           | Description                                                              |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `TAILOR_PLATFORM_TOKEN`            | A valid access token (refreshed if needed). Omitted when not logged in.  |
| `TAILOR_PLATFORM_URL`              | The Tailor Platform endpoint in effect                                   |
| `TAILOR_PLATFORM_OAUTH2_CLIENT_ID` | The OAuth2 client ID in effect, for plugins that run their own auth flow |
| `TAILOR_PLATFORM_WORKSPACE_ID`     | The resolved workspace ID, when one can be determined                    |
| `TAILOR_PLATFORM_USER`             | The active user (email when known), when logged in                       |
| `TAILOR_CONFIG_PATH`               | Path to the resolved Tailor config file, when found                      |
| `TAILOR_VERSION`                   | The `tailor` version that invoked the plugin                             |
| `TAILOR_BIN`                       | Path to the `tailor` executable, for calling back into the CLI           |

The token, workspace ID, and user are best-effort: whatever the current context can resolve is injected,
and auth-free plugins still run when you are not logged in. A long-running plugin (or one started on its
own) can obtain a fresh token at any time with `tailor auth token`, which prints a valid access token to
stdout, refreshing it first if it has expired.

## Commands

{{politty:index}}
