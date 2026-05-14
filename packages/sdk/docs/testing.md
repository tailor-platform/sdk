# Testing Guide

Tailor Platform SDK applications are tested with [Vitest](https://vitest.dev/) at two layers:

| Layer      | What it exercises                                    | Deployment required |
| ---------- | ---------------------------------------------------- | ------------------- |
| Unit tests | Resolver / workflow job / executor TypeScript source | No                  |
| E2E tests  | Deployed GraphQL API, TailorDB, and workflows        | Yes                 |

Lean on unit tests for the day-to-day feedback loop — they run fast and exercise business logic against real SDK types with no deployment in the loop. Reach for E2E tests to confirm integration against a live platform, where mocked globals can drift from the real GraphQL, TailorDB, and workflow runtime.

Unit-test entrypoints exposed by the SDK:

- `resolver.body({ input, user, env })` — invoke a resolver
- `workflowJob.body(input, { env })` / `workflowJob.trigger(input)` — invoke or chain a workflow job
- `executor.operation.body(args)` — invoke a function-kind executor

Helpers under `@tailor-platform/sdk/test`:

- `unauthenticatedTailorUser` — default `user` value for resolver contexts
- `WORKFLOW_TEST_ENV_KEY` — env key consumed by `.trigger()` when run locally

Platform API mocks under `@tailor-platform/sdk/vitest` (auto-injected by the [`tailor-runtime` Vitest environment](#runtime-environment-emulation-beta) below):

- `tailordbMock` — TailorDB query stubs and call recording
- `workflowMock` — `tailor.workflow` job / wait / resolve mocks
- `secretmanagerMock`, `authconnectionMock`, `idpMock`, `fileMock`, `iconvMock` — corresponding platform API mocks

For tighter alignment with the production runtime — Node.js module blocking, Web-only globals, and platform API mocks — pair the resolver helpers with the [`tailor-runtime` Vitest environment](#runtime-environment-emulation-beta) below.

Three starter templates demonstrate the patterns below in a working project:

- `npm create @tailor-platform/sdk -- --template resolver <name>` — resolvers, TailorDB mocking, and DI
- `npm create @tailor-platform/sdk -- --template executor <name>` — executors with extracted DB helpers
- `npm create @tailor-platform/sdk -- --template workflow <name>` — workflow jobs, wait points, and an E2E suite

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
  // Order-based: stage rows for each upcoming query in one call
  tailordbMock.enqueueResults(
    [], // BEGIN (empty result)
    [{ age: 30 }], // SELECT (one row)
    [], // COMMIT
  );

  const result = await resolver.body({ input: { email: "test@example.com" } });

  expect(result).toEqual({ oldAge: 30, newAge: 31 });
  expect(tailordbMock.executedQueries).toHaveLength(3);
  expect(tailordbMock.createdClients).toMatchObject([{ namespace: "tailordb" }]);
});
```

Three response modes:

- **`enqueueResult(...rows)`** — Order-based, single query. Arguments are the row objects returned by the next `queryObject` call (`enqueueResult()` for empty, `enqueueResult({ id: "1" })` for one row, `enqueueResult({ a: 1 }, { a: 2 })` for multiple rows). Consumed in FIFO order.
- **`enqueueResults(...rowsArrays)`** — Order-based, multiple queries. Each argument is a rows array for one upcoming query. Equivalent to calling `enqueueResult` for each entry but easier to read for transactional sequences.
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

`workflowMock` also supports order-based responses:

```typescript
// Single response for the next triggerJobFunction call
workflowMock.enqueueResult({ valid: true });

// Multiple responses for subsequent calls (FIFO)
workflowMock.enqueueResults({ valid: true }, { txnId: "txn-1" });
```

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

For `openDownloadStream`, enqueue an iterable of `StreamValue` items — `metadata`, one or more `chunk` items, and a terminal `complete`. Raw `Uint8Array` / `ArrayBuffer` chunks are rejected so tests stay aligned with the platform's structured stream contract.

```typescript
test("mock file download stream", async () => {
  fileMock.enqueueResult([
    {
      type: "metadata",
      metadata: { contentType: "image/png", fileSize: 3, sha256sum: "abc" },
    },
    { type: "chunk", data: new Uint8Array([1, 2]), position: 0 },
    { type: "chunk", data: new Uint8Array([3]), position: 2 },
    { type: "complete" },
  ]);

  const stream = await tailordb.file.openDownloadStream("ns", "Doc", "attachment", "r-1");
  const items = [];
  for await (const item of stream) items.push(item);
  expect(items).toHaveLength(4);
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

### Per-Project Configuration

Apply the runtime environment only to unit tests while keeping other test projects (e.g. e2e) in the default Node.js environment:

```typescript
export default defineConfig({
  plugins: [tailorRuntime()],
  test: {
    projects: [
      // `extends: true` is required so each project inherits the root-level
      // `tailorRuntime()` plugin (transform hook + injected setup file).
      // Without it, only the environment name rewrite applies — node:* import
      // blocking and per-test global cleanup will silently not run.
      {
        extends: true,
        test: {
          name: "unit",
          environment: "tailor-runtime",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
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

## Unit Tests

Unit tests call `.body()` (or `.trigger()`) directly on a resolver, workflow job, or executor and stub any platform-provided globals they touch.

### Testing Resolvers

#### Simple resolver

For pure logic with no external dependencies, invoke `.body()` directly:

```typescript
import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import { describe, expect, test } from "vitest";
import resolver from "../src/resolver/add";

describe("add resolver", () => {
  test("adds two numbers", async () => {
    const result = await resolver.body({
      input: { left: 1, right: 2 },
      user: unauthenticatedTailorUser,
      env: {},
    });
    expect(result).toBe(3);
  });
});
```

**Use when:** calculations, data transformations, anything that does not hit the database.

#### Mocking the TailorDB client

Stub the global `tailordb.Client` and queue raw query results in order. Best for resolvers that issue a short, predictable query sequence:

> If you are running with the [`tailor-runtime` Vitest environment](#runtime-environment-emulation-beta), `tailordb.Client` is auto-injected — drive it with `tailordbMock` instead of `vi.stubGlobal()`.

```typescript
import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
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
  afterAll(() => vi.unstubAllGlobals());
  afterEach(() => mockQueryObject.mockReset());

  test("increments age inside a transaction", async () => {
    // BEGIN → SELECT → UPDATE → COMMIT
    mockQueryObject.mockResolvedValueOnce({});
    mockQueryObject.mockResolvedValueOnce({ rows: [{ age: 30 }] });
    mockQueryObject.mockResolvedValueOnce({});
    mockQueryObject.mockResolvedValueOnce({});

    const result = await resolver.body({
      input: { email: "test@example.com" },
      user: unauthenticatedTailorUser,
      env: {},
    });

    expect(result).toEqual({ oldAge: 30, newAge: 31 });
    expect(mockQueryObject).toHaveBeenCalledTimes(4);
  });
});
```

**Use when:** the business logic runs a few fixed queries and you want to assert the exact call sequence.

#### Extracting DB operations (dependency injection)

Once the logic gets more involved, mocking raw SQL calls becomes brittle. Push database access behind a `DbOperations` interface and test the pure function that uses it:

```typescript
// src/resolver/decrementUserAge.ts
import type { Selectable } from "@tailor-platform/sdk/kysely";
import type { Namespace } from "../generated/db";

export interface DbOperations {
  transaction: <T>(fn: (ops: DbOperations) => Promise<T>) => Promise<T>;
  getUser: (email: string, forUpdate: boolean) => Promise<Selectable<Namespace["main-db"]["User"]>>;
  updateUser: (user: Selectable<Namespace["main-db"]["User"]>) => Promise<void>;
}

export async function decrementUserAge(email: string, db: DbOperations) {
  return await db.transaction(async (ops) => {
    const user = await ops.getUser(email, true);
    const oldAge = user.age;
    const newAge = user.age - 1;
    await ops.updateUser({ ...user, age: newAge });
    return { oldAge, newAge };
  });
}
```

The `resolver` template wires this into `createResolver` by implementing a `createDbOperations` helper (backed by Kysely) and passing it to `decrementUserAge`. See `src/resolver/updateUser.ts` in the template for the full file.

```typescript
// src/resolver/decrementUserAge.test.ts
import { describe, expect, test, vi } from "vitest";
import { type DbOperations, decrementUserAge } from "./decrementUserAge";

describe("decrementUserAge", () => {
  test("decrements age", async () => {
    const db = {
      transaction: vi.fn(async (fn: (ops: DbOperations) => Promise<unknown>) => await fn(db)),
      getUser: vi.fn().mockResolvedValue({ email: "test@example.com", age: 30 }),
      updateUser: vi.fn(),
    } as DbOperations;

    const result = await decrementUserAge("test@example.com", db);

    expect(result).toEqual({ oldAge: 30, newAge: 29 });
    expect(db.getUser).toHaveBeenCalledExactlyOnceWith("test@example.com", true);
    expect(db.updateUser).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ age: 29 }));
  });
});
```

**Use when:** multi-step business logic. The tests survive query rewrites because they assert high-level intent, not SQL shape.

#### Resolvers that resume a workflow

Resolvers that call `waitPoint.resolve(...)` delegate to `tailor.workflow.resolve` at runtime. With the `tailor-runtime` environment active, use `workflowMock.setResolveHandler` to drive the user-supplied callback and inspect `workflowMock.resolveCalls`:

```typescript
import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import { workflowMock } from "@tailor-platform/sdk/vitest";
import { beforeEach, describe, expect, test } from "vitest";
import resolver from "./resolveApproval";

