# Testing Guide

This guide covers testing patterns for Tailor Platform SDK applications using [Vitest](https://vitest.dev/).

This project was bootstrapped with [Create Tailor Platform SDK](https://www.npmjs.com/package/@tailor-platform/create-tailor-sdk).

## Quick Start

### Unit Tests

Run unit tests locally without deployment:

```bash
npm run test:unit
```

### End-to-End (E2E) Tests

E2E tests require a deployed application.

#### Local Development

```bash
# 1. Login
npx tailor-sdk login

# 2. Create workspace
npx tailor-sdk workspace create --name <workspace-name> --region <workspace-region>

# 3. Deploy application
export TAILOR_PLATFORM_WORKSPACE_ID=<your-workspace-id>
npm run deploy

# 4. Run E2E tests
npm run test:e2e
```

#### CI/CD (Automated Workspace Lifecycle)

```bash
npx tailor-sdk login
export CI=true
export TAILOR_PLATFORM_WORKSPACE_NAME=<workspace-name>
export TAILOR_PLATFORM_WORKSPACE_REGION=<workspace-region>
npm run test:e2e  # Automatically creates, deploys, tests, and deletes workspace
```

## Testing Patterns

### Unit Tests

Unit tests verify resolver logic without requiring deployment.

#### Simple Resolver Testing

**Example:** [src/resolver/simple.test.ts](src/resolver/simple.test.ts)

Test resolvers by directly calling `resolver.body()` with mock inputs.

**Key points:**

- Use `unauthenticatedTailorUser` for testing logic that doesn't depend on user context
- **Best for:** Calculations, data transformations without database dependencies

#### Mock TailorDB Client

**Example:** [src/resolver/mockTailordb.test.ts](src/resolver/mockTailordb.test.ts)

Mock the global `tailordb.Client` using `vi.stubGlobal()` to simulate database operations and control responses for each query.

**Key points:**

- Control exact database responses (query results, errors)
- Verify database interaction flow (transactions, queries)
- Test transaction rollback scenarios
- **Best for:** Business logic with simple database operations

#### Dependency Injection Pattern

**Example:** [src/resolver/wrapTailordb.test.ts](src/resolver/wrapTailordb.test.ts)

Extract database operations into a `DbOperations` interface, allowing business logic to be tested independently from Kysely implementation.

**Key points:**

- Test business logic independently from Kysely implementation details
- Mock high-level operations instead of low-level SQL queries
- **Best for:** Complex business logic with multiple database operations

### End-to-End (E2E) Tests

E2E tests verify your application works correctly when deployed to Tailor Platform. They test the full stack including GraphQL API, database operations, and authentication.

**Examples:** [e2e/resolver.test.ts](e2e/resolver.test.ts), [e2e/globalSetup.ts](e2e/globalSetup.ts)

#### How It Works

**1. Global Setup** ([e2e/globalSetup.ts](e2e/globalSetup.ts))

Before running tests, `globalSetup` retrieves deployment information:

- Application URL via `tailor-sdk show -f json`
- Machine user access token via `tailor-sdk machineuser token admin -f json`
- Provides credentials to tests via `inject("url")` and `inject("token")`

**2. Test Files** ([e2e/resolver.test.ts](e2e/resolver.test.ts))

Tests create a GraphQL client using injected credentials and send real queries/mutations to the deployed application.

**Key points:**

- Tests run against actual deployed application
- `inject("url")` and `inject("token")` provide deployment credentials automatically
- Machine user authentication enables API access without manual token management
- Verify database persistence and API contracts
- **Best for:** Integration testing, end-to-end API validation

## Available Scripts

| Script         | Description                                  |
| -------------- | -------------------------------------------- |
| `generate`     | Generate TypeScript types from configuration |
| `deploy`       | Deploy application to Tailor Platform        |
| `test:unit`    | Run unit tests locally                       |
| `test:e2e`     | Run E2E tests against deployed application   |
| `format`       | Format code with Prettier                    |
| `format:check` | Check code formatting                        |
| `lint`         | Lint code with ESLint                        |
| `lint:fix`     | Fix linting issues automatically             |
| `typecheck`    | Run TypeScript type checking                 |
