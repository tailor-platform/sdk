# Basic Example

Development and testing example for Tailor Platform SDK.

## Purpose

This example is used for:

- SDK development and local testing
- CI validation (lint, format, typecheck, integration tests)
- Code generation output verification

## Development

```bash
# Generate code and types
pnpm generate

# Watch mode
pnpm generate:watch

# Deploy to Tailor Platform
pnpm apply

# Type checking
pnpm typecheck

# Linting
pnpm lint
pnpm lint:fix
```

## Testing

```bash
# Run generator tests
pnpm test

# Run all tests (generator + e2e)
pnpm test:all

# Run E2E tests only
pnpm test:e2e

# Update test fixtures
pnpm test:generator:update-expects
```

Tests verify code generation output, bundling, and type definitions. Fixtures are in [tests/fixtures/](tests/fixtures/).

## Structure

- [tailordb/](tailordb/) - Database models
- [resolvers/](resolvers/) - GraphQL resolvers
- [executors/](executors/) - Event handlers
- [generated/](generated/) - Generated code
- [tests/](tests/) - Test suite
- [e2e/](e2e/) - E2E tests
