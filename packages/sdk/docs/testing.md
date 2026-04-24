# Testing Guide

This guide covers testing patterns for Tailor Platform SDK applications using [Vitest](https://vitest.dev/).

For complete working examples with full test code, use one of the templates that ship with tests:

```bash
# Resolver with tests
npm create @tailor-platform/sdk -- --template resolver <your-project-name>

# Workflow with tests
npm create @tailor-platform/sdk -- --template workflow <your-project-name>

# Executor with tests
npm create @tailor-platform/sdk -- --template executor <your-project-name>
```

## Runtime Environment Emulation (Beta)

The Tailor Platform function runtime only provides Web Standard APIs. Node.js built-in modules like `node:crypto` and globals like `Buffer` are not available. The `tailor-runtime` Vitest environment catches these incompatibilities locally before deployment.

### Setup

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { tailorRuntime } from "@tailor-platform/sdk/vitest";

export default defineConfig({
  plugins: [tailorRuntime()],
  test: {
    environment: "tailor-runtime",
  },
});
```

`tailorRuntime()` provides:

1. **Node.js module blocking** — `import { randomBytes } from "node:crypto"` in production code throws an error with a suggestion for the Web Standard API alternative (`globalThis.crypto`). Test files (`*.test.ts`, `*.spec.ts`) are exempt.
2. **Node.js globals removal** — Only globals available in the platform runtime are kept (whitelist). `Buffer`, `global`, `setImmediate`, `__dirname`, `__filename`, `performance`, and others are removed.
3. **Platform API mocks** — `globalThis.tailordb`, `globalThis.tailor`, `TailorErrors`, `TailorErrorMessage`, `TailorDBFileError` are auto-injected with mock control objects for response configuration and call recording.

### TailorDB Mock

The environment auto-injects a mock `tailordb.Client`. Use `tailordbMock` to configure responses and assert on executed queries:

```typescript
import { tailordbMock } from "@tailor-platform/sdk/vitest";

beforeEach(() => {
  tailordbMock.reset();
});

test("resolver queries the database", async () => {
  // Order-based: each call enqueues one query response
  tailordbMock.enqueueResult(); // BEGIN (empty result)
  tailordbMock.enqueueResult({ age: 30 }); // SELECT (one row)
  tailordbMock.enqueueResult(); // COMMIT

  const result = await resolver.body({ input: { email: "test@example.com" } });

  expect(result).toEqual({ oldAge: 30, newAge: 31 });
  expect(tailordbMock.executedQueries).toHaveLength(3);
  expect(tailordbMock.createdClients).toMatchObject([{ namespace: "tailordb" }]);
});
```

Two response modes:

- **`enqueueResult(...rows)`** — Order-based. Each call enqueues one query response. Arguments are row objects (`enqueueResult()` for empty, `enqueueResult({ id: "1" })` for one row, `enqueueResult({ a: 1 }, { a: 2 })` for multiple rows). Consumed in FIFO order.
- **`setQueryResolver((query, params) => rows)`** — Content-based fallback. Called when the queue is empty.

```typescript
test("content-based mock", async () => {
  tailordbMock.setQueryResolver((query) => {
    if (query.includes("SELECT")) return [{ id: "1", name: "test" }];
    return [];
  });

  const result = await resolver.body({ input: { userId: "1" } });

  expect(tailordbMock.executedQueries[0].query).toContain("SELECT");
});
```

### Workflow Mock

The environment auto-injects `tailor.workflow.triggerJobFunction`. Use `workflowMock` to configure job responses:

```typescript
import { workflowMock } from "@tailor-platform/sdk/vitest";

beforeEach(() => {
  workflowMock.reset();
});

test("workflow triggers jobs", async () => {
  workflowMock.setJobHandler((jobName, args) => {
    if (jobName === "validate-order") return { valid: true };
    if (jobName === "process-payment") return { txnId: "txn-1" };
    return null;
  });

  const result = await main({ input: { orderId: "o-1" } });

  expect(workflowMock.triggeredJobs).toEqual([
    { jobName: "validate-order", args: { orderId: "o-1" } },
    { jobName: "process-payment", args: { orderId: "o-1" } },
  ]);
});
```

`workflowMock` also supports `enqueueResult()`:

```typescript
workflowMock.enqueueResult({ valid: true }, { txnId: "txn-1" });
```

### Per-Project Configuration

Apply the runtime environment only to unit tests while keeping other test projects (bundled, e2e) in the default Node.js environment:

```typescript
export default defineConfig({
  plugins: [tailorRuntime()],
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "tailor-runtime",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "e2e",
          include: ["e2e/**/*.test.ts"],
          globalSetup: "e2e/globalSetup.ts",
        },
      },
    ],
  },
});
```

### Known Limitations

- **`process` and `require`** are not removed or blocked. Vitest's internal runner depends on them extensively. On the real platform runtime, they do not exist.
- **Dynamic `import()`** of bundled files (via `createImportMain()`) bypasses the transform hook since those files are loaded through the Node.js native loader.
- **Platform API mocks return default values** — All platform APIs are mocked with default return values. Use control objects to configure responses:

| Control Object       | API                     | Methods                                                                                               |
| -------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `tailordbMock`       | `tailordb.Client`       | `setQueryResolver`, `enqueueResult`, `executedQueries`, `createdClients`                              |
| `workflowMock`       | `tailor.workflow`       | `setJobHandler`, `enqueueResult`, `triggeredJobs`, `setWorkflowExecutionId`, `setWaitResult`, `calls` |
| `secretmanagerMock`  | `tailor.secretmanager`  | `setSecrets`, `calls`                                                                                 |
| `authconnectionMock` | `tailor.authconnection` | `setTokens`, `calls`                                                                                  |
| `idpMock`            | `tailor.idp`            | `setResolver`, `enqueueResult`, `calls`                                                               |
| `fileMock`           | `tailordb.file`         | `setResolver`, `enqueueResult`, `calls`                                                               |
| `iconvMock`          | `tailor.iconv`          | `setResolver`, `calls`                                                                                |

### SecretManager Mock

```typescript
import { secretmanagerMock } from "@tailor-platform/sdk/vitest";