describe("resolveApproval resolver", () => {
  beforeEach(() => {
    workflowMock.reset();
  });

  test("resolves approval with approved=true", async () => {
    workflowMock.setResolveHandler((_executionId, _key, callback) => {
      const result = callback({ message: "Please approve order order-1", orderId: "order-1" });
      expect(result).toEqual({ approved: true });
    });

    const result = await resolver.body({
      input: { executionId: "exec-1", approved: true },
      user: unauthenticatedTailorUser,
      env: {},
    });

    expect(result).toEqual({ resolved: true });
    expect(workflowMock.resolveCalls).toEqual([{ executionId: "exec-1", key: "approval" }]);
  });
});
```

`setResolveHandler` receives `(executionId, key, callback)` and decides whether to invoke the callback — that's how you assert the value returned to the suspended job.

### Testing Executors

Function-kind executors expose their handler as `executor.operation.body(args)`. The shape of `args` is determined by the trigger — for example, `recordCreatedTrigger({ type: user })` produces `{ newRecord }` typed against the type's output. GraphQL, webhook, and workflow operation kinds are declarative and don't expose a user-authored body to test.

The `executor` template extracts shared DB access into a helper (`shared.ts`) and tests the helper directly against a mocked `tailordb.Client` (same TailorDB-mocking pattern as the resolver section). Executor handlers themselves stay thin and can be tested by spying on the helper:

```typescript
import { describe, expect, test, vi } from "vitest";
import onUserCreated from "./onUserCreated";
import * as shared from "./shared";

