# Testing Guide

Tailor Platform SDK applications are tested with [Vitest](https://vitest.dev/) at two layers:

| Layer      | What it exercises                                    | Deployment required |
| ---------- | ---------------------------------------------------- | ------------------- |
| Unit tests | Resolver / workflow job / executor TypeScript source | No                  |
| E2E tests  | Deployed GraphQL API, TailorDB, and workflows        | Yes                 |

Lean on unit tests for the day-to-day feedback loop — they run fast and exercise business logic against real SDK types with no deployment in the loop. Reach for E2E tests to confirm integration against a live platform, where mocked globals can drift from the real GraphQL, TailorDB, and workflow runtime.

Unit-test entrypoints exposed by the SDK:

- `resolver.body({ input, caller, invoker, env })` — invoke a resolver
- `workflowJob.body(input, { env, invoker })` — invoke a workflow job body directly
- `workflowJob.start(input)` — chain a workflow job through the workflow runtime
- `runWorkflowLocally(workflow, args)` — run a workflow chain locally with real job bodies
- `executor.operation.body({ ...args, invoker })` — invoke a function-kind executor

For anonymous direct calls:

- Pass `null` for anonymous `caller` / `invoker` context in direct unit tests.

Platform API mocks under `@tailor-platform/sdk/vitest` (for use with the [`tailor-runtime` Vitest environment](#runtime-environment-emulation-beta) below):

- `mockTailordb` — TailorDB query stubs and call recording
- `mockWorkflow` — `tailor.workflow` job / wait / resolve mocks
- `runWorkflowLocally` — local full-chain workflow runner
- `mockSecretmanager`, `mockAuthconnection`, `mockIdp`, `mockFile`, `mockIconv`, `mockAigateway`, `mockLogger` — corresponding platform API mocks

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
3. **Platform API mocks** — the platform error classes (`TailorErrors`, `TailorDBFileError`) and `tailor.context` are always available. The other namespaces (`tailordb.Client`, `tailor.workflow`, `tailor.secretmanager`, …) are mocked when you acquire the corresponding `mockX()` — see below.

### Acquiring mocks with `using`

Each mock controller (`mockTailordb`, `mockWorkflow`, `mockSecretmanager`, `mockAuthconnection`, `mockIdp`, `mockFile`, `mockIconv`, `mockAigateway`, `mockLogger`) is a **factory function**. Acquire it inside a test with a [`using` declaration](https://github.com/tc39/proposal-explicit-resource-management) — its state is reset automatically when the test scope exits, so you no longer need `beforeEach(() => mock.reset())`:

```typescript
import { mockTailordb } from "@tailor-platform/sdk/vitest";

test("...", () => {
  using db = mockTailordb();
  db.onQuery(/SELECT age/).returnsRows([{ age: 30 }]);
  // …
}); // reset automatically here
```

Runtime operations are exposed as typed Vitest mocks wherever the platform API has a stable operation shape. For example, use `file.download.mockResolvedValue(...)`, `iconv.decode.mockReturnValue(...)`, or `wf.job(myJob).mockResolvedValue(...)`, then assert with native Vitest matchers. Service-specific helpers cover stateful fixtures and query matching.

Every controller provides two lifecycle methods when manual reuse is useful:

- `clear()` removes call history but preserves configured behavior.
- `reset()` removes call history and configured behavior, restoring the controller's default behavior.

> **Requirements:** `using` requires TypeScript ≥ 5.2 and a runtime that provides `Symbol.dispose` (Node ≥ 20.4 — the SDK already targets Node ≥ 22, and Vitest's transformer downlevels the syntax for you).
>
> **Acquire what you use:** a namespace is only mocked while you hold it with `using`, so code under test that calls a platform API (e.g. `tailor.workflow`, `tailordb.Client`) must run inside a test that has acquired the matching `mockX()`. The error classes and `tailor.context` are always present.
>
> **Seeded secrets survive:** secrets seeded from `tailor.config.ts` stay available across tests; per-test fixtures passed to `mockSecretmanager({ secrets: ... })` apply only within that test.

### TailorDB Mock

Acquire `mockTailordb()` to install the mock `tailordb.Client`, configure responses, and assert on executed queries:

```typescript
import { mockTailordb } from "@tailor-platform/sdk/vitest";

test("resolver queries the database", async () => {
  using db = mockTailordb();
  // Use an explicit queue when transaction order is part of the test.
  db.enqueueRows(
    [], // BEGIN (empty result)
    [{ age: 30 }], // SELECT (one row)
    [], // COMMIT
  );

  const result = await resolver.body({
    input: { email: "test@example.com" },
    caller: null,
    invoker: null,
    env: {},
  });

  expect(result).toEqual({ oldAge: 30, newAge: 31 });
  expect(db.executedQueries).toHaveLength(3);
  expect(db.createdClients).toMatchObject([{ namespace: "tailordb" }]);
});
```

Match queries by SQL text, a regular expression, SQL plus parameters, or a predicate. The most recently registered matcher wins:

```typescript
test("content-based mock", async () => {
  using db = mockTailordb();
  db.onQuery({ sql: /FROM users/i, params: ["1"] }).returnsRows([{ id: "1", name: "test" }]);
  db.onQuery(/FROM audit_logs/i)
    .returnsRowsOnce([{ id: "first" }])
    .returnsRows([{ id: "later" }]);

  const result = await resolver.body({
    input: { userId: "1" },
    caller: null,
    invoker: null,
    env: {},
  });

  expect(db.executedQueries[0].query).toContain("SELECT");
});
```

Within one `mockTailordb()` instance, use either `onQuery()` matchers or a direct `queryObject.mockImplementation()` override. A direct override replaces matcher-based behavior, so do not combine the two styles.

`returnsRowsOnce` and `rejectsOnce` configure one-time responses before the persistent `returnsRows` or `rejects` response. `enqueueRows(...rowArrays)` remains available for transaction sequences whose exact call order is under test. The existing `enqueueResult`, `enqueueResults`, and `setQueryResolver` helpers remain supported for compatibility.

Pass `{ onUnhandled: "error" }` to make an unmatched query fail instead of returning an empty result.

### Workflow Mock

Workflow job `.start()` calls use the platform workflow runtime. Acquire `mockWorkflow()` when you want to provide start responses with `setJobHandler` / `enqueueResult` or assert on `startedJobs`. If no response is configured, the mock throws so missing job mocks fail loudly. Use `job(definition)` or `workflow(definition)` to get a stable, fully typed Vitest mock for one definition:

```typescript
import { mockWorkflow } from "@tailor-platform/sdk/vitest";
import { processPayment, validateOrder } from "./jobs";

test("workflow starts jobs", async () => {
  using wf = mockWorkflow();
  const validate = wf.job(validateOrder);
  const payment = wf.job(processPayment);
  validate.mockResolvedValue({ valid: true });
  payment.mockResolvedValue({ txnId: "txn-1" });

  const result = await main({ input: { orderId: "o-1" } });

  expect(validate).toHaveBeenCalledWith({ orderId: "o-1" });
  expect(payment).toHaveBeenCalledWith({ orderId: "o-1" });
});
```

Unconfigured definition mocks continue to run their real implementations. The lower-level `execJobFunction`, `startWorkflow`, `resumeWorkflowExecution`, `wait`, and `resolve` mocks and the existing `setJobHandler`, `enqueueResult`, `enqueueResults`, and call-record helpers remain available.

Use `waitPoint(definition)` for typed wait-point control:

```typescript
using wf = mockWorkflow();
const approvalMock = wf.waitPoint(approvalWaitPoint);

approvalMock.wait.mockResolvedValue({ approved: true });
await approvalWaitPoint.wait({ message: "Please approve" });

expect(approvalMock.wait).toHaveBeenCalledWith({ message: "Please approve" });
```

Use `wf.setEnv(...)` when locally-run workflow job bodies need configuration values. Per-run `runWorkflowLocally(..., { env })` options take precedence over the mock's env.

### SecretManager Mock

```typescript
import { mockSecretmanager } from "@tailor-platform/sdk/vitest";

test("reads secrets from vault", async () => {
  using sm = mockSecretmanager({
    secrets: { "my-vault": { API_KEY: "sk-123" } },
  });
  sm.setSecret("my-vault", "API_KEY", "override");
  sm.mergeSecrets("my-vault", { DB_PASS: "secret" });

  const key = await tailor.secretmanager.getSecret("my-vault", "API_KEY");
  expect(key).toBe("override");
  expect(sm.calls).toEqual([{ method: "getSecret", vault: "my-vault", name: "API_KEY" }]);
});
```

### AuthConnection Mock

```typescript
import { mockAuthconnection } from "@tailor-platform/sdk/vitest";

test("returns configured token", async () => {
  using ac = mockAuthconnection({
    tokens: { google: { access_token: "ya29.xxx" } },
    onUnhandled: "error",
  });
  ac.setToken("google", { access_token: "replacement" });

  const token = await tailor.authconnection.getConnectionToken("google");
  expect(token.access_token).toBe("replacement");
});
```

By default, an unconfigured connection returns `{ access_token: "mock-token" }`. Pass `onUnhandled: "error"` to fail instead.

### IDP Mock

```typescript
import { mockIdp } from "@tailor-platform/sdk/vitest";

test("namespace-specific mock", async () => {
  using idp = mockIdp({ onUnhandled: "error" });
  const customerIdp = idp.namespace("my-ns");
  customerIdp.user.mockResolvedValue({
    id: "u-1",
    name: "alice",
    disabled: false,
    mfaEnrolled: false,
    mfaFactorIds: [],
  });

  const client = new tailor.idp.Client({ namespace: "my-ns" });
  const user = await client.user("u-1");
  expect(user.name).toBe("alice");
  expect(customerIdp.user).toHaveBeenCalledWith("u-1");
});
```

Each namespace exposes typed mocks for `users`, `user`, `userByName`, `createUser`, `updateUser`, `deleteUser`, `sendPasswordResetEmail`, and `unenrollMfa`. The existing resolver, queue, and aggregate `calls` APIs remain supported.

### File Mock

```typescript
import { mockFile } from "@tailor-platform/sdk/vitest";

test("mock file download", async () => {
  using file = mockFile({ onUnhandled: "error" });
  file.download.mockResolvedValue({
    data: new Uint8Array([1, 2, 3]),
    metadata: { contentType: "image/png", fileSize: 3, sha256sum: "abc", lastUploadedAt: "" },
  });

  const result = await tailordb.file.download("ns", "Doc", "attachment", "r-1");
  expect(result.data).toEqual(new Uint8Array([1, 2, 3]));
  expect(file.download).toHaveBeenCalledWith("ns", "Doc", "attachment", "r-1");
});
```

All File operations are typed Vitest mocks: `upload`, `download`, `downloadAsBase64`, `delete`, `getMetadata`, `downloadStream`, and `uploadStream`. Use native methods such as `mockResolvedValueOnce` and `mockRejectedValueOnce` to model success and failure. The existing resolver, queue, and aggregate `calls` APIs remain supported.

For `downloadStream`, configure a `FileDownloadStreamResponse` object with a `ReadableStream` body and metadata:

```typescript
test("mock file download stream", async () => {
  using file = mockFile();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  file.downloadStream.mockResolvedValue({
    body,
    metadata: { contentType: "image/png", fileSize: 3, sha256sum: "abc", lastUploadedAt: "" },
  });

  const result = await tailordb.file.downloadStream("ns", "Doc", "attachment", "r-1");
  expect(result.metadata.fileSize).toBe(3);
});
```

### Iconv Mock

```typescript
import { mockIconv } from "@tailor-platform/sdk/vitest";

test("mock encoding conversion", () => {
  using iconv = mockIconv();
  iconv.decode.mockReturnValue("decoded-text");

  const result = tailor.iconv.decode(new Uint8Array([0x48, 0x69]), "UTF-8");
  expect(result).toBe("decoded-text");
  expect(iconv.calls).toMatchObject([{ method: "decode" }]);
});
```

`convert`, `convertBuffer`, `decode`, `encode`, and `encodings` are all typed Vitest mocks. Pass `{ onUnhandled: "error" }` to fail calls without a configured implementation. The existing resolver and aggregate `calls` APIs remain supported.

### AI Gateway Mock

```typescript
import { mockAigateway } from "@tailor-platform/sdk/vitest";

test("resolves an AI Gateway URL", async () => {
  using aigateway = mockAigateway({
    urls: { "my-aigateway": "https://my-aigateway.example.com" },
  });
  aigateway.setUrl("my-aigateway", "https://replacement.example.com");

  const { url } = await tailor.aigateway.get("my-aigateway");
  expect(url).toBe("https://replacement.example.com");
  expect(aigateway.calls).toEqual([{ name: "my-aigateway" }]);
});
```

Calling `get` for a name that has not been registered throws. `setUrls` remains available when replacing the complete URL fixture.

### Logger Mock

Each method is a `vi.fn`, so assert on it directly. `calls` returns the emitted `debug`/`info`/`warn`/`error` entries in order.

```typescript
import { mockLogger } from "@tailor-platform/sdk/vitest";

test("logs the processed order", () => {
  using logger = mockLogger();

  tailor.logger.info("order processed", { orderId: "o-1" });

  expect(logger.info).toHaveBeenCalledWith("order processed", { orderId: "o-1" });
  expect(logger.calls).toEqual([
    { severity: "info", message: "order processed", attributes: { orderId: "o-1" } },
  ]);
});
```

Without an explicit `mockLogger()`, `tailor.logger.*` calls are no-ops in the `tailor-runtime` environment (they neither throw nor record).

### Loading Secrets from Config

Pass a config path to load `defineSecretManager()` values into the mock:

```typescript
export default defineConfig({
  plugins: [tailorRuntime({ config: "./tailor.config.ts" })],
  test: { environment: "tailor-runtime" },
});
```

This makes `tailor.secretmanager.getSecret("vault", "key")` return the values defined in your config. You can still override with `mockSecretmanager({ secrets: ... })` in individual tests: a per-test overlay applies only within that test, and the config-loaded secrets remain available to every other test.

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

Unit tests call `.body()` (or `.start()`) directly on a resolver, workflow job, or executor and stub any platform-provided globals they touch.

### Testing Resolvers

#### Simple resolver

For pure logic with no external dependencies, invoke `.body()` directly:

```typescript
import { describe, expect, test } from "vitest";
import resolver from "../src/resolver/add";

describe("add resolver", () => {
  test("adds two numbers", async () => {
    const result = await resolver.body({
      input: { left: 1, right: 2 },
      caller: null,
      invoker: null,
      env: {},
    });
    expect(result).toBe(3);
  });
});
```

**Use when:** calculations, data transformations, anything that does not hit the database.

#### Mocking the TailorDB client

Stub the global `tailordb.Client` and queue raw query results in order. Best for resolvers that issue a short, predictable query sequence:

> If you are running with the [`tailor-runtime` Vitest environment](#runtime-environment-emulation-beta), acquire `using db = mockTailordb()` to install and drive the mock `tailordb.Client` instead of `vi.stubGlobal()`.

> The example below uses `aroundAll` / `aroundEach`, which require Vitest ≥ 4.1.

```typescript
import { aroundAll, aroundEach, describe, expect, test, vi } from "vitest";
import resolver from "../src/resolver/incrementUserAge";

describe("incrementUserAge resolver", () => {
  const mockQueryObject = vi.fn();

  aroundAll(async (runSuite) => {
    vi.stubGlobal("tailordb", {
      Client: vi.fn(
        class {
          connect = vi.fn();
          end = vi.fn();
          queryObject = mockQueryObject;
        },
      ),
    });
    await runSuite();
    vi.unstubAllGlobals();
  });
  aroundEach(async (runTest) => {
    await runTest();
    mockQueryObject.mockReset();
  });

  test("increments age inside a transaction", async () => {
    // BEGIN → SELECT → UPDATE → COMMIT
    mockQueryObject.mockResolvedValueOnce({});
    mockQueryObject.mockResolvedValueOnce({ rows: [{ age: 30 }] });
    mockQueryObject.mockResolvedValueOnce({});
    mockQueryObject.mockResolvedValueOnce({});

    const result = await resolver.body({
      input: { email: "test@example.com" },
      caller: null,
      invoker: null,
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

#### Kysely-layer mock (`createKyselyMock`)

`createKyselyMock` returns a real Kysely instance whose execution is mocked. Stage the rows each query returns, run your code, then assert what it did — each query's SQL and parameters, how many `selects`/`inserts`/`updates`/`deletes` ran, and the value your code returned. Queries stay fully typed and compile to the same SQL as production.

Pass `mock.db` to functions that take a Kysely instance. When a resolver or executor calls `getDB()` internally there is no such seam, so spy the generated `getDB` and point it at the mock:

```typescript
import { createKyselyMock } from "@tailor-platform/sdk/vitest";
import { describe, expect, test, vi } from "vitest";
import { getDB, type Namespace } from "../generated/db";
import resolver from "./upsertUsers";

vi.mock("../generated/db", { spy: true });

describe("upsertUsers resolver", () => {
  test("inserts new users and updates existing ones", async () => {
    const mock = createKyselyMock<Namespace["main-db"]>();
    vi.mocked(getDB).mockReturnValue(mock.db);

    mock.setQueryResolver((query) => {
      switch (query.kind) {
        case "SelectQueryNode":
          return query.parameters.includes("exists@example.com") ? [{ id: "user-1" }] : [];
        case "InsertQueryNode":
        case "UpdateQueryNode":
          return { numAffectedRows: 1 };
        default:
          return [];
      }
    });

    const result = await resolver.body({
      input: {
        users: [
          { name: "Newcomer", email: "new@example.com", age: 22 },
          { name: "Existing", email: "exists@example.com", age: 41 },
        ],
      },
      caller: null,
      invoker: null,
      env: { appName: "Resolver Template", version: 1 },
    });

    expect(result).toEqual({ created: 1, updated: 1 });
    expect(mock.selects).toHaveLength(2);
    expect(mock.inserts).toHaveLength(1);
    expect(mock.updates).toHaveLength(1);
  });
});
```

Reach for [`mockTailordb`](#mocking-the-tailordb-client) instead when you want to drive the raw query sequence at the `tailordb.Client` level rather than at the Kysely layer.

#### Resolvers that resume a workflow

Resolvers that call `waitPoint.resolve(...)` delegate to `tailor.workflow.resolve` at runtime. With the `tailor-runtime` environment active, use `mockWorkflow().waitPoint(definition)` to invoke the callback with the payload that originally suspended the job:

```typescript
import { mockWorkflow } from "@tailor-platform/sdk/vitest";
import { describe, expect, test } from "vitest";
import { approval } from "../workflow/approval";
import resolver from "./resolveApproval";

describe("resolveApproval resolver", () => {
  test("resolves approval with approved=true", async () => {
    using wf = mockWorkflow();
    const approvalMock = wf.waitPoint(approval);
    approvalMock.setResolvePayload({
      message: "Please approve order order-1",
      orderId: "order-1",
    });

    const result = await resolver.body({
      input: { executionId: "exec-1", approved: true },
      caller: null,
      invoker: null,
      env: {},
    });

    expect(result).toEqual({ resolved: true });
    expect(approvalMock.resolve).toHaveBeenCalledWith("exec-1", expect.any(Function));
  });
});
```

`setResolvePayload` is typed from the wait-point definition. The lower-level `setResolveHandler` and `resolveCalls` APIs remain available when a test must control several wait points together.

#### Resolvers that resume failed workflows

Resolvers or executors that call `workflow.resumeWorkflowExecution(executionId)` delegate to `tailor.workflow.resumeWorkflowExecution` at runtime. With the `tailor-runtime` environment active, use `mockWorkflow().setResumeHandler` to control the returned execution ID and inspect `resumeWorkflowExecution.mock.calls`:

```typescript
import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import { mockWorkflow } from "@tailor-platform/sdk/vitest";
import { describe, expect, test } from "vitest";
import resolver from "./retryFailedWorkflow";

describe("retryFailedWorkflow resolver", () => {
  test("resumes a failed workflow execution", async () => {
    using wf = mockWorkflow();
    wf.setResumeHandler("exec-resumed-123");

    const result = await resolver.body({
      input: { executionId: "exec-failed-456" },
      user: unauthenticatedTailorUser,
      env: {},
    });

    expect(result).toEqual({ resumedExecutionId: "exec-resumed-123" });
    expect(wf.resumeWorkflowExecution.mock.calls).toEqual([["exec-failed-456"]]);
  });
});
```

`setResumeHandler` accepts a static string (same execution ID for every call) or a function `(executionId) => string` that computes one per call. By default the mock echoes the input `executionId`.

### Testing Executors

Function-kind executors expose their handler as `executor.operation.body(args)`. The shape of `args` is determined by the trigger — for example, `recordCreatedTrigger({ type: user })` produces `{ newRecord }` typed against the type's output, plus runtime fields such as `env`, `actor`, and `invoker`. GraphQL, webhook, and workflow operation kinds are declarative and don't expose a user-authored body to test.

The `executor` template extracts shared DB access into a helper (`shared.ts`) and tests the helper directly against a mocked `tailordb.Client` (same TailorDB-mocking pattern as the resolver section). Executor handlers themselves stay thin and can be tested by spying on the helper:

```typescript
import { describe, expect, test, vi } from "vitest";
import onUserCreated from "./onUserCreated";
import * as shared from "./shared";

describe("onUserCreated executor", () => {
  test("creates an audit log with the new user's name and email", async () => {
    using createAuditLog = vi.spyOn(shared, "createAuditLog").mockResolvedValue(undefined);

    if (onUserCreated.operation.kind !== "function") {
      throw new Error("expected function operation");
    }
    await onUserCreated.operation.body({
      workspaceId: "workspace-1",
      appNamespace: "app",
      env: {},
      actor: null,
      invoker: null,
      event: "created",
      rawEvent: "tailordb.type_record.created",
      typeName: "User",
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

Workflow jobs expose the same `.body()` entrypoint as resolvers, plus `.start()` for calling them from another job or a test.

#### Simple job

Call `.body()` with the input and a stub `{ env: {}, invoker: null }`:

```typescript
import { describe, expect, test } from "vitest";
import { validateOrder } from "./order-fulfillment";

describe("validateOrder", () => {
  test("accepts a valid order", () => {
    const result = validateOrder.body(
      { orderId: "order-1", amount: 100 },
      { env: {}, invoker: null },
    );
    expect(result).toEqual({ valid: true, orderId: "order-1" });
  });

  test("rejects a non-positive amount", () => {
    expect(() =>
      validateOrder.body({ orderId: "order-1", amount: 0 }, { env: {}, invoker: null }),
    ).toThrow("Order amount must be positive");
  });
});
```

#### Jobs that start other jobs

Use `mockWorkflow().job(definition)` to replace dependent jobs with deterministic results:

```typescript
import { mockWorkflow } from "@tailor-platform/sdk/vitest";
import { describe, expect, test } from "vitest";
import { fulfillOrder, processPayment, sendConfirmation, validateOrder } from "./order-fulfillment";

describe("fulfillOrder", () => {
  test("chains validate → pay → confirm", async () => {
    using wf = mockWorkflow();
    const validate = wf.job(validateOrder).mockResolvedValue({
      valid: true,
      orderId: "order-1",
    });
    wf.job(processPayment).mockResolvedValue({
      transactionId: "txn-order-1",
      amount: 100,
      status: "completed",
    });
    wf.job(sendConfirmation).mockResolvedValue({
      orderId: "order-1",
      transactionId: "txn-order-1",
      confirmed: true,
    });

    const result = await fulfillOrder.body(
      { orderId: "order-1", amount: 100 },
      { env: {}, invoker: null },
    );

    expect(validate).toHaveBeenCalledWith({ orderId: "order-1", amount: 100 });
    expect(result).toMatchObject({ confirmed: true, paymentStatus: "completed" });
  });
});
```

**Use when:** you want to isolate the orchestrating job from its dependencies.

#### Jobs that wait on approval

`.wait()` calls delegate to `tailor.workflow.wait`. With the `tailor-runtime` environment active, use `mockWorkflow().waitPoint(definition)` to drive each branch with a typed mock:

```typescript
import { mockWorkflow } from "@tailor-platform/sdk/vitest";
import { describe, expect, test } from "vitest";
import { approval, processWithApproval } from "./approval";

describe("processWithApproval", () => {
  test("returns approved status when .wait() resolves positively", async () => {
    using wf = mockWorkflow();
    const approvalMock = wf.waitPoint(approval);
    approvalMock.wait.mockResolvedValue({ approved: true });

    const result = await processWithApproval.body(
      { orderId: "order-1" },
      { env: {}, invoker: null },
    );

    expect(result).toEqual({ orderId: "order-1", status: "approved" });
    expect(approvalMock.wait).toHaveBeenCalledWith({
      message: "Please approve order order-1",
      orderId: "order-1",
    });
  });

  test("returns rejected status when .wait() resolves negatively", async () => {
    using wf = mockWorkflow();
    wf.waitPoint(approval).wait.mockResolvedValue({ approved: false });

    const result = await processWithApproval.body(
      { orderId: "order-2" },
      { env: {}, invoker: null },
    );

    expect(result.status).toBe("rejected");
  });
});
```

The lower-level `setWaitHandler` and `waitCalls` APIs remain available when one handler must cover several wait points.

#### Running a full workflow locally

To exercise the full chain with real job bodies, call `runWorkflowLocally(workflow, args)`. Dependent jobs run their real `.body()` functions, and start args/results cross the same JSON boundary as the platform, so a non-serializable payload fails the test exactly as it would in production:

```typescript
import { runWorkflowLocally } from "@tailor-platform/sdk/vitest";
import { describe, expect, test } from "vitest";
import workflow from "./order-fulfillment";

describe("order-fulfillment workflow", () => {
  test("runWorkflowLocally() executes all jobs", async () => {
    const result = await runWorkflowLocally(workflow, { orderId: "order-3", amount: 300 });

    expect(result).toMatchObject({ confirmed: true, paymentStatus: "completed" });
  });
});
```

Acquire `mockWorkflow()` only when you need to override a dependent definition with `wf.job(...)` / `wf.workflow(...)` (the rest still run their real bodies), control the env via `wf.setEnv(...)`, or assert on calls.

Pass `{ env }` as the third argument when job bodies need configuration values during the local run.

If you already acquired `mockWorkflow()`, you can also call `wf.setEnv(...)` to reuse the same env across local workflow runs.

Like the platform runtime, the local runner re-runs the orchestrator body once per `.start()` call (N starts means N+1 passes), so any side effects outside the start results fire on every pass. Keep the body deterministic and move repeatable side effects into the started jobs.

This helper is still a local runner. Use E2E tests when you need to verify deployed workflow scheduling, suspension, or replay behavior.

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
import userProfileSync from "../src/workflow/sync-profile";

describe("user-profile-sync workflow", () => {
  test("executes end to end", { timeout: 180_000 }, async () => {
    const { executionId, wait } = await startWorkflow({
      workflow: userProfileSync,
      invoker: "admin",
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
