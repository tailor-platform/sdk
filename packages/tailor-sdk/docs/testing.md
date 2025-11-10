# Testing Guide

This guide covers testing patterns for Tailor Platform SDK applications using [Vitest](https://vitest.dev/). For a complete working example with full test code, use:

```bash
npm create @tailor-platform/tailor-sdk <your-project-name> --template testing
```

## Unit Tests

Unit tests verify resolver logic without requiring deployment.

### Simple Resolver Testing

Test resolvers by directly calling `resolver.body()` with mock inputs.

```typescript
import { unauthenticatedTailorUser } from "@tailor-platform/tailor-sdk";
import resolver from "../src/resolver/add";

describe("add resolver", () => {
  test("basic functionality", async () => {
    const result = await resolver.body({
      input: { left: 1, right: 2 },
      user: unauthenticatedTailorUser,
    });
    expect(result).toBe(3);
  });
});
```

**Key points:**

- Use `unauthenticatedTailorUser` for testing logic that doesn't depend on user context
- **Best for:** Calculations, data transformations without database dependencies

### Mock TailorDB Client

Mock the global `tailordb.Client` using `vi.stubGlobal()` to simulate database operations and control responses for each query.

```typescript
import { unauthenticatedTailorUser } from "@tailor-platform/tailor-sdk";
import resolver from "../src/resolver/incrementUserAge";

describe("incrementUserAge resolver", () => {
  const mockQueryObject = vi.fn();

  beforeAll(() => {
    vi.stubGlobal("tailordb", {
      Client: vi.fn(
        class {
          connect = vi.fn();
          end = vi.fn();
          queryObject = mockQueryObject;
        },
      ),
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    mockQueryObject.mockReset();
  });

  test("basic functionality", async () => {
    // Mock database responses for each query in sequence
    mockQueryObject.mockResolvedValueOnce({}); // Begin transaction
    mockQueryObject.mockResolvedValueOnce({ rows: [{ age: 30 }] }); // Select
    mockQueryObject.mockResolvedValueOnce({}); // Update
    mockQueryObject.mockResolvedValueOnce({}); // Commit

    const result = await resolver.body({
      input: { email: "test@example.com" },
      user: unauthenticatedTailorUser,
    });

    expect(result).toEqual({ oldAge: 30, newAge: 31 });
    expect(mockQueryObject).toHaveBeenCalledTimes(4);
  });
});
```

**Key points:**

- Control exact database responses (query results, errors)
- Verify database interaction flow (transactions, queries)
- Test transaction rollback scenarios
- **Best for:** Business logic with simple database operations

### Dependency Injection Pattern

Extract database operations into a `DbOperations` interface, allowing business logic to be tested independently from Kysely implementation.

First, structure your resolver to accept database operations:

```typescript
import { createResolver, t } from "@tailor-platform/tailor-sdk";
import { getDB } from "generated/tailordb";

export interface DbOperations {
  transaction: (fn: (ops: DbOperations) => Promise<unknown>) => Promise<void>;
  getUser: (
    email: string,
    forUpdate: boolean,
  ) => Promise<{ email: string; age: number }>;
  updateUser: (user: { email: string; age: number }) => Promise<void>;
}

export async function decrementUserAge(
  email: string,
  dbOperations: DbOperations,
): Promise<{ oldAge: number; newAge: number }> {
  let oldAge: number;
  let newAge: number;

  await dbOperations.transaction(async (ops) => {
    const user = await ops.getUser(email, true);
    oldAge = user.age;
    newAge = user.age - 1;
    await ops.updateUser({ ...user, age: newAge });
  });

  return { oldAge, newAge };
}

export default createResolver({
  name: "decrementUserAge",
  operation: "mutation",
  input: t.type({ email: t.string() }),
  body: async (context) => {
    const db = getDB("tailordb");
    const dbOperations = createDbOperations(db);
    return await decrementUserAge(context.input.email, dbOperations);
  },
  output: t.type({ oldAge: t.number(), newAge: t.number() }),
});
```

Then test by mocking the interface:

```typescript
import {
  DbOperations,
  decrementUserAge,
} from "../src/resolver/decrementUserAge";

describe("decrementUserAge resolver", () => {
  test("basic functionality", async () => {
    // Mock DbOperations implementation
    const dbOperations = {
      transaction: vi.fn(
        async (fn: (ops: DbOperations) => Promise<unknown>) =>
          await fn(dbOperations),
      ),
      getUser: vi
        .fn()
        .mockResolvedValue({ email: "test@example.com", age: 30 }),
      updateUser: vi.fn(),
    } as DbOperations;

    const result = await decrementUserAge("test@example.com", dbOperations);

    expect(result).toEqual({ oldAge: 30, newAge: 29 });
    expect(dbOperations.getUser).toHaveBeenCalledExactlyOnceWith(
      "test@example.com",
      true,
    );
    expect(dbOperations.updateUser).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ age: 29 }),
    );
  });
});
```

**Key points:**

- Test business logic independently from Kysely implementation details
- Mock high-level operations instead of low-level SQL queries
- **Best for:** Complex business logic with multiple database operations

## End-to-End (E2E) Tests

E2E tests verify your application works correctly when deployed to Tailor Platform. They test the full stack including GraphQL API, database operations, and authentication.

### Setting Up E2E Tests

**1. Global Setup**

Create a global setup file that retrieves deployment information before running tests:

```typescript
// e2e/globalSetup.ts
import { execSync } from "node:child_process";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    url: string;
    token: string;
  }
}

function getUrl(): string {
  const result = execSync("pnpm tailor-sdk show -f json");
  return (JSON.parse(result.toString()) as { url: string }).url;
}

function getToken(): string {
  const result = execSync("pnpm tailor-sdk machineuser token admin -f json");
  return (JSON.parse(result.toString()) as { access_token: string })
    .access_token;
}

export function setup(project: TestProject) {
  project.provide("url", getUrl());
  project.provide("token", getToken());
}
```

**2. Test Files**

Create tests that use injected credentials to send real queries to your deployed application:

```typescript
// e2e/resolver.test.ts
import { randomUUID } from "node:crypto";
import { gql, GraphQLClient } from "graphql-request";
import { describe, expect, inject, test } from "vitest";

function createGraphQLClient() {
  const endpoint = new URL("/query", inject("url")).href;
  return new GraphQLClient(endpoint, {
    headers: {
      Authorization: `Bearer ${inject("token")}`,
    },
    errorPolicy: "all",
  });
}

describe("resolver", () => {
  const graphQLClient = createGraphQLClient();

  describe("incrementUserAge", () => {
    const uuid = randomUUID();

    test("prepare data", async () => {
      const query = gql`
        mutation {
          createUser(input: {
            name: "alice"
            email: "alice-${uuid}@example.com"
            age: 30
          }) {
            id
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query);
      expect(result.errors).toBeUndefined();
    });

    test("basic functionality", async () => {
      const query = gql`
        mutation {
          incrementUserAge(email: "alice-${uuid}@example.com") {
            oldAge
            newAge
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query);
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        incrementUserAge: { oldAge: 30, newAge: 31 },
      });
    });
  });
});
```

**3. Vitest Configuration**

Configure Vitest to use the global setup:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e/**/*.test.ts"],
    globalSetup: ["e2e/globalSetup.ts"],
  },
});
```

**Key points:**

- Tests run against actual deployed application
- `inject("url")` and `inject("token")` provide deployment credentials automatically
- Machine user authentication enables API access without manual token management
- Verify database persistence and API contracts
- **Best for:** Integration testing, end-to-end API validation