describe("onUserCreated executor", () => {
  test("creates an audit log with the new user's name and email", async () => {
    const createAuditLog = vi.spyOn(shared, "createAuditLog").mockResolvedValue(undefined);

    if (onUserCreated.operation.kind !== "function") {
      throw new Error("expected function operation");
    }
    await onUserCreated.operation.body({
      newRecord: {
        id: "user-1",
        name: "Alice",
        email: "alice@example.com",
        role: "ADMIN",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      },
    });

    expect(createAuditLog).toHaveBeenCalledExactlyOnceWith({
      action: "USER_CREATED",
      entityType: "User",
      entityId: "user-1",
      message: "Admin user created: Alice (alice@example.com)",
    });
  });
});
```

To exercise the full chain (executor → helper → TailorDB), drop the spy and stub the global `tailordb.Client` instead, exactly as shown for resolvers.

### Testing Workflow Jobs

Workflow jobs expose the same `.body()` entrypoint as resolvers, plus `.trigger()` for calling them from another job or a test.

#### Simple job

Call `.body()` with the input and a stub `{ env: {} }`:

```typescript
import { describe, expect, test } from "vitest";
import { validateOrder } from "./order-fulfillment";

describe("validateOrder", () => {
  test("accepts a valid order", () => {
    const result = validateOrder.body({ orderId: "order-1", amount: 100 }, { env: {} });
    expect(result).toEqual({ valid: true, orderId: "order-1" });
  });

  test("rejects a non-positive amount", () => {
    expect(() => validateOrder.body({ orderId: "order-1", amount: 0 }, { env: {} })).toThrow(
      "Order amount must be positive",
    );
  });
});
```

#### Jobs that trigger other jobs

Spy on each dependent job's `.trigger()` to replace it with a deterministic result:

```typescript
import { afterEach, describe, expect, test, vi } from "vitest";
import { fulfillOrder, processPayment, sendConfirmation, validateOrder } from "./order-fulfillment";

