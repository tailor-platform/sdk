# Testing Guide

Tailor Platform SDK applications are tested with [Vitest](https://vitest.dev/) at two layers:

| Layer      | What it exercises                                    | Deployment required |
| ---------- | ---------------------------------------------------- | ------------------- |
| Unit tests | Resolver / workflow job / executor TypeScript source | No                  |
| E2E tests  | Deployed GraphQL API, TailorDB, and workflows        | Yes                 |

Lean on unit tests for the day-to-day feedback loop — they exercise business logic against real SDK types in milliseconds, with no deployment in the loop. Reach for E2E tests to confirm integration against a live platform, where mocked globals can drift from the real GraphQL, TailorDB, and workflow runtime.

Unit-test entrypoints exposed by the SDK:

- `resolver.body({ input, user, env })` — invoke a resolver
- `workflowJob.body(input, { env })` / `workflowJob.trigger(input)` — invoke or chain a workflow job
- `executor.operation.body(args)` — invoke a function-kind executor

Helpers under `@tailor-platform/sdk/test`:

- `unauthenticatedTailorUser` — default `user` value for resolver contexts
- `setupWaitPointMock({ onWait?, onResolve? })` — stubs `globalThis.tailor.workflow.wait` / `.resolve`
- `WORKFLOW_TEST_ENV_KEY` — env key consumed by `.trigger()` when run locally

Three starter templates demonstrate the patterns below in a working project:

- `npm create @tailor-platform/sdk -- --template resolver <name>` — resolvers, TailorDB mocking, and DI
- `npm create @tailor-platform/sdk -- --template executor <name>` — executors with extracted DB helpers
- `npm create @tailor-platform/sdk -- --template workflow <name>` — workflow jobs, wait points, and an E2E suite

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

Resolvers that call `waitPoint.resolve(...)` delegate to `tailor.workflow.resolve` at runtime. Use `setupWaitPointMock` to supply an `onResolve` handler and inspect the recorded calls:

```typescript
import { setupWaitPointMock, unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import { afterEach, describe, expect, test } from "vitest";
import resolver from "./resolveApproval";

const TailorGlobal = globalThis as { tailor?: { workflow?: Record<string, unknown> } };

describe("resolveApproval resolver", () => {
  afterEach(() => {
    delete TailorGlobal.tailor;
  });

  test("resolves approval with approved=true", async () => {
    const { resolveCalls } = setupWaitPointMock({
      onResolve: (_executionId, _key, callback) => {
        const result = callback({ message: "Please approve order order-1", orderId: "order-1" });
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

`onResolve` lets you assert the callback behavior (the value passed back to the suspended job). Clean `globalThis.tailor` in `afterEach` so tests stay isolated.

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

`.wait()` calls delegate to `tailor.workflow.wait`. Use `setupWaitPointMock` with `onWait` to drive each branch:

```typescript
import { setupWaitPointMock } from "@tailor-platform/sdk/test";
import { afterEach, describe, expect, test } from "vitest";
import { processWithApproval } from "./approval";

const TailorGlobal = globalThis as { tailor?: { workflow?: Record<string, unknown> } };

describe("processWithApproval", () => {
  afterEach(() => {
    delete TailorGlobal.tailor;
  });

  test("returns approved status when .wait() resolves positively", async () => {
    const { waitCalls } = setupWaitPointMock({
      onWait: () => ({ approved: true }),
    });

    const result = await processWithApproval.body({ orderId: "order-1" }, { env: {} });

    expect(result).toEqual({ orderId: "order-1", status: "approved" });
    expect(waitCalls[0]).toEqual({
      key: "approval",
      payload: { message: "Please approve order order-1", orderId: "order-1" },
    });
  });

  test("returns rejected status when .wait() resolves negatively", async () => {
    setupWaitPointMock({ onWait: () => ({ approved: false }) });

    const result = await processWithApproval.body({ orderId: "order-2" }, { env: {} });

    expect(result.status).toBe("rejected");
  });
});
```

`onWait` controls what each `.wait()` returns; `waitCalls` captures the `key` and `payload` passed in.

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
