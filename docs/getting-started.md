# Getting Started

Guide for new SDK contributors.

## Prerequisites

- **Node.js** >= 22.15.0
- **pnpm** (version pinned by `packageManager` in root `package.json`)
- **GPG key** for commit signing (enforced by Lefthook post-commit hook)

## Setup

```bash
git clone https://github.com/tailor-platform/sdk.git
cd sdk
pnpm install
pnpm build
```

## Key Commands

| Command         | Description                                                                |
| --------------- | -------------------------------------------------------------------------- |
| `pnpm build`    | Build all packages                                                         |
| `pnpm test`     | Run all tests                                                              |
| `pnpm check`    | Build, generate, format, and every `check:*` script in root `package.json` |
| `pnpm generate` | Run code generation                                                        |

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

1. **Format** — Check staged files with oxfmt
2. **Build & Generate** — Rebuild the SDK and run code generation
3. **Lint** — Run standard and Vitest-specific oxlint passes, plus create-sdk template lint
4. **Typecheck** — Run tsgo
5. **Knip** — Detect unused dependencies and exports

Steps 2–5 run as a single command, and only when staged files include `.ts`/`.js`.

Post-commit verifies GPG signature.

To customize hooks locally, create `lefthook-local.yml` (gitignored).
