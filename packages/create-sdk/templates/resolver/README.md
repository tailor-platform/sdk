# Resolver Template

Demonstrates all resolver patterns with comprehensive testing approaches.

## Features

- Simple query resolver (pure logic)
- Database query resolver (Kysely with transactions)
- Database mutation resolver (dependency injection pattern)
- Environment variable access
- Caller and invoker context access

## Testing Approaches

1. **Direct `body()` call** - Simple resolvers with explicit `caller` / `invoker` context values
2. **`tailor-runtime` environment + `mockTailordb`** - Database resolvers via `mockTailordb` from `@tailor-platform/sdk/vitest` (no `vi.stubGlobal` needed)
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
