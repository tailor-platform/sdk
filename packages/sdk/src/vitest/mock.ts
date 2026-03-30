/**
 * Mock implementations for Tailor Platform APIs.
 *
 * Provides singleton mock objects that are automatically injected into
 * globalThis by the tailor-runtime Vitest environment. Tests can configure
 * responses and assert on recorded calls via the exported mock objects.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QueryResolver = (query: string, params: unknown[]) => unknown[];
type JobHandler = (jobName: string, args: unknown) => unknown;

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

interface MockState {
  // TailorDB
  queryResolver: QueryResolver;
  queryResultQueue: unknown[][];
  executedQueries: ExecutedQuery[];
  createdClients: CreatedClient[];
  // Workflow
  jobHandler: JobHandler;
  jobResultQueue: unknown[];
  triggeredJobs: TriggeredJob[];
}

// ---------------------------------------------------------------------------
// State management (shared via globalThis for environment/test interop)
// ---------------------------------------------------------------------------

const STATE_KEY = "__tailorMockState";

function getState(): MockState {
  const g = globalThis as Record<string, unknown>;
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = createDefaultState();
  }
  return g[STATE_KEY] as MockState;
}

function createDefaultState(): MockState {
  return {
    queryResolver: () => [],
    queryResultQueue: [],
    executedQueries: [],
    createdClients: [],
    jobHandler: () => null,
    jobResultQueue: [],
    triggeredJobs: [],
  };
}

// ---------------------------------------------------------------------------
// TailorDB Mock
// ---------------------------------------------------------------------------

/**
 * Mock control object for TailorDB operations.
 *
 * Automatically injected into `globalThis.tailordb` by the tailor-runtime environment.
 * Use this object to configure query responses and assert on executed queries.
 * @example
 * ```typescript
 * import { tailordbMock } from "@tailor-platform/sdk/vitest";
 *
 * beforeEach(() => tailordbMock.reset());
 *
 * test("content-based", () => {
 *   tailordbMock.setQueryResolver((query) => {
 *     if (query.includes("SELECT")) return [{ id: "1" }];
 *     return [];
 *   });
 * });
 *
 * test("order-based", () => {
 *   tailordbMock.enqueueResult(
 *     [],           // BEGIN
 *     [{ age: 30 }], // SELECT
 *     [],           // COMMIT
 *   );
 * });
 * ```
 */
export const tailordbMock = {
  /**
   * Set a fallback query resolver. Called when the result queue is empty.
   * @param resolver
   */
  setQueryResolver(resolver: QueryResolver): void {
    getState().queryResolver = resolver;
  },

  /**
   * Enqueue results to be returned by subsequent `queryObject` calls.
   * Each argument becomes one response, consumed in FIFO order before falling back to the query resolver.
   * @param results - One or more row arrays to enqueue
   */
  enqueueResult(...results: unknown[][]): void {
    const queue = getState().queryResultQueue;
    for (const rows of results) {
      queue.push(rows);
    }
  },

  /**
   * All queries executed via `queryObject`, in order.
   * @returns Executed queries array
   */
  get executedQueries(): ExecutedQuery[] {
    return getState().executedQueries;
  },

  /**
   * All TailorDB clients created, with their namespace and end state.
   * @returns Created clients array
   */
  get createdClients(): CreatedClient[] {
    return getState().createdClients;
  },

  /** Reset all TailorDB mock state. Call in `beforeEach`. */
  reset(): void {
    const state = getState();
    state.queryResolver = () => [];
    state.queryResultQueue.length = 0;
    state.executedQueries.length = 0;
    state.createdClients.length = 0;
  },
};

// ---------------------------------------------------------------------------
// Workflow Mock
// ---------------------------------------------------------------------------

/**
 * Mock control object for workflow operations.
 *
 * Automatically injected into `globalThis.tailor.workflow` by the tailor-runtime environment.
 * @example
 * ```typescript
 * import { workflowMock } from "@tailor-platform/sdk/vitest";
 *
 * beforeEach(() => workflowMock.reset());
 *
 * test("job handler", () => {
 *   workflowMock.setJobHandler((jobName, args) => {
 *     if (jobName === "validate") return { valid: true };
 *     return null;
 *   });
 * });
 *
 * test("ordered results", () => {
 *   workflowMock.enqueueResult({ valid: true }, { txnId: "txn-1" });
 * });
 * ```
 */
export const workflowMock = {
  /**
   * Set a fallback job handler. Called when the result queue is empty.
   * @param handler
   */
  setJobHandler(handler: JobHandler): void {
    getState().jobHandler = handler;
  },

  /**
   * Enqueue results to be returned by subsequent `triggerJobFunction` calls.
   * Each argument becomes one response, consumed in FIFO order before falling back to the job handler.
   * @param results - One or more results to enqueue
   */
  enqueueResult(...results: unknown[]): void {
    const queue = getState().jobResultQueue;
    for (const result of results) {
      queue.push(result);
    }
  },

  /**
   * All jobs triggered via `triggerJobFunction`, in order.
   * @returns Triggered jobs array
   */
  get triggeredJobs(): TriggeredJob[] {
    return getState().triggeredJobs;
  },

  /** Reset all workflow mock state. Call in `beforeEach`. */
  reset(): void {
    const state = getState();
    state.jobHandler = () => null;
    state.jobResultQueue.length = 0;
    state.triggeredJobs.length = 0;
  },
};

