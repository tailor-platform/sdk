# Multi-Environment Configuration

A project typically runs in more than one environment — for example, each developer's own workspace, a staging workspace, and a production workspace. The SDK has no separate "environment" concept: an environment is a workspace you deploy to, and all environments share the same `tailor.config.ts`. This guide shows how to switch the deployment target and how to vary configuration values per environment.

The auto-managed `id` in `defineConfig()` identifies the application, not an environment. Keep the same committed `id` when deploying the same config to multiple workspaces; see [Application Settings](./configuration.md#application-settings).

## Selecting the target workspace

Deployment commands resolve the target workspace from, in priority order, the `--workspace-id` (`-w`) option, the `TAILOR_PLATFORM_WORKSPACE_ID` environment variable, and the active profile. See [Workspace ID Priority](./cli-reference.md#workspace-id-priority).

For one-off commands, pass the workspace explicitly:

```bash
tailor-sdk deploy -w <staging-workspace-id>
```

For environments you switch between regularly, create a named profile per environment with the [profile commands](./cli/workspace.md#profile-create) and select it with `--profile` (`-p`) or `TAILOR_PLATFORM_PROFILE`:

```bash
tailor-sdk profile create staging -u you@example.com -w <staging-workspace-id>
tailor-sdk profile create production -u you@example.com -w <production-workspace-id> --permission read

tailor-sdk deploy -p staging
```

Profiles are created with `write` permission by default. The production profile above opts into `--permission read`, which blocks write commands such as `deploy` while the profile is active — a guard against deploying to production by accident. To deploy to production deliberately, pass the workspace explicitly with `-w` without selecting the profile — the guard applies only while a profile is selected via `-p` or `TAILOR_PLATFORM_PROFILE` — or use a separate profile created with `write` permission.

## Varying config values per environment

`tailor.config.ts` is a TypeScript module evaluated locally each time an SDK command loads it, so any value can branch on `process.env`. If the config also defines an auth before-login hook, mind the `process.env` caveat in [Environment Variables](./configuration.md#environment-variables). Keep one env file per environment and load it with the global [`--env-file`](./cli-reference.md#environment-file-loading) option:

```ini
# .env.production
APP_ENV=production
LOG_LEVEL=WARN
```

```bash
tailor-sdk deploy -w <production-workspace-id> --env-file .env.production
```

```typescript
export default defineConfig({
  name: "my-app",
  logLevel: process.env.LOG_LEVEL ?? "DEBUG",
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
