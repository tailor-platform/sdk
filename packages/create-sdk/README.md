# Create Tailor Platform SDK

`@tailor-platform/create-sdk` is a CLI tool to quickly scaffold a new [Tailor Platform SDK](https://www.npmjs.com/package/@tailor-platform/sdk) project.

## Usage

```bash
npm create @tailor-platform/sdk [OPTIONS] [NAME]
# OR
yarn create @tailor-platform/sdk [OPTIONS] [NAME]
# OR
pnpm create @tailor-platform/sdk [OPTIONS] [NAME]
```

### Arguments

- `NAME`: (Optional) The name of your new project. If not provided, you'll be prompted to enter one.

### Options

- `--template <template-name>`: (Optional) Specify a template to use for your project. If not provided, you'll be prompted to select one from a list of available templates.

## Available Templates

| Template               | Description                      | Features                                  |
| ---------------------- | -------------------------------- | ----------------------------------------- |
| `hello-world`          | Minimal starter project          | Simple resolver example                   |
| `inventory-management` | Full-featured sample application | TailorDB, Resolver, Executor, Permissions |
| `testing`              | Testing patterns guide           | Unit tests, E2E tests, Vitest setup       |
| `multi-application`    | Multi-app architecture           | Shared databases, multiple applications   |

### hello-world

A minimal starter project with a single resolver. Best for learning the basics of the SDK.

**Includes:**

- Simple "hello" query resolver
- Basic project configuration

### inventory-management

A complete inventory management system demonstrating real-world patterns.

**Includes:**

- TailorDB types: User, Product, Category, Order, Inventory, Contact, Notification
- Role-based permissions (Manager, Staff)
- Custom resolver for order registration with inventory updates
- Executor for inventory threshold monitoring
- Machine users for API access

### testing

A comprehensive guide to testing patterns with Vitest.

**Includes:**

- Unit test examples (simple resolver, mock TailorDB, dependency injection)
- E2E test setup with deployed application
- CI/CD integration patterns
- Global setup for test credentials

### multi-application

Demonstrates multiple applications sharing databases within a workspace.

**Includes:**

- User application (owns shared database)
- Admin application (references shared database as external)
- Coordinated deployment scripts

## What it does

This tool will:

1. Create a new directory with the specified project name.
2. Scaffold a new Tailor Platform SDK project in that directory using the selected template.
3. Install the necessary dependencies with the package manager being used.
4. Initialize a new Git repository in the project directory.

### Note

- If none of the supported package managers (npm, yarn, pnpm) are found, dependency installation will be skipped.
- If the project already exists within a git repository, git initialization will be skipped.

## Documentation

For complete SDK documentation, see the [SDK documentation](https://github.com/tailor-platform/sdk/blob/main/packages/sdk/docs/quickstart.md).
