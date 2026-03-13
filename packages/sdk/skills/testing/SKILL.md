---
name: testing
description: Patterns for unit testing resolvers, workflows, and e2e tests in @tailor-platform/sdk projects.
metadata:
  sources:
    - docs/testing.md
---

# Testing Patterns

## Setup

All tests use [Vitest](https://vitest.dev/). Install it as a dev dependency alongside the SDK:

```bash
pnpm add -D vitest
```

For E2E tests, also install a GraphQL client:

```bash
pnpm add -D graphql-request
```

Key test utilities are exported from `@tailor-platform/sdk/test`:

| Export                      | Purpose                                      |
| --------------------------- | -------------------------------------------- |
| `unauthenticatedTailorUser` | Predefined test user for resolver context    |
| `setupTailordbMock`         | Mock `tailordb.Client` globally              |
| `setupWorkflowMock`         | Mock workflow triggers                       |
| `createImportMain`          | Import bundled JS for testing                |
| `WORKFLOW_TEST_ENV_KEY`     | Env variable key for workflow test env stubs |

`unauthenticatedTailorUser` is also available from the main `@tailor-platform/sdk` entry point.

---

## Core Patterns

### 1. Simple Resolver Test

For resolvers with no database dependencies, call `.body()` directly:

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

### 2. Resolver with TailorDB Mock

Mock the global `tailordb.Client` with `vi.stubGlobal()` to control database responses per query call. Each `mockResolvedValueOnce` maps to one `queryObject` call in order.

```typescript
import { unauthenticatedTailorUser } from "@tailor-platform/sdk";

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

  test("increments age", async () => {
    // Import AFTER mocking tailordb
    const { default: resolver } = await import("../src/resolver/incrementUserAge");

    mockQueryObject.mockResolvedValueOnce({}); // BEGIN
    mockQueryObject.mockResolvedValueOnce({ rows: [{ age: 30 }] }); // SELECT
    mockQueryObject.mockResolvedValueOnce({}); // UPDATE
    mockQueryObject.mockResolvedValueOnce({}); // COMMIT

    const result = await resolver.body({
      input: { email: "test@example.com" },
      user: unauthenticatedTailorUser,
    });

    expect(result).toEqual({ oldAge: 30, newAge: 31 });
    expect(mockQueryObject).toHaveBeenCalledTimes(4);
  });
});
```

### 3. Dependency Injection Pattern

Extract database operations into a `DbOperations` interface so business logic can be tested without mocking SQL queries.

**Resolver side:**

```typescript
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
```

**Test side:**

```typescript
import { DbOperations, decrementUserAge } from "../src/resolver/decrementUserAge";

test("decrements age", async () => {
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
```

### 4. Workflow Job Unit Test

Test individual job logic by calling `.body()` directly:

```typescript
import workflow, { addNumbers } from "./workflows/calculation";

test("addNumbers adds two numbers", () => {
  const result = addNumbers.body({ a: 2, b: 3 }, { env: {} });
  expect(result).toBe(5);
});
```

### 5. Workflow with Mocked Dependent Jobs

Mock `.trigger()` on dependent jobs with `vi.spyOn()`:

```typescript
import workflow, { addNumbers, calculate, multiplyNumbers } from "./workflows/calculation";

afterEach(() => {
  vi.restoreAllMocks();
});

test("calculate with mocked dependencies", async () => {
  vi.spyOn(addNumbers, "trigger").mockResolvedValue(5);
  vi.spyOn(multiplyNumbers, "trigger").mockResolvedValue(10);

  const result = await calculate.body({ a: 2, b: 3 }, { env: {} });

  expect(addNumbers.trigger).toHaveBeenCalledWith({ a: 2, b: 3 });
  expect(result).toBe(10);
});
```

### 6. Workflow Integration Test with `.trigger()`

Use `WORKFLOW_TEST_ENV_KEY` to stub environment variables, then call `workflow.mainJob.trigger()` to execute the full job chain:

```typescript
import { WORKFLOW_TEST_ENV_KEY } from "@tailor-platform/sdk/test";
import workflow from "./workflows/calculation";

afterEach(() => {
  vi.unstubAllEnvs();
});

test("full workflow execution", async () => {
  vi.stubEnv(WORKFLOW_TEST_ENV_KEY, JSON.stringify({ NODE_ENV: "test" }));

  const result = await workflow.mainJob.trigger({ a: 3, b: 4 });

  expect(result).toBe(21);
});
```

### 7. E2E Test Setup

E2E tests run against a deployed Tailor Platform application.

**Global setup** (`e2e/globalSetup.ts`):

```typescript
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
  const tokens = await machineUserToken({ name: "admin" });
  project.provide("url", app.url);
  project.provide("token", tokens.accessToken);
}
```

**Test file** (`e2e/resolver.test.ts`):

```typescript
import { GraphQLClient } from "graphql-request";

function createGraphQLClient() {
  const endpoint = new URL("/query", inject("url")).href;
  return new GraphQLClient(endpoint, {
    headers: { Authorization: `Bearer ${inject("token")}` },
    errorPolicy: "all",
  });
}

describe("resolver e2e", () => {
  const client = createGraphQLClient();

  test("query returns expected data", async () => {
    const result = await client.rawRequest(`mutation { ... }`);
    expect(result.errors).toBeUndefined();
  });
});
```

**Vitest config** (`vitest.config.ts`):

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e/**/*.test.ts"],
    globalSetup: ["e2e/globalSetup.ts"],
  },
});
```

---

## Common Mistakes

### HIGH: mockResolvedValueOnce order mismatch

Each call to `mockQueryObject` maps to one database call in sequence. A typical transaction has: BEGIN, SELECT, UPDATE, COMMIT. If your resolver issues queries in a different order or count, the mock responses will be misaligned and tests will pass with wrong data or fail with cryptic errors.

**Fix:** Trace through your resolver's database calls and match each one to a `mockResolvedValueOnce` in the exact order they execute.

### HIGH: Missing WORKFLOW_TEST_ENV_KEY stub

Workflow jobs that access `env` will receive an empty object in tests unless you stub the environment variable. This causes silent failures where `env.API_KEY` is `undefined`.

```typescript
// WRONG - env will be empty
const result = await workflow.mainJob.trigger({ input: "data" });

// CORRECT
vi.stubEnv(WORKFLOW_TEST_ENV_KEY, JSON.stringify({ API_KEY: "test-key" }));
const result = await workflow.mainJob.trigger({ input: "data" });
```

Always call `vi.unstubAllEnvs()` in `afterEach` to clean up.

### HIGH: Importing resolver before mocking tailordb

If you import a resolver module at the top of the file before `vi.stubGlobal("tailordb", ...)` runs, the module may capture the real (undefined) global. Use dynamic `await import()` after the mock is set up.

### MEDIUM: E2E token setup outside globalSetup

Machine user tokens must be obtained in the Vitest `globalSetup` function and provided via `project.provide()`. Attempting to call `machineUserToken()` inside individual test files will fail because the CLI context is only available during setup.

### MEDIUM: Forgetting to reset mocks between tests

Without `mockQueryObject.mockReset()` in `afterEach`, leftover mock responses leak into subsequent tests, causing unpredictable failures.

---

## Cross-References

- **services/resolver** -- resolver mock patterns and `createResolver` API
- **services/workflow** -- workflow test patterns with env stubbing and `createWorkflow` API
