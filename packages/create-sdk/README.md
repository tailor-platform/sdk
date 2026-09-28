# Create Tailor Platform SDK

`@tailor-platform/create-sdk` is a CLI tool to quickly scaffold a new [Tailor Platform SDK](https://www.npmjs.com/package/@tailor-platform/sdk) project.

## Usage

```bash
npm create @tailor-platform/sdk -- [OPTIONS] [NAME]
# OR
yarn create @tailor-platform/sdk [OPTIONS] [NAME]
# OR
pnpm create @tailor-platform/sdk [OPTIONS] [NAME]
# OR
bun create @tailor-platform/sdk [OPTIONS] [NAME]
```

Note: npm 7+ requires `--` before create-sdk options (for example, `--template`).

### Arguments

- `NAME`: (Optional) The name of your new project. If not provided, you'll be prompted to enter one.

### Options

- `--template <template-name>`: (Optional) Specify a template to use for your project. If not provided, you'll be prompted to select one from a list of available templates.

## Available Templates

| Template               | Description                      | Features                                                      |
| ---------------------- | -------------------------------- | ------------------------------------------------------------- |
| `hello-world`          | Minimal starter project          | Simple resolver example                                       |
| `inventory-management` | Full-featured sample application | TailorDB, Resolver, Executor, Permissions                     |
| `multi-application`    | Multi-app architecture           | Shared databases, multiple applications                       |
| `tailordb`             | TailorDB table definitions       | Field types, relations, validations, hooks                    |
| `resolver`             | Resolver patterns                | Query and mutation resolvers, Vitest setup                    |
| `workflow`             | Workflow patterns                | Job chaining, `runWorkflowLocally()` tests                    |
| `executor`             | Executor trigger types           | Record, resolver, IdP, auth token, schedule, webhook triggers |
| `static-web-site`      | Static website with auth         | Static website, IdP, OAuth2 login page                        |
| `generators`           | Built-in generator plugins       | Kysely types, enum constants, file utils, seed                |

### hello-world

A minimal starter project with a single resolver. Best for learning the basics of the SDK.

**Includes:**

- Simple "hello" query resolver
- Basic project configuration

### inventory-management

A complete inventory management system demonstrating real-world patterns.

**Includes:**

- TailorDB tables: User, Product, Category, Order, Inventory, Contact, Notification
- Role-based permissions (Manager, Staff)
- Custom resolver for order registration with inventory updates
- Executor for inventory threshold monitoring
- Machine users for API access

### multi-application

Demonstrates multiple applications sharing databases within a workspace.

**Includes:**

- User application (owns shared database)
- Admin application (references shared database as external)
- Coordinated deployment scripts

### tailordb

Comprehensive TailorDB table definitions demonstrating the features of `db.table()`.

**Includes:**

- All field types, relations, and nested objects
- Field-level and table-level validations
- Hooks, file attachments, and composite indexes
- Role-based permissions
- Vitest setup

### resolver

Resolver patterns with testing approaches for each.

**Includes:**

- Simple query, database query, and database mutation resolvers
- Environment variable, caller, and invoker context access
- Tests using direct `body()` calls, `mockTailordb`, and dependency injection

### workflow

Workflow patterns with job chaining and dependency injection.

**Includes:**

- Workflow with multiple jobs (`createWorkflow`, `createWorkflowJob`)
- Job chaining via `.start()`
- Database operations in workflow jobs
- Approval wait points (`createWaitPoints`) resolved from a resolver
- Integration tests with `runWorkflowLocally()` and E2E tests with `startWorkflow()`

### executor

Demonstrates executor triggers with supporting infrastructure.

**Includes:**

- Record created, updated, and deleted, resolver executed, schedule, and incoming webhook triggers
- IdP user created, updated, and deleted triggers
- Auth access token issued, refreshed, and revoked triggers
- `function` and `workflow` operation kinds
- Vitest setup

### static-web-site

Static website configuration with authentication and identity provider integration.

**Includes:**

- Static website definition (`defineStaticWebSite`)
- Identity provider and auth setup with machine users and OAuth2 clients
- Simple HTML login page with OAuth2 callback handler

### generators

Demonstrates the built-in generator plugins.

**Includes:**

- Kysely type definitions (`kyselyTypePlugin`)
- Enum constants (`enumConstantsPlugin`)
- File upload and download utilities (`fileUtilsPlugin`)
- Seed data templates (`seedPlugin`)
- Vitest setup

## What it does

This tool will:

1. Create a new directory with the specified project name.
2. Scaffold a new Tailor Platform SDK project in that directory using the selected template.
3. Install the necessary dependencies with the package manager being used.
4. Initialize a new Git repository in the project directory.

### Note

- If none of the supported package managers (npm, yarn, pnpm, bun) are found, dependency installation will be skipped.
- If the project already exists within a git repository, git initialization will be skipped.

## Documentation

For complete SDK documentation, see the [SDK documentation](https://github.com/tailor-platform/sdk/blob/main/packages/sdk/docs/quickstart.md).