describe("fulfillOrder", () => {
  afterEach(() => vi.restoreAllMocks());

  test("chains validate → pay → confirm", async () => {
    vi.spyOn(validateOrder, "trigger").mockResolvedValue({ valid: true, orderId: "order-1" });
    vi.spyOn(processPayment, "trigger").mockResolvedValue({
      transactionId: "txn-order-1",
      amount: 100,
      status: "completed",
    });
    vi.spyOn(sendConfirmation, "trigger").mockResolvedValue({
      orderId: "order-1",
      transactionId: "txn-order-1",
      confirmed: true,
    });

    const result = await fulfillOrder.body({ orderId: "order-1", amount: 100 }, { env: {} });

    expect(validateOrder.trigger).toHaveBeenCalledWith({ orderId: "order-1", amount: 100 });
    expect(result).toMatchObject({ confirmed: true, paymentStatus: "completed" });
  });
});
```

**Use when:** you want to isolate the orchestrating job from its dependencies.

#### Jobs that wait on approval

`.wait()` calls delegate to `tailor.workflow.wait`. With the `tailor-runtime` environment active, use `workflowMock.setWaitHandler` to drive each branch and inspect `workflowMock.waitCalls`:

```typescript
import { workflowMock } from "@tailor-platform/sdk/vitest";
import { beforeEach, describe, expect, test } from "vitest";
import { processWithApproval } from "./approval";

describe("processWithApproval", () => {
  beforeEach(() => {
    workflowMock.reset();
  });

  test("returns approved status when .wait() resolves positively", async () => {
    workflowMock.setWaitHandler({ approved: true });

    const result = await processWithApproval.body({ orderId: "order-1" }, { env: {} });

    expect(result).toEqual({ orderId: "order-1", status: "approved" });
    expect(workflowMock.waitCalls[0]).toEqual({
      key: "approval",
      payload: { message: "Please approve order order-1", orderId: "order-1" },
    });
  });

  test("returns rejected status when .wait() resolves negatively", async () => {
    workflowMock.setWaitHandler({ approved: false });

    const result = await processWithApproval.body({ orderId: "order-2" }, { env: {} });

    expect(result.status).toBe("rejected");
  });
});
```

`setWaitHandler` accepts a static value (returned from every `.wait()` call) or a function `(key, payload) => unknown` to compute one per call. `waitCalls` captures the `key` and `payload` passed in.

#### Running a full workflow locally

To exercise the full chain without any mocking, call `workflow.mainJob.trigger()`. Dependent jobs run their real `.body()` functions. Set `WORKFLOW_TEST_ENV_KEY` first so triggered jobs see the workflow env:

```typescript
import { WORKFLOW_TEST_ENV_KEY } from "@tailor-platform/sdk/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import workflow from "./order-fulfillment";

