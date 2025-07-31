# Tailor SDK Monorepo

This is the monorepo for the Tailor SDK project, containing the core SDK package and examples.

## Repository Structure

```
tailor-sdk/
├── packages/
│   └── tailor-sdk/          # Core SDK package (@tailor-platform/tailor-sdk)
├── examples/
│   └── basic/               # Basic usage example
├── turbo.json               # Turbo configuration
├── pnpm-workspace.yaml      # pnpm workspace configuration
└── CLAUDE.md                # AI assistant instructions
```

## Development Setup

### Prerequisites

- Node.js 22.14.0+
- pnpm 10.8.0+

### Installation

```bash
# Install dependencies for all packages
pnpm install
```

### Development Commands

All commands should be run from the repository root using Turbo:

```bash
# Run all tests
turbo run test

# Run tests in watch mode
turbo run test:watch

# Build all packages
turbo run build

# Run linting
turbo run lint

# Auto-fix linting issues
turbo run lint:fix

# Format code
turbo run format

# Type checking
turbo run typecheck

# Run all checks (format, lint:fix, typecheck)
turbo run check
```

### Package-specific Development

To work on a specific package:

```bash
# Work on the SDK package
cd packages/tailor-sdk
pnpm test
pnpm build

# Work on the basic example
cd examples/basic
pnpm gen        # Generate code
pnpm gen:watch  # Generate in watch mode
pnpm test       # Run example tests
```

## Architecture

### Core SDK (`packages/tailor-sdk`)

The main SDK package that provides:

- TailorDB ORM for database models
- Pipeline system for GraphQL resolvers
- Executor framework for event handling
- Code generator for manifests and types
- CLI tools for project management
- Bundler integration using Rolldown

### Examples (`examples/basic`)

A comprehensive example showing:

- Database model definitions
- GraphQL resolver implementations
- Event-driven executor patterns
- Testing strategies

## Testing

- **Framework**: Vitest with SWC for fast TypeScript transformation
- **Mocking**: vitest-mock-extended for type-safe mocks
- **Test Structure**: Tests are colocated with source files or in `tests/` directories
- **Example Tests**: The basic example includes comprehensive tests with fixtures

## Code Quality

- **Linting**: ESLint with TypeScript support
- **Formatting**: Prettier with consistent code style
- **Type Safety**: Strict TypeScript configuration
- **Pre-commit Hooks**: Lefthook runs lint, format, and typecheck before commits

## Contributing

1. Create a feature branch from `main`
2. Make your changes
3. Ensure all tests pass: `turbo run test`
4. Run checks: `turbo run check`
5. Create a pull request

## Monorepo Management

- **Package Manager**: pnpm with workspace support
- **Build Orchestration**: Turbo for efficient task running
- **Module System**: ESM-only (no CommonJS)
- **Versioning**: Managed at package level

## Release Process

Releases are automated through CI/CD pipelines. Version updates and publishing are handled automatically when changes are merged to the main branch.

## Troubleshooting

- If you encounter module resolution issues, ensure you're using Node.js 22.14.0+
- For pnpm issues, check that you're using version 10.8.0+
- Clear Turbo cache if needed: `turbo daemon clean`
