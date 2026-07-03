# Tailor Platform SDK

Monorepo for Tailor Platform SDK development.

## Prerequisites

See [package.json](package.json) for required Node.js and pnpm versions.

## Installation

```bash
pnpm install
```

## Development

```bash
# Run all tests
pnpm test

# Build all packages
pnpm build

# Type checking
pnpm typecheck

# Linting
pnpm lint
pnpm lint:fix

# Format code
pnpm format
pnpm format:check

# Run all checks (build, generate, format, lint, typecheck, knip, publint, JSDoc, agent rules)
pnpm check

# Check CLI documentation matches command definitions
pnpm -C packages/sdk docs:check

# Update CLI documentation from command definitions
pnpm -C packages/sdk docs:update
```

## Structure

```
├── packages/
│   ├── sdk/           # Main Tailor Platform SDK package
│   ├── create-sdk/    # Project scaffolding CLI
│   ├── sdk-codemod/   # Codemod runner for SDK upgrades
│   └── tailor-proto/  # Protocol buffer definitions
└── example/           # Development and testing example
```

## Release

Releases are managed by Changesets and automated through CI/CD.

```bash
# Create a changeset for your changes
pnpm changeset
```
