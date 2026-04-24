# Testing Guide

This guide covers testing patterns for Tailor Platform SDK applications using [Vitest](https://vitest.dev/).

For a complete working example with full test code, use the `testing` template:

```bash
npm create @tailor-platform/sdk -- --template testing <your-project-name>
```

## Unit Tests

Unit tests verify resolver and workflow logic locally without requiring deployment.

### Simple Resolver Testing

Test resolvers by directly calling `resolver.body()` with mock inputs.

```typescript
import { unauthenticatedTailorUser } from "@tailor-platform/sdk";
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
import { unauthenticatedTailorUser } from "@tailor-platform/sdk";
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
import { createResolver, t } from "@tailor-platform/sdk";
import { getDB } from "generated/tailordb";

export interface DbOperations {
  transaction: (fn: (ops: DbOperations) => Promise<unknown>) => Promise<void>;
  getUser: (email: string, forUpdate: boolean) => Promise<{ email: string; age: number }>;
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
  input: { email: t.string() },
  body: async (context) => {
    const db = getDB("tailordb");
    const dbOperations = createDbOperations(db);
    return await decrementUserAge(context.input.email, dbOperations);
  },
  output: t.object({ oldAge: t.number(), newAge: t.number() }),
});
```

Then test by mocking the interface:

```typescript
import { DbOperations, decrementUserAge } from "../src/resolver/decrementUserAge";

describe("decrementUserAge resolver", () => {
  test("basic functionality", async () => {
    // Mock DbOperations implementation
    const dbOperations = {
      transaction: vi.fn(
        async (fn: (ops: DbOperations) => Promise<unknown>) => await fn(dbOperations),
      ),
      getUser: vi.fn().mockResolvedValue({ email: "test@example.com", age: 30 }),
      updateUser: vi.fn(),
    } as DbOperations;

    const result = await decrementUserAge("test@example.com", dbOperations);

    expect(result).toEqual({ oldAge: 30, newAge: 29 });
    expect(dbOperations.getUser).toHaveBeenCalledExactlyOnceWith("test@example.com", true);
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

### Testing Resolvers that Call `.resolve()`

Use `setupWaitPointMock` to mock `tailor.workflow.resolve` when testing resolvers that resume a suspended workflow execution.

```typescript
import { afterEach } from "vitest";
import { setupWaitPointMock, unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import resolver from "./resolvers/resolveApproval";

const TailorGlobal = globalThis as { tailor?: { workflow?: Record<string, unknown> } };

describe("resolveApproval resolver", () => {
  afterEach(() => {
    delete TailorGlobal.tailor;
  });

  test("resolves approval", async () => {
    const { resolveCalls } = setupWaitPointMock({
      onResolve: (_execId, _key, callback) => {
        const result = callback({ message: "Please approve", orderId: "order-1" });
        expect(result).toEqual({ approved: true });
      },
    });

    const result = await resolver.body({
      input: { executionId: "exec-1", approved: true },
      user: unauthenticatedTailorUser,
      env: {},
    });

    expect(result).toEqual({ resolved: true });
    expect(resolveCalls).toHaveLength(1);
    expect(resolveCalls[0]).toEqual({ executionId: "exec-1", key: "approval" });
  });
});
```

**Key points:**

- `onResolve` lets you verify the callback behavior in resolvers that call `.resolve()`
- Clean up mocks in `afterEach` by deleting `TailorGlobal.tailor`
- **Best for:** Resolvers that resume suspended workflow executions

### Workflow Job Unit Tests

Test individual workflow job logic locally without deploying. Call `.body()` directly:

```typescript
import workflow, { addNumbers, calculate } from "./workflows/calculation";

describe("workflow jobs", () => {
  test("addNumbers.body() adds two numbers", () => {
    const result = addNumbers.body({ a: 2, b: 3 }, { env: {} });
    expect(result).toBe(5);
  });
});
```

### Mocking Dependent Jobs

For jobs that trigger other jobs, mock the dependencies using `vi.spyOn()`:

```typescript
import { afterEach, vi } from "vitest";
import workflow, { addNumbers, calculate, multiplyNumbers } from "./workflows/calculation";

describe("workflow with dependencies", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("calculate.body() with mocked dependent jobs", async () => {
    // Mock the trigger methods for dependent jobs
    vi.spyOn(addNumbers, "trigger").mockResolvedValue(5);
    vi.spyOn(multiplyNumbers, "trigger").mockResolvedValue(10);

    const result = await calculate.body({ a: 2, b: 3 }, { env: {} });

    expect(addNumbers.trigger).toHaveBeenCalledWith({ a: 2, b: 3 });
    expect(result).toBe(10);
  });
});
```

**Note:** To execute dependent jobs without mocking, and they require `env`, use `vi.stubEnv(WORKFLOW_TEST_ENV_KEY, ...)` and call `.trigger()` directly as shown in the integration test section below.

### Workflow Integration Tests with `.trigger()`

Test the full workflow execution locally using `workflow.mainJob.trigger()`:

```typescript
import { WORKFLOW_TEST_ENV_KEY } from "@tailor-platform/sdk/test";
import { afterEach, vi } from "vitest";
import workflow from "./workflows/calculation";

describe("workflow integration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("workflow.mainJob.trigger() executes all jobs", async () => {
    // Set environment variables for the workflow
    vi.stubEnv(WORKFLOW_TEST_ENV_KEY, JSON.stringify({ NODE_ENV: "test" }));

    // No mocking - all jobs execute their actual body functions
    const result = await workflow.mainJob.trigger({ a: 3, b: 4 });

    expect(result).toBe(21); // (3 + 4) * 3 = 21
  });
});
```

**Key points:**

- Use `.body()` for unit testing individual job logic
- Use `vi.spyOn(job, "trigger").mockResolvedValue(...)` to mock dependent jobs when they don't need `env`
- If dependent jobs require `env`, use `vi.stubEnv(WORKFLOW_TEST_ENV_KEY, ...)` and call `.trigger()` instead of mocking
- Use `workflow.mainJob.trigger()` to execute the full workflow chain and get the result
- **Best for:** Testing workflow orchestration and job dependencies

### Testing Jobs with Wait Points

Use `setupWaitPointMock` to mock `tailor.workflow.wait` when testing jobs that suspend on wait points:

```typescript
import { afterEach, vi } from "vitest";
import { setupWaitPointMock } from "@tailor-platform/sdk/test";
import { processWithApproval } from "./workflows/approval";