describe("order-fulfillment workflow", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("mainJob.trigger() executes all jobs", async () => {
    vi.stubEnv(WORKFLOW_TEST_ENV_KEY, JSON.stringify({}));

    const result = await workflow.mainJob.trigger({ orderId: "order-3", amount: 300 });

    expect(result).toMatchObject({ confirmed: true, paymentStatus: "completed" });
  });
});
```

**Use when:** you want to verify orchestration end to end without the cost of a real deployment.

## End-to-End (E2E) Tests

E2E tests run against a deployed Tailor Platform application. They exercise the full stack — GraphQL, TailorDB, auth, workflows — end to end.

The `workflow` template ships a complete `e2e/` directory (`globalSetup.ts`, `workflow.test.ts`, `resolver.test.ts`) that you can copy.

### Install a GraphQL client

```bash
pnpm add -D graphql-request
```

### Global setup

Resolve the deployed URL and a machine-user token, and expose them to tests via `inject`:

```typescript
// e2e/globalSetup.ts
import { getMachineUserToken, show } from "@tailor-platform/sdk/cli";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    url: string;
    token: string;
  }
}

export async function setup(project: TestProject) {
  const app = await show();
  const tokens = await getMachineUserToken({ name: "admin" });
  project.provide("url", app.url);
  project.provide("token", tokens.accessToken);
}
```

### Resolver E2E test

```typescript
// e2e/resolver.test.ts
import { randomUUID } from "node:crypto";
import { gql, GraphQLClient } from "graphql-request";
import { describe, expect, inject, test } from "vitest";

function createGraphQLClient() {
  return new GraphQLClient(new URL("/query", inject("url")).href, {
    headers: { Authorization: `Bearer ${inject("token")}` },
    errorPolicy: "all",
  });
}

describe("incrementUserAge", () => {
  const client = createGraphQLClient();
  const email = `alice-${randomUUID()}@example.com`;

  test("prepares the user", async () => {
    const res = await client.rawRequest(
      gql`
        mutation ($input: UserCreateInput!) {
          createUser(input: $input) {
            id
          }
        }
      `,
      { input: { name: "alice", email, age: 30 } },
    );
    expect(res.errors).toBeUndefined();
  });

  test("increments the user's age", async () => {
    const res = await client.rawRequest(
      gql`
        mutation ($email: String!) {
          incrementUserAge(email: $email) {
            oldAge
            newAge
          }
        }
      `,
      { email },
    );
    expect(res.errors).toBeUndefined();
    expect(res.data).toEqual({ incrementUserAge: { oldAge: 30, newAge: 31 } });
  });
});
```

### Workflow E2E test

Use `startWorkflow` from the CLI helpers. It starts the workflow on the deployed platform and returns an `executionId` plus a `wait()` that blocks until the run completes:

```typescript
// e2e/workflow.test.ts
import { randomUUID } from "node:crypto";
import { startWorkflow } from "@tailor-platform/sdk/cli";
import { describe, expect, test } from "vitest";
import config from "../tailor.config";
import userProfileSync from "../src/workflow/sync-profile";

describe("user-profile-sync workflow", () => {
  test("executes end to end", { timeout: 180_000 }, async () => {
    const { executionId, wait } = await startWorkflow({
      workflow: userProfileSync,
      authInvoker: config.auth.invoker("admin"),
      arg: {
        name: "workflow-test",
        email: `wf-${randomUUID()}@example.com`,
        age: 25,
      },
    });
    console.log(`execution id: ${executionId}`);

    const result = await wait();
    expect(result).toMatchObject({
      workflowName: "user-profile-sync",
      status: "SUCCESS",
    });
  });
});
```

**Use when:** verifying actual deployments, auth flows, schema migrations, and anything that depends on runtime platform behavior you cannot mock.
