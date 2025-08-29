# Tailor SDK Basic Example

This example demonstrates the core features of the Tailor SDK, including database models, GraphQL resolvers, and event-driven executors.

## Overview

This example implements a simple business application with:

- **Users and Roles**: User management with role-based access
- **Sales Orders**: Order management system
- **Customers and Suppliers**: Contact management
- **File Management**: File upload and storage capabilities

## Project Structure

```
basic/
├── tailor.config.ts      # SDK configuration
├── tailordb/             # Database models
│   ├── user.ts          # User model with roles
│   ├── customer.ts      # Customer model
│   ├── salesOrder.ts    # Sales order model
│   ├── supplier.ts      # Supplier model
│   └── file.ts          # File storage model
├── resolvers/            # GraphQL resolvers
│   └── stepChain/       # Example resolver with multiple steps
├── executors/            # Event handlers
│   ├── userCreated.ts   # Handler for new user creation
│   └── salesOrderCreated.ts # Handler for new sales orders
└── tests/               # Test suite with fixtures
```

## Key Concepts Demonstrated

### 1. Database Models

Models are defined using the `db.type()` API with full TypeScript support:

```typescript
export const user = db.type("User", {
  username: db.string().unique(),
  email: db.string(),
  role: db.uuid().relation({ type: "n-1", toward: { type: role } }),
  ...db.fields.timestamps(),
});
```

### 2. Relations

The example shows various relation types:

- **1-1 relations**: One user can have one setting
- **n-1 relations**: Many users belong to one role

### 3. GraphQL Resolvers

Resolvers use a step-based approach for complex operations:

```typescript
createQueryResolver("stepChain", inputType)
  .fnStep("step1", (context) => {
    // First step logic
  })
  .sqlStep("step2", {
    query: "SELECT * FROM users WHERE ...",
  })
  .returns((context) => context.step2);
```

### 4. Event-Driven Executors

React to database changes with executors:

```typescript
createExecutor("userCreated")
  .on(recordCreatedTrigger(user))
  .executeFunction(async (context) => {
    // Handle new user creation
  });
```

## Running the Example

### Prerequisites

- Ensure you're in the monorepo root
- Run `pnpm install` to install dependencies

### Development

```bash
# Generate code and types
pnpm gen

# Watch mode for development
pnpm gen:watch

# Run tests
pnpm test

# Deploy to Tailor Platform
export TAILOR_TOKEN=your-token
pnpm apply
# Or use tailorctl authentication
```

### Testing

The example includes comprehensive tests:

```bash
# Run all tests
pnpm test

# Update test fixtures
pnpm test:update-expects
```

## Test Structure

Tests verify:

- Code generation output
- Function bundling
- Type definitions
- GraphQL schema generation

Test fixtures are located in `tests/fixtures/` with expected outputs for comparison.

## Integration with SDK

This example uses the local SDK package (`@tailor-platform/tailor-sdk`) through pnpm workspace, making it ideal for:

- Testing SDK changes
- Developing new features
- Understanding SDK capabilities

## Environment Variables

- `TAILOR_TOKEN`: Required for deploying to Tailor Platform (or use tailorctl authentication)
- `PLATFORM_URL`: Optional Tailor Platform API URL (default: https://api.tailor.tech)

## Next Steps

1. Explore the model definitions in `tailordb/`
2. Review the resolver implementation in `resolvers/`
3. Check executor patterns in `executors/`
4. Run tests to see the generated output
5. Deploy to Tailor Platform to see it in action