const TailorGlobal = globalThis as { tailor?: { workflow?: Record<string, unknown> } };

describe("approval workflow", () => {
  afterEach(() => {
    delete TailorGlobal.tailor;
  });

  test("approved flow returns approved status", async () => {
    const { waitCalls } = setupWaitPointMock({
      onWait: (_key, _payload) => ({ approved: true }),
    });

    const result = await processWithApproval.body({ orderId: "order-1" }, { env: {} });

    expect(result).toEqual({ orderId: "order-1", status: "approved" });
    expect(waitCalls).toHaveLength(1);
    expect(waitCalls[0]).toEqual({
      key: "approval",
      payload: { message: "Please approve order order-1", orderId: "order-1" },
    });
  });

  test("rejected flow returns rejected status", async () => {
    setupWaitPointMock({
      onWait: () => ({ approved: false }),
    });

    const result = await processWithApproval.body({ orderId: "order-2" }, { env: {} });

    expect(result).toEqual({ orderId: "order-2", status: "rejected" });
  });
});
```

**Key points:**

- `onWait` controls what `.wait()` returns — use it to test different branches (approved/rejected)
- Clean up mocks in `afterEach` by deleting `TailorGlobal.tailor`
- **Best for:** Jobs that suspend on wait points for human-in-the-loop approval

## End-to-End (E2E) Tests

E2E tests verify your application works correctly when deployed to Tailor Platform. They test the full stack including GraphQL API, database operations, and authentication.

### Setting Up E2E Tests

The examples below use `graphql-request` as a lightweight GraphQL client.

```bash
pnpm add -D graphql-request
```

**1. Global Setup**

Create a global setup file that retrieves deployment information before running tests:

```typescript
// e2e/globalSetup.ts
import { machineUserToken, show } from "@tailor-platform/sdk/cli";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    url: string;
    token: string;
  }
}

export async function setup(project: TestProject) {
  const app = await show();
  const tokens = await machineUserToken({
    name: "admin",
  });
  project.provide("url", app.url);
  project.provide("token", tokens.accessToken);
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
