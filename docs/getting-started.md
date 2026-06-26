# Getting Started

Guide for new SDK contributors.

## Prerequisites

- **Node.js** >= 22.15.0
- **pnpm** 10.28.0 (see `packageManager` in root `package.json`)
- **GPG key** for commit signing (enforced by Lefthook post-commit hook)

## Setup

```bash
git clone https://github.com/tailor-platform/sdk.git
cd sdk
pnpm install
pnpm build
```

## Key Commands

| Command         | Description                   |
| --------------- | ----------------------------- |
| `pnpm build`    | Build all packages            |
| `pnpm test`     | Run all tests                 |
| `pnpm check`    | Format, lint, typecheck, knip |
| `pnpm generate` | Run code generation           |

In `packages/sdk/`:

| Command                     | Description                    |
| --------------------------- | ------------------------------ |
| `pnpm test`                 | Run all tests                  |
| `pnpm test path/to/test.ts` | Run specific test file         |
| `pnpm test -t "pattern"`    | Run tests matching pattern     |
| `pnpm build`                | Build SDK                      |
| `pnpm docs:check`           | Verify CLI docs match commands |
| `pnpm docs:update`          | Regenerate CLI docs            |

## Example App

`example/` is used for development testing and CI validation.

```bash
cd example
pnpm generate        # Generate types
pnpm deploy          # Deploy to platform (requires workspace)
pnpm test            # Run generator tests
pnpm test:e2e        # Run E2E tests (requires deployed workspace)
```

## Pre-commit Hooks

[Lefthook](https://lefthook.dev/) runs on every commit (see [`lefthook.yml`](../lefthook.yml)):

1. **Build** — Rebuild SDK if `.ts` files changed
2. **Format** — Check formatting with oxfmt
3. **Lint** — Run standard and Vitest-specific oxlint passes, and check public API JSDoc
4. **Typecheck** — Run tsgo
5. **Knip** — Detect unused dependencies and exports

Post-commit verifies GPG signature.

To customize hooks locally, create `lefthook-local.yml` (gitignored).