beforeEach(() => secretmanagerMock.reset());

test("reads secrets from vault", async () => {
  secretmanagerMock.setSecrets({
    "my-vault": { API_KEY: "sk-123", DB_PASS: "secret" },
  });

  const key = await tailor.secretmanager.getSecret("my-vault", "API_KEY");
  expect(key).toBe("sk-123");
  expect(secretmanagerMock.calls).toEqual([
    { method: "getSecret", vault: "my-vault", name: "API_KEY" },
  ]);
});
```

### AuthConnection Mock

```typescript
import { authconnectionMock } from "@tailor-platform/sdk/vitest";

beforeEach(() => authconnectionMock.reset());

test("returns configured token", async () => {
  authconnectionMock.setTokens({
    google: { access_token: "ya29.xxx", expires_in: 3600 },
  });

  const token = await tailor.authconnection.getConnectionToken("google");
  expect(token.access_token).toBe("ya29.xxx");
});
```

When no token is configured for a connection, it returns `{ access_token: "mock-token" }`.

### IDP Mock

```typescript
import { idpMock } from "@tailor-platform/sdk/vitest";

beforeEach(() => idpMock.reset());

test("resolver-based", async () => {
  idpMock.setResolver((method, args) => {
    if (method === "user") return { id: "u-1", name: "alice", disabled: false };
    return null; // falls back to defaults
  });

  const client = new tailor.idp.Client({ namespace: "my-ns" });
  const user = await client.user("u-1");
  expect(user.name).toBe("alice");
});

test("queue-based", async () => {
  idpMock.enqueueResult({ id: "u-1", name: "alice", disabled: false });

  const client = new tailor.idp.Client({ namespace: "my-ns" });
  const user = await client.user("u-1");
  expect(user.name).toBe("alice");
  expect(idpMock.calls).toMatchObject([{ method: "user", namespace: "my-ns" }]);
});
```

### File Mock

```typescript
import { fileMock } from "@tailor-platform/sdk/vitest";

beforeEach(() => fileMock.reset());

test("mock file download", async () => {
  fileMock.enqueueResult({
    data: new Uint8Array([1, 2, 3]),
    metadata: { contentType: "image/png", fileSize: 3, sha256sum: "abc", lastUploadedAt: "" },
  });

  const result = await tailordb.file.download("ns", "Doc", "attachment", "r-1");
  expect(result.data).toEqual(new Uint8Array([1, 2, 3]));
  expect(fileMock.calls).toMatchObject([{ method: "download", recordId: "r-1" }]);
});
```

### Iconv Mock

```typescript
import { iconvMock } from "@tailor-platform/sdk/vitest";

beforeEach(() => iconvMock.reset());

test("mock encoding conversion", () => {
  iconvMock.setResolver((method, args) => {
    if (method === "decode") return "decoded-text";
    return null; // falls back to default empty string
  });

  const result = tailor.iconv.decode(new Uint8Array([0x48, 0x69]), "UTF-8");
  expect(result).toBe("decoded-text");
  expect(iconvMock.calls).toMatchObject([{ method: "decode" }]);
});
```

### Loading Secrets from Config

Pass a config path to load `defineSecretManager()` values into the mock:

```typescript
export default defineConfig({
  plugins: [tailorRuntime({ config: "./tailor.config.ts" })],
  test: { environment: "tailor-runtime" },
});
```

This makes `tailor.secretmanager.getSecret("vault", "key")` return the values defined in your config. You can still override with `secretmanagerMock.setSecrets()` in individual tests.

## Unit Tests

Unit tests verify resolver logic without requiring deployment.

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

> **Note:** If you are using the `tailor-runtime` environment (recommended), `tailordb.Client` is auto-injected. Use `tailordbMock` from `@tailor-platform/sdk/vitest` instead of `vi.stubGlobal()`. See [TailorDB Mock](#tailordb-mock) above.

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

## Workflow Tests

Test workflows locally without deploying to Tailor Platform.

### Job Unit Tests

Test individual job logic by calling `.body()` directly:

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

### Integration Tests with `.trigger()`

Test the full workflow execution using `workflow.mainJob.trigger()`:

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
