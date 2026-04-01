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

export const STATE_KEY = "__tailorMockState";

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
 *   tailordbMock.enqueueResult();           // BEGIN (empty result)
 *   tailordbMock.enqueueResult({ age: 30 }); // SELECT (one row)
 *   tailordbMock.enqueueResult();           // COMMIT (empty result)
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
   * Enqueue a single query response. Arguments are the row objects returned by `queryObject`.
   * Call with no arguments for an empty result. Consumed in FIFO order; when the queue is
   * exhausted, subsequent calls fall back to `setQueryResolver` (default: empty rows).
   * @param rows - Row objects to return from the next `queryObject` call
   */
  enqueueResult(...rows: unknown[]): void {
    getState().queryResultQueue.push(rows);
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
// Mock: tailor.workflow
// ---------------------------------------------------------------------------

function mockTriggerJobFunction(jobName: string, args?: unknown): unknown {
  const state = getState();
  state.triggeredJobs.push({ jobName, args });
  if (state.jobResultQueue.length > 0) return state.jobResultQueue.shift();
  return state.jobHandler(jobName, args);
}

async function mockTriggerWorkflow(
  _workflowName: string,
  _args?: unknown,
  _options?: { authInvoker?: { namespace: string; machineUserName: string } },
): Promise<string> {
  return "mock-execution-id";
}

function mockWait(_key: string, _payload?: unknown): unknown {
  return null;
}

async function mockResolve(
  _executionId: string,
  _key: string,
  _callback: (payload: unknown) => unknown | Promise<unknown>,
): Promise<void> {
  /* noop */
}

// ---------------------------------------------------------------------------
// Mock: tailor.secretmanager
// ---------------------------------------------------------------------------

async function mockGetSecrets<const T extends readonly string[]>(
  _vault: string,
  _names: T,
): Promise<Partial<Record<T[number], string>>> {
  return {} as Partial<Record<T[number], string>>;
}

async function mockGetSecret(_vault: string, _name: string): Promise<string | undefined> {
  return undefined;
}

// ---------------------------------------------------------------------------
// Mock: tailor.authconnection
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mockGetConnectionToken(_connectionName: string): Promise<any> {
  return { access_token: "mock-token" };
}

// ---------------------------------------------------------------------------
// Mock: tailor.idp
// ---------------------------------------------------------------------------

class MockIdpClient {
  constructor(_config: { namespace: string }) {}

  async users(_options?: {
    first?: number;
    after?: string;
    query?: { ids?: string[]; names?: string[] };
  }): Promise<{ users: tailor.idp.User[]; nextPageToken: string | null; totalCount: number }> {
    return { users: [], nextPageToken: null, totalCount: 0 };
  }

  async user(_userId: string): Promise<tailor.idp.User> {
    return { id: "mock-id", name: "mock-user", disabled: false };
  }

  async userByName(_name: string): Promise<tailor.idp.User> {
    return { id: "mock-id", name: "mock-user", disabled: false };
  }

  async createUser(_input: {
    name: string;
    password?: string;
    disabled?: boolean;
  }): Promise<tailor.idp.User> {
    return { id: "mock-id", name: "mock-user", disabled: false };
  }

  async updateUser(_input: {
    id: string;
    name?: string;
    password?: string;
    clearPassword?: boolean;
    disabled?: boolean;
  }): Promise<tailor.idp.User> {
    return { id: "mock-id", name: "mock-user", disabled: false };
  }

  async deleteUser(_userId: string): Promise<boolean> {
    return true;
  }

  async sendPasswordResetEmail(_input: { userId: string; redirectUri: string }): Promise<boolean> {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Mock: tailor.iconv
// ---------------------------------------------------------------------------

function mockConvert<T extends string>(
  _str: string | Uint8Array | ArrayBuffer,
  _fromEncoding: string,
  _toEncoding: T,
): T extends "UTF8" | "UTF-8" ? string : Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return "" as any;
}

function mockConvertBuffer<T extends string>(
  _buffer: Uint8Array | ArrayBuffer,
  _fromEncoding: string,
  _toEncoding: T,
): T extends "UTF8" | "UTF-8" ? string : Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return "" as any;
}

function mockDecode(_buffer: Uint8Array | ArrayBuffer, _encoding: string): string {
  return "";
}

function mockEncode<T extends string>(
  _str: string,
  _encoding: T,
): T extends "UTF8" | "UTF-8" ? string : Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return "" as any;
}