// ---------------------------------------------------------------------------
// Mock Client implementation (injected as globalThis.tailordb.Client)
// ---------------------------------------------------------------------------

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

class MockTransaction {
  constructor(_connectionId: string) {
    // connectionId reserved for future use
  }

  async begin(): Promise<void> {
    /* noop */
  }
  async commit(): Promise<void> {
    /* noop */
  }
  async rollback(): Promise<void> {
    /* noop */
  }

  async queryObject(query: string, params: unknown[] = []): Promise<MockQueryResult> {
    return resolveQuery(query, params);
  }
}

class MockTailordbClient {
  #namespace: string | undefined;
  #record: CreatedClient;
  #connectionId: string;

  constructor(config?: { namespace?: string }) {
    this.#namespace = config?.namespace;
    this.#record = { namespace: this.#namespace, ended: false };
    this.#connectionId = `mock-${Math.random().toString(36).slice(2)}`;
    getState().createdClients.push(this.#record);
  }

  async connect(): Promise<void> {
    /* noop */
  }

  async end(): Promise<void> {
    this.#record.ended = true;
  }

  async queryObject(query: string, params: unknown[] = []): Promise<MockQueryResult> {
    return resolveQuery(query, params);
  }

  createTransaction(name: string): MockTransaction {
    if (!name) {
      throw new Error("Transaction name must be a non-empty string");
    }
    return new MockTransaction(this.#connectionId);
  }
}

function resolveQuery(query: string, params: unknown[]): MockQueryResult {
  const state = getState();
  state.executedQueries.push({ query, params });

  // 1. Queue takes priority (order-based)
  if (state.queryResultQueue.length > 0) {
    return new MockQueryResult(state.queryResultQueue.shift()!);
  }

  // 2. Fallback to query resolver (content-based)
  const rows = state.queryResolver(query, params) ?? [];
  return new MockQueryResult(rows);
}

// ---------------------------------------------------------------------------
// Mock triggerJobFunction (injected as globalThis.tailor.workflow.triggerJobFunction)
// ---------------------------------------------------------------------------

function mockTriggerJobFunction(jobName: string, args: unknown): unknown {
  const state = getState();
  state.triggeredJobs.push({ jobName, args });

  if (state.jobResultQueue.length > 0) {
    return state.jobResultQueue.shift();
  }
  return state.jobHandler(jobName, args);
}

// ---------------------------------------------------------------------------
// Error class mocks
// ---------------------------------------------------------------------------

interface TailorErrorItem {
  message: string;
  path: (string | number)[];
}

class TailorErrorsMock extends Error {
  errors: TailorErrorItem[];

  constructor(errors: TailorErrorItem[]) {
    if (!Array.isArray(errors)) {
      throw new TypeError("TailorErrors: errors must be an array");
    }
    const validated = errors.map((e, i) => {
      if (typeof e.message !== "string") {
        throw new TypeError(`TailorErrors: errors[${i}].message must be a string`);
      }
      if (!Array.isArray(e.path)) {
        throw new TypeError(`TailorErrors: errors[${i}].path must be an array`);
      }
      return { message: e.message, path: e.path };
    });
    super(JSON.stringify({ errors: validated }));
    this.name = "TailorErrors";
    this.errors = validated;
  }
}

class TailorErrorMessageMock extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TailorErrorMessage";
  }
}

class TailorDBFileErrorMock extends Error {
  code: string;
  override cause: Error | undefined;

  constructor(message: string, code: string, cause?: Error) {
    super(message);
    this.name = "TailorDBFileError";
    this.code = code;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Proxy for unimplemented platform APIs
// ---------------------------------------------------------------------------

function notImplementedProxy(name: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "symbol") return undefined;
        throw new Error(`${name}.${prop} is not implemented in the test environment.`);
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Injection / Cleanup (called by environment.ts)
// ---------------------------------------------------------------------------

/**
 * Inject all platform API mocks into globalThis.
 * Called by the tailor-runtime Vitest environment during setup.
 * @param global
 */
export function injectMocks(global: typeof globalThis): void {
  const g = global as Record<string, unknown>;

  // Ensure fresh state
  g[STATE_KEY] = createDefaultState();

  g.tailordb = {
    Client: MockTailordbClient,
    file: notImplementedProxy("tailordb.file"),
  };

  g.tailor = {
    secretmanager: notImplementedProxy("tailor.secretmanager"),
    authconnection: notImplementedProxy("tailor.authconnection"),
    workflow: {
      triggerJobFunction: mockTriggerJobFunction,
      triggerWorkflow: notImplementedProxy("tailor.workflow.triggerWorkflow"),
      wait: notImplementedProxy("tailor.workflow.wait"),
      resolve: notImplementedProxy("tailor.workflow.resolve"),
    },
    idp: { Client: notImplementedProxy("tailor.idp.Client") },
    iconv: notImplementedProxy("tailor.iconv"),
  };

  g.TailorErrors = TailorErrorsMock;
  g.TailorErrorMessage = TailorErrorMessageMock;
  g.TailorDBFileError = TailorDBFileErrorMock;
}

/**
 * Remove all injected mocks from globalThis.
 * Called by the tailor-runtime Vitest environment during teardown.
 * @param global
 */
export function cleanupMocks(global: typeof globalThis): void {
  const g = global as Record<string, unknown>;
  delete g.tailordb;
  delete g.tailor;
  delete g.TailorErrors;
  delete g.TailorErrorMessage;
  delete g.TailorDBFileError;
  delete g[STATE_KEY];
}
