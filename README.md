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
pnpm turbo run build

# Type checking
pnpm typecheck

# Linting
pnpm lint
pnpm lint:fix

# Format code
pnpm format
pnpm format:check

# Run all checks (format, lint:fix, typecheck)
pnpm check
```

## Structure

```
├── packages/
│   ├── tailor-sdk/          # Main Tailor Platform SDK package
│   ├── create-tailor-sdk/   # Project scaffolding CLI
│   └── tailor-proto/        # Protocol buffer definitions
└── example/                 # Development and testing example
```

## Release

Releases are managed by Changesets and automated through CI/CD.

```bash
# Create a changeset for your changes
pnpm changeset
```
