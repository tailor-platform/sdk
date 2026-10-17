---
description: "Deploy one tailor.config.ts to development, staging, and production workspaces, and vary configuration values, secrets, and seed data per environment."
---

# Multi-Environment Configuration

A project typically runs in more than one environment — for example, each developer's own workspace, a staging workspace, and a production workspace. The SDK has no separate "environment" concept: an environment is a workspace you deploy to, and all environments share the same `tailor.config.ts`. This guide shows how to switch the deployment target and how to vary configuration values per environment.

The auto-managed `id` in `defineConfig()` identifies the application, not an environment. Keep the same committed `id` when deploying the same config to multiple workspaces; see [Application Settings](./configuration.md#application-settings).

## Selecting the target workspace

Deployment commands resolve the target workspace from, in priority order, the `--workspace-id` (`-w`) option, the `TAILOR_PLATFORM_WORKSPACE_ID` environment variable, and the active profile. See [Workspace ID Priority](./cli-reference.md#workspace-id-priority).

For one-off commands, pass the workspace explicitly:

```bash
tailor deploy -w <staging-workspace-id>
```

For environments you switch between regularly, create a named profile per environment with the [profile commands](./cli/workspace.md#profile-create) and select it with `--profile` (`-p`) or `TAILOR_PLATFORM_PROFILE`:

```bash
tailor profile create staging -u you@example.com -w <staging-workspace-id>
tailor profile create production -u you@example.com -w <production-workspace-id> --permission read

tailor deploy -p staging
```

Profiles are created with `write` permission by default. The production profile above opts into `--permission read`, which blocks write commands such as `deploy` while the profile is active — a guard against deploying to production by accident. To deploy to production deliberately, pass the workspace explicitly with `-w` without selecting the profile — the guard applies only while a profile is selected via `-p` or `TAILOR_PLATFORM_PROFILE` — or use a separate profile created with `write` permission.

If a profile targets a non-default Tailor Platform API, save that connection on the profile as well. User login tokens are stored per Platform URL, so you can log in once for each Platform and then switch with only the profile:

```bash
export TAILOR_PLATFORM_URL=<platform-api-url>
export TAILOR_PLATFORM_OAUTH2_CLIENT_ID=<oauth2-client-id>
export TAILOR_PLATFORM_CONSOLE_URL=<console-url>

tailor login
tailor profile create development \
  -u you@example.com \
  -w <development-workspace-id> \
  --platform-url "$TAILOR_PLATFORM_URL" \
  --oauth2-client-id "$TAILOR_PLATFORM_OAUTH2_CLIENT_ID" \
  --console-url "$TAILOR_PLATFORM_CONSOLE_URL"

unset TAILOR_PLATFORM_URL TAILOR_PLATFORM_OAUTH2_CLIENT_ID TAILOR_PLATFORM_CONSOLE_URL
tailor deploy -p development
tailor open -p development
```

After the profile exists, run `tailor login -p development` to refresh the login for that Platform without re-exporting the connection variables.

## Varying config values per environment

`tailor.config.ts` is a TypeScript module evaluated locally each time an SDK command loads it, so any value can branch on `process.env`. If the config also defines an auth before-login hook, mind the `process.env` caveat in [Environment Variables](./configuration.md#environment-variables). Keep one env file per environment and load it with the global [`--env-file`](./cli-reference.md#environment-file-loading) option:

```ini
# .env.production
APP_ENV=production
TAILOR_APP_LOG_LEVEL=WARN
```

```bash
tailor deploy -w <production-workspace-id> --env-file .env.production
```

```typescript
export default defineConfig({
  name: "my-app",
  buildOptions: {
    logLevel: process.env.TAILOR_APP_LOG_LEVEL ?? "DEBUG",
  },
});
```

Variables already set in your shell are not overwritten by env files, and later files override earlier ones — see [Environment File Loading](./cli-reference.md#environment-file-loading).

## Passing environment values to application code

`process.env` is only available while the config is evaluated locally; deployed resolvers, executors, workflow jobs, auth hooks, and migration scripts cannot read it. To make a value available at runtime, forward it through `env` in `defineConfig()`:

```typescript
export default defineConfig({
  name: "my-app",
  env: {
    appEnv: process.env.APP_ENV ?? "development",
  },
});
```

See [Environment Variables](./configuration.md#environment-variables) for how `env` values reach each code location. For sensitive values such as API keys, use [Secret Manager](./services/secret.md) instead and supply the per-environment value via `process.env` the same way.

## Settings that belong to a single environment

Some settings reference resources that can exist in only one environment at a time. The static website [customDomains](./services/staticwebsite.md#customdomains) option is an example: a domain is globally unique, so the same `customDomains` value cannot be deployed from two workspaces. Set such values only in the environment that owns the resource:

```typescript
defineStaticWebSite("my-website", {
  customDomains: process.env.APP_ENV === "production" ? ["app.example.com"] : undefined,
});
```

## Seed data per environment and per scenario

`seedPlugin` seeds every environment from the JSONL files in `<distPath>/data/`. Rows that only some environments or scenarios need go into **datasets** — directories under `<distPath>/data/` that hold JSONL files for some of the tables — and are applied on top of the base seed data with `tailor seed apply --dataset <name>`:

```
seed/data/
  *.schema.ts, *.jsonl     # base seed data, applied everywhere
  cogs/Item.jsonl          # scenario: rows only a costing demo needs
  dev/Account.jsonl        # environment: the dev variant of a table
  stg/Account.jsonl        # environment: the staging variant of the same table
  local/_User.jsonl        # per developer, gitignored
```

A table whose rows differ per environment lives only in the per-environment datasets, since a row may be defined in only one of the selected files. Name the combinations each environment uses in the `datasets` option of `seedPlugin`, so a deploy pipeline runs `tailor seed apply --dataset preview` instead of repeating the list:

```typescript
seedPlugin({
  distPath: "./seed",
  datasets: { preview: ["cogs", "dev"] },
});
```

The `tailor seed` commands come from the `@tailor-platform/sdk-plugin-seed` CLI plugin; see its [Datasets](https://github.com/tailor-platform/sdk/tree/main/packages/sdk-plugin-seed#datasets) guide for validating, filling, and dumping datasets.
