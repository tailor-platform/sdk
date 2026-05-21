# Tailor Platform SDK

`@tailor-platform/sdk` is a TypeScript SDK for building applications on the [Tailor Platform](https://docs.tailor.tech/).

## Overview

Tailor Platform is a headless business platform that provides backend services for building enterprise applications. The SDK enables you to:

- Define type-safe database schemas with TailorDB
- Create custom GraphQL resolvers with business logic
- Set up event-driven executors for automation
- Orchestrate complex workflows with multiple jobs
- Configure authentication and authorization

All configurations are written in TypeScript, providing full type safety.

### Important Notes

Some SDK concepts differ from the native Tailor Platform. Be aware of these differences when referring to the official Tailor Platform documentation.

#### Resolver

The SDK's Resolver corresponds to Tailor Platform's [Pipeline Resolver](https://docs.tailor.tech/guides/pipeline). The key difference is that Pipeline steps are replaced with a single `body` function. See [Resolver](./docs/services/resolver.md) for details.

## Installation

```bash
npm install @tailor-platform/sdk
# OR
yarn add @tailor-platform/sdk
# OR
pnpm add @tailor-platform/sdk
# OR
bun add @tailor-platform/sdk
```

## Quick Start

Create a new project using the CLI:

```bash
npm create @tailor-platform/sdk -- --template hello-world my-app
cd my-app
npm run deploy -- --workspace-id <your-workspace-id>
```

See [Available Templates](https://github.com/tailor-platform/sdk/tree/main/packages/create-sdk#available-templates) for more options.

For more details, see the [Quickstart Guide](./docs/quickstart.md).

## Agent Skill

Install the `tailor-sdk` skill from the locally installed SDK package:

```bash
npx tailor-sdk skills install

# Example: install to Codex in non-interactive mode
npx tailor-sdk skills install -a codex -y
```

This uses the `skills` CLI under the hood, sourcing the skill from
`node_modules/@tailor-platform/sdk/agent-skills` so the skill version always matches
the installed SDK version. Files are copied (not symlinked) so they survive
`pnpm install` wiping `node_modules`.

## Learn More

### Configuration

- [Configuration](./docs/configuration.md) - Application and service configuration

### Services

| Service                                            | Description                                  |
| -------------------------------------------------- | -------------------------------------------- |
| [TailorDB](./docs/services/tailordb.md)            | Type-safe database schema definition         |
| [Resolver](./docs/services/resolver.md)            | Custom GraphQL resolvers with business logic |
| [Executor](./docs/services/executor.md)            | Event-driven handlers for automation         |
| [Workflow](./docs/services/workflow.md)            | Job orchestration for complex operations     |
| [Auth](./docs/services/auth.md)                    | Authentication and authorization             |
| [IdP](./docs/services/idp.md)                      | Built-in identity provider                   |
| [Static Website](./docs/services/staticwebsite.md) | Static file hosting                          |
| [Secret Manager](./docs/services/secret.md)        | Secure credential storage                    |

### Guides

- [Testing Guide](./docs/testing.md) - Unit and E2E testing patterns
- [CLI Reference](./docs/cli-reference.md) - Command-line interface documentation

### Templates

See [Create Tailor Platform SDK](https://github.com/tailor-platform/sdk/tree/main/packages/create-sdk) for available project templates.

## Requirements

- Node.js 22 or later (or Bun)
- A Tailor Platform account ([request access](https://www.tailor.tech/demo))

## Dependabot Noise

Installing `@tailor-platform/sdk` pulls in a few transitive advisories that are **not exploitable in practice**. They are listed here so you can triage reports from `npm audit` / `pnpm audit` / Dependabot without diffing our lockfile.

### valibot ReDoS ([GHSA-vqpr-j7v3-hqw9](https://github.com/advisories/GHSA-vqpr-j7v3-hqw9))

- **Why it shows up**: `@liam-hq/cli@0.7.24` pins `valibot@1.1.0`, which falls in the vulnerable range (`< 1.2.0`).
- **Why it's safe here**: `@liam-hq/cli` is invoked only by `tailor-sdk tailordb erd export` as a child process, against developer-controlled schema files. The vulnerable code path (`v.emoji()` on attacker-controlled strings) is never reached.
- **If you want to silence it**: add an override to your project so `valibot` resolves to `>=1.2.0`. `@toiroakr/lines-db` declares `valibot` as an optional peer with range `>=1.0.0`, so forcing `1.2.0+` is safe.

  ```jsonc
  // pnpm (package.json)
  "pnpm": { "overrides": { "valibot": ">=1.2.0" } }

  // npm (package.json)
  "overrides": { "valibot": ">=1.2.0" }

  // yarn (package.json)
  "resolutions": { "valibot": ">=1.2.0" }
  ```

  This fix has to live in your project's `package.json` — overrides in a published package do not propagate to consumers.
