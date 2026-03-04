# Resolver Template

Demonstrates all resolver patterns with comprehensive testing approaches.

## Features

- Simple query resolver (pure logic)
- Database query resolver (Kysely with transactions)
- Database mutation resolver (dependency injection pattern)
- Environment variable access
- User context access

## Testing Approaches

1. **Direct `body()` call** - Simple resolvers with `unauthenticatedTailorUser`
2. **Mock `tailordb.Client`** - Database resolvers via `vi.stubGlobal`
3. **Dependency injection** - Extract `DbOperations` interface for testability

## Getting Started

```bash
pnpm install
pnpm generate
pnpm deploy
```

## Testing

```bash
pnpm test
```
