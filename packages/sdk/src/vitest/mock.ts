/**
 * Mock controls for Tailor Platform APIs (vitest).
 *
 * Each `xMock()` factory installs `vi.fn()`-backed mocks for one platform
 * namespace onto `globalThis` when acquired, and restores the previous value
 * when the `using` scope exits. State lives in the per-acquisition vi.fns /
 * closures — there is no shared global state bag — so nested/sequential scopes
 * are isolated and namespaces never interfere with each other.
 *
 * Acquire a mock with a `using` declaration:
 *
 * ```ts
 * test("...", () => {
 *   using wf = mockWorkflow();
 *   wf.setJobHandler(() => ({ ok: true }));
 * }); // previous workflow mock restored here
 * ```
 *
 * The friendly helpers (`setJobHandler`, `enqueueResult`, `triggeredJobs`, …)
 * are thin wrappers over the underlying vi.fns, which are also exposed directly
 * (`wf.triggerJobFunction`) for native matchers like
 * `expect(wf.triggerJobFunction).toHaveBeenCalledWith(...)`.
 */

import { type Mock, vi } from "vitest";
import {
  getRegisteredJob,
  getRegisteredWorkflow,
  TRIGGER_DEFAULT,
} from "@/configure/services/workflow/registry";
import { platformSerialize } from "@/utils/test/platform-serialize";
import {
  buildJobContext,
  clearWorkflowTestEnv,
  writeWorkflowTestEnv,
} from "../configure/services/workflow/test-env-key";
import type { User as IdpUser } from "../runtime/idp";
import type { TailorEnv } from "../types/env";

export { RUNTIME_FLAG_KEY } from "./globals";

// Re-export the base globals install/cleanup under their historical names so
// non-environment tests (which run in the plain `node` environment) can set up
// the base platform surface — `globalThis.tailor`, error classes — themselves.
export {
  installPlatformGlobals as injectMocks,
  cleanupPlatformGlobals as cleanupMocks,
} from "./globals";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QueryResolver = (query: string, params: unknown[]) => unknown[];
type JobHandler = (jobName: string, args: unknown) => unknown;
type IdpResolver = (method: string, args: unknown[], namespace: string) => unknown;
type FileResolver = (method: string, call: FileCall) => unknown;
type IconvResolver = (method: string, args: unknown[]) => unknown;

type TriggerWorkflowOptions = {
  authInvoker?: { namespace: string; machineUserName: string };
};
type TriggerHandlerFn = (
  workflowName: string,
  args: unknown,
  options?: TriggerWorkflowOptions,
) => string;
type WaitHandlerFn = (key: string, payload: unknown) => unknown;
type ResolveHandler = (
  executionId: string,
  key: string,
  callback: (payload: unknown) => unknown,
) => unknown | Promise<unknown>;

// Overloaded so TypeScript narrows to WaitHandlerFn first (giving inferred
// `(key: string, payload: unknown) => …` for callers) before falling back
// to the static-value form. A union type would let `unknown` swallow the
// function variant and break inference.
type SetWaitHandler = {
  (handler: WaitHandlerFn): void;
  (handler: unknown): void;
};

interface ExecutedQuery {
  query: string;
  params: unknown[];
}

interface CreatedClient {
  namespace: string | undefined;
  ended: boolean;
}

interface TriggeredJob {
  jobName: string;
  args: unknown;
}

interface SecretCall {
  method: "getSecret" | "getSecrets";
  vault: string;
  name?: string;
  names?: readonly string[];
}

interface AuthConnectionCall {
  connectionName: string;
}

interface IdpCall {
  method: string;
  args: unknown[];
  namespace: string;
}

interface FileCall {
  method: string;
  namespace: string;
  typeName: string;
  fieldName: string;
  recordId: string;
}

