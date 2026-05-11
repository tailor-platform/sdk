# Testing

## Test Projects

Vitest is configured with two projects (see [`packages/sdk/vitest.config.ts`](../packages/sdk/vitest.config.ts)):

- **unit** — Files matching `**/?(*.)+(spec|test).ts` (excludes `e2e/`, `dist/`)
- **e2e** — Files in `e2e/**/*.test.ts` (120-second timeout)

```bash
# All tests
pnpm exec turbo run test

# In packages/sdk/:
pnpm test                      # All (unit + e2e)
pnpm test:unit                 # Unit only
pnpm test:e2e                  # E2E only (requires deployed workspace)
pnpm test path/to/file.test.ts # Single file
pnpm test -t "pattern"         # Pattern match
```

## E2E Tests

E2E tests require a deployed workspace. The `globalSetup` provisions a workspace before tests run.

Located in `packages/sdk/e2e/`. CI runs these in the `deploy.yml` workflow on Linux and Windows (PowerShell + CMD).

## Conventions

### Type Assertions

`toMatchTypeOf` is **deprecated**. Use one of:

- `toEqualTypeOf` — Exact type match
- `toMatchObjectType` — Structural match
- `toExtend` — Subtype check

This is enforced by ESLint (see `eslint.config.js`).

## Documentation Tests

CLI reference docs are auto-generated from command definitions. When adding or modifying CLI commands:

```bash
# Check if docs are in sync
pnpm docs:check

# Regenerate docs
pnpm docs:update
```

## Example App Tests

`example/` has its own test suite used in CI:

```bash
cd example
pnpm test                          # Generator output tests
pnpm test:e2e                      # E2E tests
pnpm test:generator:update-expects # Update test fixtures after intentional changes
```

Generator tests compare output against expected fixtures in `example/tests/fixtures/`. After intentional changes to code generation, update the fixtures with `test:generator:update-expects`.