function mockEncodings(): string[] {
  return [];
}

class MockIconv {
  constructor(_fromEncoding: string, _toEncoding: string) {}

  convert(_input: string | Uint8Array | ArrayBuffer): string | Uint8Array {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Mock: tailordb.file
// ---------------------------------------------------------------------------

const mockTailordbFile = {
  async upload(
    _namespace: string,
    _typeName: string,
    _fieldName: string,
    _recordId: string,
    _data: string | ArrayBuffer | Uint8Array | number[],
    _options?: { contentType?: string },
  ): Promise<{ metadata: { fileSize: number; sha256sum: string } }> {
    return { metadata: { fileSize: 0, sha256sum: "" } };
  },

  async download(
    _namespace: string,
    _typeName: string,
    _fieldName: string,
    _recordId: string,
  ): Promise<{
    data: Uint8Array;
    metadata: { contentType: string; fileSize: number; sha256sum: string; lastUploadedAt: string };
  }> {
    return {
      data: new Uint8Array(),
      metadata: { contentType: "", fileSize: 0, sha256sum: "", lastUploadedAt: "" },
    };
  },

  async downloadAsBase64(
    _namespace: string,
    _typeName: string,
    _fieldName: string,
    _recordId: string,
  ): Promise<{
    data: string;
    metadata: { contentType: string; fileSize: number; sha256sum: string; lastUploadedAt: string };
  }> {
    return {
      data: "",
      metadata: { contentType: "", fileSize: 0, sha256sum: "", lastUploadedAt: "" },
    };
  },

  async delete(
    _namespace: string,
    _typeName: string,
    _fieldName: string,
    _recordId: string,
  ): Promise<void> {
    /* noop */
  },

  async getMetadata(
    _namespace: string,
    _typeName: string,
    _fieldName: string,
    _recordId: string,
  ): Promise<{
    contentType: string;
    fileSize: number;
    sha256sum: string;
    urlPath: string;
    lastUploadedAt?: string;
  }> {
    return { contentType: "", fileSize: 0, sha256sum: "", urlPath: "" };
  },

  openDownloadStream(
    _namespace: string,
    _typeName: string,
    _fieldName: string,
    _recordId: string,
  ): Promise<AsyncIterableIterator<unknown> & { close(): Promise<void> }> {
    const iterator: AsyncIterableIterator<unknown> & { close(): Promise<void> } = {
      async next() {
        return { done: true as const, value: undefined };
      },
      async close() {},
      [Symbol.asyncIterator]() {
        return iterator;
      },
    };
    return Promise.resolve(iterator);
  },
};

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
  code?: string;
  override cause: unknown;

  constructor(message: string, code?: string, cause?: unknown) {
    super(message);
    this.name = "TailorDBFileError";
    this.code = code;
    this.cause = cause;
  }
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
    file: mockTailordbFile,
  };

  g.tailor = {
    secretmanager: {
      getSecrets: mockGetSecrets,
      getSecret: mockGetSecret,
    },
    authconnection: {
      getConnectionToken: mockGetConnectionToken,
    },
    workflow: {
      triggerJobFunction: mockTriggerJobFunction,
      triggerWorkflow: mockTriggerWorkflow,
      wait: mockWait,
      resolve: mockResolve,
    },
    idp: { Client: MockIdpClient },
    iconv: {
      convert: mockConvert,
      convertBuffer: mockConvertBuffer,
      decode: mockDecode,
      encode: mockEncode,
      encodings: mockEncodings,
      Iconv: MockIconv,
    },
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