interface IconvCall {
  method: string;
  args: unknown[];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Attach a non-enumerable `Symbol.dispose` to a facade so it works with `using`.
function withDispose<T extends object>(facade: T, dispose: () => void): T & Disposable {
  Object.defineProperty(facade, Symbol.dispose, {
    value: dispose,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return facade as T & Disposable;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tailorRoot(): Record<string, any> {
  const g = globalThis as Record<string, unknown>;
  if (!g.tailor) {
    // Ensure the container (and the always-present context stub) exists even if
    // the base globals were not installed (e.g. a unit test that only acquires
    // a single mock without the tailor-runtime environment).
    g.tailor = { context: { getInvoker: () => null } };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return g.tailor as Record<string, any>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tailordbRoot(): Record<string, any> {
  const g = globalThis as Record<string, unknown>;
  if (!g.tailordb) {
    g.tailordb = {};
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return g.tailordb as Record<string, any>;
}

class MockQueryResult {
  command: string;
  rowCount: number;
  rows: unknown[];

  constructor(rows: unknown[]) {
    this.command = "";
    this.rowCount = rows.length;
    this.rows = rows;
  }
}

// ---------------------------------------------------------------------------
// TailorDB Mock
// ---------------------------------------------------------------------------

/**
 * Acquire a disposable mock for TailorDB operations. Installs a mock
 * `tailordb.Client` whose `queryObject` is a shared `vi.fn()` (so query
 * responses can be staged before the client is constructed). Restored on
 * dispose.
 * @returns Disposable TailorDB mock control object
 * @example
 * ```typescript
 * import { mockTailordb } from "@tailor-platform/sdk/vitest";
 *
 * test("order-based", async () => {
 *   using db = mockTailordb();
 *   db.enqueueResults([], [{ age: 30 }], []); // BEGIN / SELECT / COMMIT
 *   // …
 *   expect(db.queryObject).toHaveBeenCalledTimes(3);
 *   expect(db.Client).toHaveBeenCalledWith({ namespace: "tailordb" });
 * });
 * ```
 */
export function mockTailordb() {
  const root = tailordbRoot();
  const prevClient = root.Client;

  const queryObject = vi.fn(
    async (_query: string, _params: unknown[] = []): Promise<MockQueryResult> =>
      new MockQueryResult([]),
  );
  const connect = vi.fn(async (): Promise<void> => {});
  const createdClients: CreatedClient[] = [];

  const Client = vi.fn(function (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this: any,
    config?: { namespace?: string },
  ) {
    const record: CreatedClient = { namespace: config?.namespace, ended: false };
    createdClients.push(record);
    this.connect = connect;
    this.end = vi.fn(async (): Promise<void> => {
      record.ended = true;
    });
    this.queryObject = queryObject;
    this.createTransaction = (name: string) => {
      if (!name) {
        throw new Error("Transaction name must be a non-empty string");
      }
      return {
        begin: async (): Promise<void> => {},
        commit: async (): Promise<void> => {},
        rollback: async (): Promise<void> => {},
        queryObject,
      };
    };
  });

  root.Client = Client;

  const facade = {
    /** The mock `tailordb.Client` constructor (`vi.fn`). */
    Client,
    /** The shared `queryObject` `vi.fn` used by every client and transaction. */
    queryObject,

    /**
     * Set a fallback query resolver. Called when the enqueue queue is empty.
     * @param resolver - Function that returns rows for a given query and params
     */
    setQueryResolver(resolver: QueryResolver): void {
      queryObject.mockImplementation(
        async (query: string, params: unknown[] = []) =>
          new MockQueryResult(resolver(query, params) ?? []),
      );
    },

    /**
     * Enqueue rows for the next `queryObject` call (FIFO; takes priority over
     * `setQueryResolver`). Call with no arguments for an empty result.
     * @param rows - Row objects to return from the next `queryObject` call
     */
    enqueueResult(...rows: unknown[]): void {
      queryObject.mockImplementationOnce(async () => new MockQueryResult(rows));
    },

    /**
     * Enqueue rows for multiple subsequent `queryObject` calls (FIFO).
     * @param rowsList - Rows arrays, one per upcoming query
     */
    enqueueResults(...rowsList: unknown[][]): void {
      for (const rows of rowsList) {
        queryObject.mockImplementationOnce(async () => new MockQueryResult(rows));
      }
    },

    /**
     * All queries executed via `queryObject`, in order, derived from the vi.fn
     * call records.
     * @returns Executed queries array
     */
    get executedQueries(): ExecutedQuery[] {
      return queryObject.mock.calls.map(([query, params]) => ({
        query: query as string,
        params: (params as unknown[]) ?? [],
      }));
    },

    /**
     * All TailorDB clients created, with their namespace and end state.
     * @returns Created clients array
     */
    get createdClients(): CreatedClient[] {
      return createdClients;
    },

    /** Reset query responses and recorded calls (keeps the mock installed). */
    reset(): void {
      queryObject.mockReset();
      queryObject.mockImplementation(async () => new MockQueryResult([]));
      connect.mockClear();
      Client.mockClear();
      createdClients.length = 0;
    },
  };

  return withDispose(facade, () => {
    root.Client = prevClient;
  });
}

// ---------------------------------------------------------------------------
// Workflow Mock
// ---------------------------------------------------------------------------

/**
 * Acquire a disposable mock for workflow operations (`tailor.workflow`).
 * Restored on dispose.
 * @returns Disposable workflow mock control object
 * @example
 * ```typescript
 * import { mockWorkflow } from "@tailor-platform/sdk/vitest";
 *
 * test("job handler", async () => {
 *   using wf = mockWorkflow();
 *   wf.setJobHandler((name) => (name === "validate" ? { valid: true } : null));
 *   await runWorkflowUnderTest(); // calls tailor.workflow.triggerJobFunction("validate", {})
 *   expect(wf.triggerJobFunction).toHaveBeenCalledWith("validate", {});
 * });
 * ```
 */
export function mockWorkflow() {
  const root = tailorRoot();
  const prev = root.workflow;

  // Default impls (also restored by reset): run the registered body by name so a
  // `.trigger()` with no handler/result executes the real job locally.
  const defaultTriggerJob = (jobName: string, args?: unknown): unknown => {
    const body = getRegisteredJob(jobName);
    return body ? body(args, buildJobContext()) : null;
  };
  const defaultTriggerWorkflow = async (
    workflowName: string,
    args?: unknown,
    _options?: TriggerWorkflowOptions,
  ): Promise<string> => {
    const wf = getRegisteredWorkflow(workflowName);
    if (wf) await installedTriggerJobFunction(wf.mainJobName, args);
    return TRIGGER_DEFAULT;
  };

  // Inner vi.fns hold the overridable behavior + call recording; the installed
  // shims below cross the platform JSON boundary (serialize args + results) once
  // so every path (default body, setJobHandler, enqueueResult) is covered.
  const triggerJobFunction = vi.fn(defaultTriggerJob);
  const triggerWorkflow = vi.fn(defaultTriggerWorkflow);
  const wait = vi.fn((_key: string, _payload?: unknown): unknown => null);
  const resolve = vi.fn(
    async (
      _executionId: string,
      _key: string,
      _callback: (payload: unknown) => unknown,
    ): Promise<void> => {},
  );

  const installedTriggerJobFunction = (jobName: string, args?: unknown): unknown => {
    const out = triggerJobFunction(jobName, platformSerialize(args));
    return out instanceof Promise ? out.then((v) => platformSerialize(v)) : platformSerialize(out);
  };

  root.workflow = {
    triggerJobFunction: installedTriggerJobFunction,
    // Preserve arity so a forwarded third `options` arg — even `undefined` — is
    // recorded, matching the real `.trigger(args, options)` call shape.
    triggerWorkflow: (...call: [string, unknown?, TriggerWorkflowOptions?]) =>
      call.length >= 3
        ? triggerWorkflow(call[0], platformSerialize(call[1]), call[2])
        : triggerWorkflow(call[0], platformSerialize(call[1])),
    wait: (key: string, payload?: unknown) => wait(key, platformSerialize(payload)),
    resolve: (executionId: string, key: string, callback: (payload: unknown) => unknown) =>
      resolve(executionId, key, (payload: unknown) => {
        const out = callback(payload);
        return out instanceof Promise
          ? out.then((v) => platformSerialize(v))
          : platformSerialize(out);
      }),
  };

  const facade = {
    /** The `triggerJobFunction` `vi.fn`. */
    triggerJobFunction,
    /** The `triggerWorkflow` `vi.fn`. */
    triggerWorkflow,
    /** The `wait` `vi.fn`. */
    wait,
    /** The `resolve` `vi.fn`. */
    resolve,

    /**
     * Set a fallback job handler. Called when the enqueue queue is empty.
     * @param handler - Function returning a result for a job name and args
     */
    setJobHandler(handler: JobHandler): void {
      triggerJobFunction.mockImplementation((name, args) => handler(name, args));
    },

    /**
     * Enqueue a single result for the next `triggerJobFunction` call (FIFO;
     * takes priority over `setJobHandler`).
     * @param result - Result to return from the next call
     */
    enqueueResult(result: unknown): void {
      triggerJobFunction.mockImplementationOnce(() => result);
    },

    /**
     * Enqueue results for multiple subsequent `triggerJobFunction` calls (FIFO).
     * @param results - Results to enqueue, one per upcoming call
     */
    enqueueResults(...results: unknown[]): void {
      for (const result of results) {
        triggerJobFunction.mockImplementationOnce(() => result);
      }
    },

    /**
     * All jobs triggered via `triggerJobFunction`, in order.
     * @returns Triggered jobs array
     */
    get triggeredJobs(): TriggeredJob[] {
      return triggerJobFunction.mock.calls.map(([jobName, args]) => ({
        jobName: jobName as string,
        args,
      }));
    },

    /**
     * Configure what `triggerWorkflow` returns. Pass a string (same id every
     * call) or `(name, args, options) => string`. Default: a placeholder UUID.
     * @param handler - Static execution ID or a function returning one
     */
    setTriggerHandler(handler: string | TriggerHandlerFn): void {
      triggerWorkflow.mockImplementation(
        typeof handler === "function"
          ? async (name, args, options) => handler(name, args, options)
          : async () => handler,
      );
    },

    /**
     * Configure what `wait` returns. Pass `(key, payload) => unknown` or any
     * other value to return it for every call. Default: `null`.
     * @param handler - Static value or a function returning one
     */
    setWaitHandler: ((handler: unknown) => {
      wait.mockImplementation(
        typeof handler === "function"
          ? (key, payload) => (handler as WaitHandlerFn)(key, payload)
          : () => handler,
      );
    }) as SetWaitHandler,

    /**
     * Set the `env` passed to job bodies invoked via `createWorkflowJob().trigger()`.
     * Cleared on dispose / reset.
     * @param env - Env passed to job bodies.
     */
    setEnv(env: TailorEnv): void {
      writeWorkflowTestEnv({ ...env });
    },

    /**
     * Configure how `resolve` runs the user-supplied callback. Default: callback
     * is not invoked (records the call only).
     * @param handler - Function invoked per `resolve` call
     */
    setResolveHandler(handler: ResolveHandler): void {
      resolve.mockImplementation(async (executionId, key, callback) => {
        await handler(executionId, key, callback);
      });
    },

    /**
     * `wait` calls reshaped as `{ key, payload }` for assertions.
     * @returns Wait call records
     */
    get waitCalls(): { key: string; payload: unknown }[] {
      return wait.mock.calls.map(([key, payload]) => ({ key: key as string, payload }));
    },

    /**
     * `resolve` calls reshaped as `{ executionId, key }` for assertions.
     * @returns Resolve call records
     */
    get resolveCalls(): { executionId: string; key: string }[] {
      return resolve.mock.calls.map(([executionId, key]) => ({
        executionId: executionId as string,
        key: key as string,
      }));
    },

    /** Reset all workflow responses and recorded calls (keeps the mock installed). */
    reset(): void {
      triggerJobFunction.mockReset();
      triggerJobFunction.mockImplementation(defaultTriggerJob);
      triggerWorkflow.mockReset();
      triggerWorkflow.mockImplementation(defaultTriggerWorkflow);
      wait.mockReset();
      wait.mockImplementation(() => null);
      resolve.mockReset();
      resolve.mockImplementation(async () => {});
      clearWorkflowTestEnv();
    },
  };

  return withDispose(facade, () => {
    root.workflow = prev;
    clearWorkflowTestEnv();
  });
}

// ---------------------------------------------------------------------------
// SecretManager Mock
// ---------------------------------------------------------------------------

// Hidden accessor key used to inherit the previous scope's secret store on
// acquisition (so secrets seeded once outside tests — e.g. from tailor.config.ts
// via setup.ts — remain visible) while still isolating per-test overrides.
const SECRET_STORE = Symbol("tailorSecretStore");

/**
 * Acquire a disposable mock for `tailor.secretmanager`. The secret store is
 * inherited (cloned) from the currently-installed mock on acquisition and
 * restored on dispose, so secrets seeded outside the test survive across
 * `using` scopes while per-test `setSecrets()` overrides stay isolated.
 * @returns Disposable SecretManager mock control object
 * @example
 * ```typescript
 * import { mockSecretmanager } from "@tailor-platform/sdk/vitest";
 *
 * test("reads secrets from vault", async () => {
 *   using sm = mockSecretmanager();
 *   sm.setSecrets({ "my-vault": { API_KEY: "sk-123" } });
 *   // …
 * });
 * ```
 */
export function mockSecretmanager() {
  const root = tailorRoot();
  const prev = root.secretmanager;

  const holder: { store: Record<string, Record<string, string>> } = {
    store: structuredClone((prev?.[SECRET_STORE]?.store as typeof holder.store) ?? {}),
  };

  const getSecret = vi.fn(
    async (vault: string, name: string): Promise<string | undefined> => holder.store[vault]?.[name],
  );
  const getSecrets = vi.fn(
    async <const T extends readonly string[]>(
      vault: string,
      names: T,
    ): Promise<Partial<Record<T[number], string>>> => {
      const vaultData = holder.store[vault] ?? {};
      const result: Record<string, string> = {};
      for (const name of names) {
        if (name in vaultData) {
          result[name] = vaultData[name];
        }
      }
      return result as Partial<Record<T[number], string>>;
    },
  );

  root.secretmanager = { getSecret, getSecrets, [SECRET_STORE]: holder };

  const facade = {
    /** The `getSecret` `vi.fn`. */
    getSecret,
    /** The `getSecrets` `vi.fn`. */
    getSecrets,

    setSecrets(secrets: Record<string, Record<string, string>>): void {
      holder.store = secrets;
    },

    get calls(): SecretCall[] {
      // Merge both methods' calls back into chronological order via vi.fn's
      // global invocationCallOrder, so a test mixing getSecret/getSecrets sees
      // them in the order they actually ran (not all getSecret, then all getSecrets).
      const entries: { order: number; call: SecretCall }[] = [
        ...getSecret.mock.calls.map((args, i) => ({
          order: getSecret.mock.invocationCallOrder[i] ?? 0,
          call: { method: "getSecret" as const, vault: args[0] as string, name: args[1] as string },
        })),
        ...getSecrets.mock.calls.map((args, i) => ({
          order: getSecrets.mock.invocationCallOrder[i] ?? 0,
          call: {
            method: "getSecrets" as const,
            vault: args[0] as string,
            names: args[1] as readonly string[],
          },
        })),
      ];
      return entries.sort((a, b) => a.order - b.order).map((e) => e.call);
    },

    reset(): void {
      holder.store = {};
      getSecret.mockClear();
      getSecrets.mockClear();
    },
  };

  return withDispose(facade, () => {
    root.secretmanager = prev;
  });
}

// ---------------------------------------------------------------------------
// AuthConnection Mock
// ---------------------------------------------------------------------------

/**
 * Acquire a disposable mock for `tailor.authconnection`. Restored on dispose.
 * @returns Disposable AuthConnection mock control object
 * @example
 * ```typescript
 * import { mockAuthconnection } from "@tailor-platform/sdk/vitest";
 *
 * test("returns configured token", async () => {
 *   using ac = mockAuthconnection();
 *   ac.setTokens({ google: { access_token: "ya29.xxx" } });
 *   // …
 * });
 * ```
 */
export function mockAuthconnection() {
  const root = tailorRoot();
  const prev = root.authconnection;

  let tokens: Record<string, unknown> = {};
  const getConnectionToken = vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (connectionName: string): Promise<any> =>
      tokens[connectionName] ?? { access_token: "mock-token" },
  );

  root.authconnection = { getConnectionToken };

  const facade = {
    /** The `getConnectionToken` `vi.fn`. */
    getConnectionToken,

    setTokens(value: Record<string, unknown>): void {
      tokens = value;
    },

    get calls(): AuthConnectionCall[] {
      return getConnectionToken.mock.calls.map(([connectionName]) => ({
        connectionName: connectionName as string,
      }));
    },

    reset(): void {
      tokens = {};
      getConnectionToken.mockClear();
    },
  };

  return withDispose(facade, () => {
    root.authconnection = prev;
  });
}

// ---------------------------------------------------------------------------
// IDP Mock
// ---------------------------------------------------------------------------

const IDP_DEFAULTS: Record<string, unknown> = {
  users: { users: [], nextPageToken: null, totalCount: 0 },
  user: { id: "mock-id", name: "mock-user", disabled: false },
  userByName: { id: "mock-id", name: "mock-user", disabled: false },
  createUser: { id: "mock-id", name: "mock-user", disabled: false },
  updateUser: { id: "mock-id", name: "mock-user", disabled: false },
  deleteUser: true,
  sendPasswordResetEmail: true,
};

/**
 * Acquire a disposable mock for `tailor.idp`. Restored on dispose.
 * @returns Disposable IDP mock control object
 * @example
 * ```typescript
 * import { mockIdp } from "@tailor-platform/sdk/vitest";
 *
 * test("resolver-based", async () => {
 *   using idp = mockIdp();
 *   idp.setResolver((method) =>
 *     method === "user" ? { id: "u-1", name: "alice", disabled: false } : null,
 *   );
 *   // …
 * });
 * ```
 */
export function mockIdp() {
  const root = tailorRoot();
  const prev = root.idp;

  const queue: unknown[] = [];
  let resolver: IdpResolver = () => null;
  const calls: IdpCall[] = [];

  function handle(method: string, args: unknown[], namespace: string): unknown {
    calls.push({ method, args, namespace });
    if (queue.length > 0) return queue.shift();
    const resolved = resolver(method, args, namespace);
    // Treat null and undefined alike as "no override".
    if (resolved != null) return resolved;
    // Clone the default so a test mutating the returned value cannot corrupt
    // the shared module-level object for subsequent tests.
    const fallback = IDP_DEFAULTS[method];
    return fallback === undefined ? undefined : structuredClone(fallback);
  }

  const Client = vi.fn(function (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this: any,
    config: { namespace: string },
  ) {
    const namespace = config.namespace;
    this.users = async (options?: unknown) => handle("users", [options], namespace);
    this.user = async (userId: string) => handle("user", [userId], namespace);
    this.userByName = async (name: string) => handle("userByName", [name], namespace);
    this.createUser = async (input: unknown) => handle("createUser", [input], namespace);
    this.updateUser = async (input: unknown) => handle("updateUser", [input], namespace);
    this.deleteUser = async (userId: string) => handle("deleteUser", [userId], namespace);
    this.sendPasswordResetEmail = async (input: unknown) =>
      handle("sendPasswordResetEmail", [input], namespace);
  }) as unknown as new (config: { namespace: string }) => {
    users(options?: {
      first?: number;
      after?: string;
      query?: { ids?: string[]; names?: string[] };
    }): Promise<{ users: IdpUser[]; nextPageToken: string | null; totalCount: number }>;
    user(userId: string): Promise<IdpUser>;
    userByName(name: string): Promise<IdpUser>;
    createUser(input: { name: string; password?: string; disabled?: boolean }): Promise<IdpUser>;
    updateUser(input: {
      id: string;
      name?: string;
      password?: string;
      clearPassword?: boolean;
      disabled?: boolean;
    }): Promise<IdpUser>;
    deleteUser(userId: string): Promise<boolean>;
    sendPasswordResetEmail(input: { userId: string; redirectUri: string }): Promise<boolean>;
  };

  root.idp = { Client };

  const facade = {
    /** The mock IDP `Client` constructor (`vi.fn`). */
    Client: Client as unknown as Mock,

    setResolver(value: IdpResolver): void {
      resolver = value;
    },

    /**
     * Enqueue a single result for the next IDP call (FIFO; falls back to
     * `setResolver` when exhausted).
     * @param result - Result to return from the next IDP call
     */
    enqueueResult(result: unknown): void {
      queue.push(result);
    },

    /**
     * Enqueue results for multiple subsequent IDP calls.
     * @param results - Results to enqueue, one per upcoming call
     */
    enqueueResults(...results: unknown[]): void {
      queue.push(...results);
    },

    get calls(): IdpCall[] {
      return calls;
    },

    reset(): void {
      queue.length = 0;
      resolver = () => null;
      calls.length = 0;
    },
  };

  return withDispose(facade, () => {
    root.idp = prev;
  });
}

// ---------------------------------------------------------------------------
// Iconv Mock
// ---------------------------------------------------------------------------

// Iconv methods return `string` for UTF-8 target encodings and `Uint8Array`
// for any other byte-producing encoding (the platform API mirrors this).
function isUtf8(encoding: unknown): boolean {
  return encoding === "UTF8" || encoding === "UTF-8";
}

function defaultIconvResult(method: string, args: unknown[]): unknown {
  switch (method) {
    case "convert":
    case "convertBuffer":
      return isUtf8(args[2]) ? "" : new Uint8Array();
    case "decode":
      return "";
    case "encode":
      return isUtf8(args[1]) ? "" : new Uint8Array();
    case "encodings":
      return [];
    default:
      return undefined;
  }
}

/**
 * Acquire a disposable mock for `tailor.iconv`. Restored on dispose.
 * @returns Disposable Iconv mock control object
 * @example
 * ```typescript
 * import { mockIconv } from "@tailor-platform/sdk/vitest";
 *
 * test("mock encoding conversion", () => {
 *   using iconv = mockIconv();
 *   iconv.setResolver((method) => (method === "decode" ? "decoded-text" : null));
 *   // …
 * });
 * ```
 */
export function mockIconv() {
  const root = tailorRoot();
  const prev = root.iconv;

  let resolver: IconvResolver | null = null;
  const calls: IconvCall[] = [];

  function handle(method: string, args: unknown[]): unknown {
    calls.push({ method, args: [...args] });
    if (resolver) {
      const result = resolver(method, args);
      if (result != null) return result;
    }
    return defaultIconvResult(method, args);
  }

  class MockIconv {
    #fromEncoding: string;
    #toEncoding: string;
    constructor(fromEncoding: string, toEncoding: string) {
      this.#fromEncoding = fromEncoding;
      this.#toEncoding = toEncoding;
    }
    convert(input: string | Uint8Array | ArrayBuffer): string | Uint8Array {
      return handle("convert", [input, this.#fromEncoding, this.#toEncoding]) as
        | string
        | Uint8Array;
    }
  }

  root.iconv = {
    convert: (str: unknown, from: string, to: string) => handle("convert", [str, from, to]),
    convertBuffer: (buf: unknown, from: string, to: string) =>
      handle("convertBuffer", [buf, from, to]),
    decode: (buf: unknown, encoding: string) => handle("decode", [buf, encoding]),
    encode: (str: string, encoding: string) => handle("encode", [str, encoding]),
    encodings: () => handle("encodings", []),
    Iconv: MockIconv,
  };

  const facade = {
    setResolver(value: IconvResolver): void {
      resolver = value;
    },

    get calls(): IconvCall[] {
      return calls;
    },

    reset(): void {
      resolver = null;
      calls.length = 0;
    },
  };

  return withDispose(facade, () => {
    root.iconv = prev;
  });
}

// ---------------------------------------------------------------------------
// File Mock (tailordb.file)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FILE_DEFAULTS: Record<string, any> = {
  upload: { metadata: { fileSize: 0, sha256sum: "" } },
  download: {
    data: new Uint8Array(),
    metadata: { contentType: "", fileSize: 0, sha256sum: "", lastUploadedAt: "" },
  },
  downloadAsBase64: {
    data: "",
    metadata: { contentType: "", fileSize: 0, sha256sum: "", lastUploadedAt: "" },
  },
  delete: undefined,
  getMetadata: { contentType: "", fileSize: 0, sha256sum: "", urlPath: "" },
  downloadStream: null,
  uploadStream: { metadata: { fileSize: 0, sha256sum: "" } },
};

type FileStream = AsyncIterableIterator<unknown> & { close(): Promise<void> };

function toFileStream(value: unknown): FileStream {
  if (
    value !== null &&
    typeof value === "object" &&
    Symbol.asyncIterator in value &&
    typeof (value as { close?: unknown }).close === "function"
  ) {
    return value as FileStream;
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    throw new TypeError(
      "mockFile.openDownloadStream expects an iterable of StreamValue items " +
        '(e.g. [{ type: "chunk", data, position }, { type: "complete" }]); ' +
        "got raw bytes. Wrap the bytes in a structured chunk first.",
    );
  }
  if (
    value !== null &&
    typeof value === "object" &&
    (Symbol.iterator in value || Symbol.asyncIterator in value)
  ) {
    const source = value as Iterable<unknown> | AsyncIterable<unknown>;
    const inner =
      Symbol.asyncIterator in source
        ? (source as AsyncIterable<unknown>)[Symbol.asyncIterator]()
        : (source as Iterable<unknown>)[Symbol.iterator]();
    const stream: FileStream = {
      async next() {
        const r = await inner.next();
        if (!r.done) {
          assertStreamValue(r.value);
        }
        return r.done ? { done: true as const, value: undefined } : r;
      },
      async close() {},
      [Symbol.asyncIterator]() {
        return stream;
      },
    };
    return stream;
  }
  const empty: FileStream = {
    async next() {
      return { done: true as const, value: undefined };
    },
    async close() {},
    [Symbol.asyncIterator]() {
      return empty;
    },
  };
  return empty;
}

function assertStreamValue(v: unknown): void {
  if (v === null || typeof v !== "object") {
    throw new TypeError(
      'mockFile.openDownloadStream expected a StreamValue item ({ type: "metadata" | "chunk" | "complete", ... }); ' +
        `got ${typeof v === "object" ? "null" : typeof v}.`,
    );
  }
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
    throw new TypeError(
      "mockFile.openDownloadStream expected a StreamValue item, got raw bytes. " +
        'Wrap the bytes in a structured chunk first (e.g. { type: "chunk", data, position }).',
    );
  }
  const type = (v as { type?: unknown }).type;
  if (type !== "metadata" && type !== "chunk" && type !== "complete") {
    throw new TypeError(
      'mockFile.openDownloadStream expected a StreamValue item with type "metadata" | "chunk" | "complete"; ' +
        `got ${JSON.stringify(type)}.`,
    );
  }
}

/**
 * Acquire a disposable mock for `tailordb.file`. Restored on dispose.
 * @returns Disposable File mock control object
 * @example
 * ```typescript
 * import { mockFile } from "@tailor-platform/sdk/vitest";
 *
 * test("mock file download", async () => {
 *   using file = mockFile();
 *   file.enqueueResult({ data: new Uint8Array([1, 2, 3]), metadata: { ... } });
 *   // …
 * });
 * ```
 */
export function mockFile() {
  const root = tailordbRoot();
  const prev = root.file;

  const queue: unknown[] = [];
  let resolver: FileResolver = () => null;
  const calls: FileCall[] = [];

  function handle(
    method: string,
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
  ): unknown {
    const call: FileCall = { method, namespace, typeName, fieldName, recordId };
    calls.push(call);
    if (queue.length > 0) return queue.shift();
    const resolved = resolver(method, call);
    if (resolved != null) return resolved;
    const fallback = FILE_DEFAULTS[method];
    return fallback === undefined ? undefined : structuredClone(fallback);
  }

  root.file = {
    async upload(namespace: string, typeName: string, fieldName: string, recordId: string) {
      return handle("upload", namespace, typeName, fieldName, recordId);
    },
    async download(namespace: string, typeName: string, fieldName: string, recordId: string) {
      return handle("download", namespace, typeName, fieldName, recordId);
    },
    async downloadAsBase64(
      namespace: string,
      typeName: string,
      fieldName: string,
      recordId: string,
    ) {
      return handle("downloadAsBase64", namespace, typeName, fieldName, recordId);
    },
    async delete(namespace: string, typeName: string, fieldName: string, recordId: string) {
      handle("delete", namespace, typeName, fieldName, recordId);
    },
    async getMetadata(namespace: string, typeName: string, fieldName: string, recordId: string) {
      return handle("getMetadata", namespace, typeName, fieldName, recordId);
    },
    async openDownloadStream(
      namespace: string,
      typeName: string,
      fieldName: string,
      recordId: string,
    ) {
      return toFileStream(handle("openDownloadStream", namespace, typeName, fieldName, recordId));
    },
    async downloadStream(namespace: string, typeName: string, fieldName: string, recordId: string) {
      const resolved = handle("downloadStream", namespace, typeName, fieldName, recordId);
      if (resolved != null) return resolved;
      return {
        body: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        metadata: { contentType: "", fileSize: 0, sha256sum: "", lastUploadedAt: "" },
      };
    },
    async uploadStream(namespace: string, typeName: string, fieldName: string, recordId: string) {
      return handle("uploadStream", namespace, typeName, fieldName, recordId);
    },
  };

  const facade = {
    setResolver(value: FileResolver): void {
      resolver = value;
    },

    /**
     * Enqueue a single result for the next `tailordb.file` call (FIFO; falls
     * back to `setResolver` when exhausted).
     * @param result - Result to return from the next file call
     */
    enqueueResult(result: unknown): void {
      queue.push(result);
    },

    /**
     * Enqueue results for multiple subsequent `tailordb.file` calls.
     * @param results - Results to enqueue, one per upcoming call
     */
    enqueueResults(...results: unknown[]): void {
      queue.push(...results);
    },

    get calls(): FileCall[] {
      return calls;
    },

    reset(): void {
      queue.length = 0;
      resolver = () => null;
      calls.length = 0;
    },
  };

  return withDispose(facade, () => {
    root.file = prev;
  });
}
