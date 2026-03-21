# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

[!IMPORTANT] Read CLAUDE.local.md if exists.

## Commands

### Development

- `pnpm build` - Build all packages
- `pnpm test` - Run all tests
- `pnpm check` - Run format, lint:fix, typecheck:go, knip, and publint in sequence
- `pnpm exec vp run -r generate` - Run code generation
- `pnpm exec vp run -r apply` - Deploy to the Tailor Platform

### Package-specific (in packages/sdk)

- `pnpm test` / `pnpm test path/to/test.ts` / `pnpm test -t "pattern"` - Run tests with vite-plus (Vitest)
- `pnpm build` - Build SDK
- `pnpm docs:check` / `pnpm docs:update` - Check/update CLI documentation

### CLI

See [packages/sdk/docs/cli-reference.md](packages/sdk/docs/cli-reference.md) for the full CLI reference.

## Code Patterns

Refer to `example/` for working implementations of all patterns (config, models, resolvers, executors, workflows).

Key files:

- `example/tailor.config.ts` - Configuration with defineConfig, defineAuth, defineIdp, defineStaticWebSite, defineGenerators
- `example/tailordb/*.ts` - Model definitions with `db.type()`
- `example/resolvers/*.ts` - Resolver implementations with `createResolver`
- `example/executors/*.ts` - Executor implementations with `createExecutor`
- `example/workflows/*.ts` - Workflow implementations with `createWorkflow` / `createWorkflowJob`

## Non-obvious Rules and Gotchas

### Workflows

- `createWorkflow()` result **must** be default exported
- All jobs **must** be named exports (including mainJob and triggered jobs)
- Job names must be unique across the entire project
- `.trigger()` returns a `Promise` — always use `await` to get the result
- On the server, the calling job suspends until the triggered job completes (synchronous execution), but the TypeScript API is `Promise`-based

### Executors

Available triggers beyond record CRUD (`recordCreatedTrigger`, `recordUpdatedTrigger`, `recordDeletedTrigger`):

- `resolverExecutedTrigger` - Resolver execution
- `idpUserCreatedTrigger` / `idpUserUpdatedTrigger` / `idpUserDeletedTrigger` - IdP user events
- `authAccessTokenIssuedTrigger` / `authAccessTokenRefreshedTrigger` / `authAccessTokenRevokedTrigger` - Auth token events
- `scheduleTrigger` - CRON schedule
- `incomingWebhookTrigger` - Webhook

### Generators

`defineGenerators()` takes tuples as rest arguments (see `example/tailor.config.ts`). `@tailor-platform/kysely-type` is required for `getDB()` in resolvers/executors/workflows. Requires `@tailor-platform/function-types` as devDependency.

### Configuration

- `definePlugins()` is available for reusable type/resolver/executor generation
- Static website `.url` property is resolved at deployment time — use it in CORS and redirect URIs

## Developer Guides

See [docs/](docs/README.md) for developer and contributor documentation.

- [Getting Started](docs/getting-started.md) - Prerequisites, setup, key commands
- [Architecture](docs/architecture.md) - Design decisions and non-obvious patterns
- [Testing](docs/testing.md) - Test strategy and conventions
- [Changeset Conventions](docs/changeset.md) - Version bump level guidelines
- [Telemetry / Performance Profiling](docs/telemetry.md) - OTLP tracing for CLI performance analysis

## Platform Documentation

- Use `/docs-check` to search https://docs.tailor.tech/ when you need platform-side specs that the codebase doesn't cover

## Environment

- Linting runs oxlint (via `vp lint`) first, then ESLint
- Lefthook runs pre-commit checks (lint, format, typecheck) and post-commit signature verification
