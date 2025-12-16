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
```

## Quick Start

Create a new project using the CLI:

```bash
npm create @tailor-platform/sdk my-app --template hello-world
cd my-app
npm run deploy -- --workspace-id <your-workspace-id>
```

See [Available Templates](https://github.com/tailor-platform/sdk/tree/main/packages/create-sdk#available-templates) for more options.

For more details, see the [Quickstart Guide](./docs/quickstart.md).

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

- Node.js 22 or later
- A Tailor Platform account ([request access](https://www.tailor.tech/demo))
