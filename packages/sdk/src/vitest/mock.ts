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
type IdpResolver = (method: string, args: unknown[], namespace: string) => unknown;
type FileResolver = (method: string, call: FileCall) => unknown;
type IconvResolver = (method: string, args: unknown[]) => unknown;

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

interface WorkflowCall {
  method: "triggerWorkflow" | "wait" | "resolve";
  args: unknown[];
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
  workflowExecutionId: string;
  waitResult: unknown;
  workflowCalls: WorkflowCall[];
  // SecretManager
  secretStore: Record<string, Record<string, string>>;
  secretCalls: SecretCall[];
  // AuthConnection
  authTokens: Record<string, unknown>;
  authCalls: AuthConnectionCall[];
  // IDP
  idpResolver: IdpResolver;
  idpResultQueue: unknown[];
  idpCalls: IdpCall[];
  // File
  fileResolver: FileResolver;
  fileResultQueue: unknown[];
  fileCalls: FileCall[];
  // Iconv
  iconvResolver: IconvResolver | null;
  iconvCalls: IconvCall[];
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
    workflowExecutionId: "mock-execution-id",
    waitResult: null,
    workflowCalls: [],
    secretStore: {},
    secretCalls: [],
    authTokens: {},
    authCalls: [],
    idpResolver: () => null,
    idpResultQueue: [],
    idpCalls: [],
    fileResolver: () => null,
    fileResultQueue: [],
    fileCalls: [],
    iconvResolver: null,
    iconvCalls: [],
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
 *   tailordbMock.enqueueResults(
 *     [],            // BEGIN (empty result)
 *     [{ age: 30 }], // SELECT (one row)
 *     [],            // COMMIT (empty result)
 *   );
 * });
 * ```
 */
export const tailordbMock = {
  /**
   * Set a fallback query resolver. Called when the result queue is empty.
   * @param resolver - Function that returns rows for a given query and params
   */
  setQueryResolver(resolver: QueryResolver): void {
    getState().queryResolver = resolver;
  },

  /**
   * Enqueue rows for the next `queryObject` call. Arguments are the row objects returned
   * by that single query. Call with no arguments for an empty result. Consumed in FIFO
   * order; when the queue is exhausted, subsequent calls fall back to `setQueryResolver`
   * (default: empty rows). Use `enqueueResults` to stage rows for multiple queries in one
   * call.
   * @param rows - Row objects to return from the next `queryObject` call
   */
  enqueueResult(...rows: unknown[]): void {
    getState().queryResultQueue.push(rows);
  },

  /**
   * Enqueue rows for multiple subsequent `queryObject` calls. Each argument is a rows
   * array for one query, consumed in FIFO order.
   * @param rowsList - Rows arrays, one per upcoming query
   */
  enqueueResults(...rowsList: unknown[][]): void {
    getState().queryResultQueue.push(...rowsList);
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
 *   workflowMock.enqueueResults({ valid: true }, { txnId: "txn-1" });
 * });
 * ```
 */
export const workflowMock = {
  /**
   * Set a fallback job handler. Called when the result queue is empty.
   * @param handler - Function that returns a result for a given job name and args
   */
  setJobHandler(handler: JobHandler): void {
    getState().jobHandler = handler;
  },

  /**
   * Enqueue a single result for the next `triggerJobFunction` call. Consumed in FIFO
   * order; when the queue is exhausted, subsequent calls fall back to `setJobHandler`
   * (default: null). Use `enqueueResults` to stage multiple results in one call.
   * @param result - Result to return from the next `triggerJobFunction` call
   */
  enqueueResult(result: unknown): void {
    getState().jobResultQueue.push(result);
  },

  /**
   * Enqueue results for multiple subsequent `triggerJobFunction` calls.
   * @param results - Results to enqueue, one per upcoming call
   */
  enqueueResults(...results: unknown[]): void {
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

  /**
   * Set the execution ID returned by triggerWorkflow.
   * @param id - Execution ID string
   */
  setWorkflowExecutionId(id: string): void {
    getState().workflowExecutionId = id;
  },

  /**
   * Set the result returned by wait.
   * @param result - Value to return from wait calls
   */
  setWaitResult(result: unknown): void {
    getState().waitResult = result;
  },

  /**
   * Calls to triggerWorkflow, wait, resolve (not triggerJobFunction — use triggeredJobs).
   * @returns Workflow calls array
   */
  get calls(): WorkflowCall[] {
    return getState().workflowCalls;
  },

  /** Reset all workflow mock state. Call in `beforeEach`. */
  reset(): void {
    const state = getState();
    state.jobHandler = () => null;
    state.jobResultQueue.length = 0;
    state.triggeredJobs.length = 0;
    state.workflowExecutionId = "mock-execution-id";
    state.waitResult = null;
    state.workflowCalls.length = 0;
  },
};

// ---------------------------------------------------------------------------
// SecretManager Mock
// ---------------------------------------------------------------------------

/** Mock control for `tailor.secretmanager` — secret store and call recording. */
export const secretmanagerMock = {
  setSecrets(secrets: Record<string, Record<string, string>>): void {
    getState().secretStore = secrets;
  },

  get calls(): SecretCall[] {
    return getState().secretCalls;
  },

  reset(): void {
    const state = getState();
    state.secretStore = {};
    state.secretCalls.length = 0;
  },
};

// ---------------------------------------------------------------------------
// AuthConnection Mock
// ---------------------------------------------------------------------------

/** Mock control for `tailor.authconnection` — token store and call recording. */
export const authconnectionMock = {
  setTokens(tokens: Record<string, unknown>): void {
    getState().authTokens = tokens;
  },

  get calls(): AuthConnectionCall[] {
    return getState().authCalls;
  },

  reset(): void {
    const state = getState();
    state.authTokens = {};
    state.authCalls.length = 0;
  },
};

// ---------------------------------------------------------------------------
// IDP Mock
// ---------------------------------------------------------------------------

/** Mock control for `tailor.idp` — IDP client responses and call recording. */
export const idpMock = {
  setResolver(resolver: IdpResolver): void {
    getState().idpResolver = resolver;
  },

  /**
   * Enqueue a single result for the next IDP call. Consumed in FIFO order; falls back
   * to `setResolver` when exhausted. Use `enqueueResults` to stage multiple in one call.
   * @param result - Result to return from the next IDP call
   */
  enqueueResult(result: unknown): void {
    getState().idpResultQueue.push(result);
  },

  /**
   * Enqueue results for multiple subsequent IDP calls.
   * @param results - Results to enqueue, one per upcoming call
   */
  enqueueResults(...results: unknown[]): void {
    const queue = getState().idpResultQueue;
    for (const result of results) {
      queue.push(result);
    }
  },

  get calls(): IdpCall[] {
    return getState().idpCalls;
  },

  reset(): void {
    const state = getState();
    state.idpResolver = () => null;
    state.idpResultQueue.length = 0;
    state.idpCalls.length = 0;
  },
};

// ---------------------------------------------------------------------------
// File Mock
// ---------------------------------------------------------------------------

/** Mock control for `tailordb.file` — file operation responses and call recording. */
export const fileMock = {
  setResolver(resolver: FileResolver): void {
    getState().fileResolver = resolver;
  },

  /**
   * Enqueue a single result for the next `tailordb.file` call. Consumed in FIFO order;
   * falls back to `setResolver` when exhausted. Use `enqueueResults` to stage multiple
   * in one call.
   * @param result - Result to return from the next file call
   */
  enqueueResult(result: unknown): void {
    getState().fileResultQueue.push(result);
  },

  /**
   * Enqueue results for multiple subsequent `tailordb.file` calls.
   * @param results - Results to enqueue, one per upcoming call
   */
  enqueueResults(...results: unknown[]): void {
    const queue = getState().fileResultQueue;
    for (const result of results) {
      queue.push(result);
    }
  },

  get calls(): FileCall[] {
    return getState().fileCalls;
  },

  reset(): void {
    const state = getState();
    state.fileResolver = () => null;
    state.fileResultQueue.length = 0;
    state.fileCalls.length = 0;
  },
};

// ---------------------------------------------------------------------------
// Iconv Mock
// ---------------------------------------------------------------------------

/** Mock control for `tailor.iconv` — encoding call recording. */
export const iconvMock = {
  setResolver(resolver: IconvResolver): void {
    getState().iconvResolver = resolver;
  },

  get calls(): IconvCall[] {
    return getState().iconvCalls;
  },

  reset(): void {
    const state = getState();
    state.iconvResolver = null;
    state.iconvCalls.length = 0;
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
  workflowName: string,
  args?: unknown,
  options?: { authInvoker?: { namespace: string; machineUserName: string } },
): Promise<string> {
  const state = getState();
  state.workflowCalls.push({ method: "triggerWorkflow", args: [workflowName, args, options] });
  return state.workflowExecutionId;
}

function mockWait(key: string, payload?: unknown): unknown {
  const state = getState();
  state.workflowCalls.push({ method: "wait", args: [key, payload] });
  return state.waitResult;
}

// Records the resolve call but does not invoke the callback. This mirrors
// platform semantics: tailor.workflow.resolve enqueues the callback against
// the wait point and returns immediately; the callback runs only when a
// later wait() consumes the payload. Tests that need to verify callback
// behavior can retrieve it from workflowMock.calls and invoke it directly,
// or use setupWaitPointMock from @tailor-platform/sdk/test for end-to-end
// resolve→wait wiring.
async function mockResolve(
  executionId: string,
  key: string,
  callback: (payload: unknown) => unknown | Promise<unknown>,
): Promise<void> {
  const state = getState();
  state.workflowCalls.push({ method: "resolve", args: [executionId, key, callback] });
}

// ---------------------------------------------------------------------------
// Mock: tailor.context
// ---------------------------------------------------------------------------

function mockGetInvoker(): tailor.context.Invoker | null {
  return null;
}

// ---------------------------------------------------------------------------
// Mock: tailor.secretmanager
// ---------------------------------------------------------------------------

async function mockGetSecrets<const T extends readonly string[]>(
  vault: string,
  names: T,
): Promise<Partial<Record<T[number], string>>> {
  const state = getState();
  state.secretCalls.push({ method: "getSecrets", vault, names });
  const vaultData = state.secretStore[vault] ?? {};
  const result: Record<string, string> = {};
  for (const name of names) {
    if (name in vaultData) {
      result[name] = vaultData[name];
    }
  }
  return result as Partial<Record<T[number], string>>;
}

async function mockGetSecret(vault: string, name: string): Promise<string | undefined> {
  const state = getState();
  state.secretCalls.push({ method: "getSecret", vault, name });
  return state.secretStore[vault]?.[name];
}

// ---------------------------------------------------------------------------
// Mock: tailor.authconnection
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mockGetConnectionToken(connectionName: string): Promise<any> {
  const state = getState();
  state.authCalls.push({ connectionName });
  return state.authTokens[connectionName] ?? { access_token: "mock-token" };
}

// ---------------------------------------------------------------------------
// Mock: tailor.idp
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

function resolveIdpCall(method: string, args: unknown[], namespace: string): unknown {
  const state = getState();
  state.idpCalls.push({ method, args, namespace });
  if (state.idpResultQueue.length > 0) return state.idpResultQueue.shift();
  const resolved = state.idpResolver(method, args, namespace);
  return resolved ?? IDP_DEFAULTS[method];
}

class MockIdpClient {
  #namespace: string;
  constructor(config: { namespace: string }) {
    this.#namespace = config.namespace;
  }
  async users(options?: {
    first?: number;
    after?: string;
    query?: { ids?: string[]; names?: string[] };
  }): Promise<{ users: tailor.idp.User[]; nextPageToken: string | null; totalCount: number }> {
    return resolveIdpCall("users", [options], this.#namespace) as Awaited<
      ReturnType<typeof this.users>
    >;
  }
  async user(userId: string): Promise<tailor.idp.User> {
    return resolveIdpCall("user", [userId], this.#namespace) as tailor.idp.User;
  }
  async userByName(name: string): Promise<tailor.idp.User> {
    return resolveIdpCall("userByName", [name], this.#namespace) as tailor.idp.User;
  }
  async createUser(input: {
    name: string;
    password?: string;
    disabled?: boolean;
  }): Promise<tailor.idp.User> {
    return resolveIdpCall("createUser", [input], this.#namespace) as tailor.idp.User;
  }
  async updateUser(input: {
    id: string;
    name?: string;
    password?: string;
    clearPassword?: boolean;
    disabled?: boolean;
  }): Promise<tailor.idp.User> {
    return resolveIdpCall("updateUser", [input], this.#namespace) as tailor.idp.User;
  }
  async deleteUser(userId: string): Promise<boolean> {
    return resolveIdpCall("deleteUser", [userId], this.#namespace) as boolean;
  }
  async sendPasswordResetEmail(input: { userId: string; redirectUri: string }): Promise<boolean> {
    return resolveIdpCall("sendPasswordResetEmail", [input], this.#namespace) as boolean;
  }
}

// ---------------------------------------------------------------------------
// Mock: tailor.iconv
// ---------------------------------------------------------------------------

// Iconv methods return `string` for UTF-8 target encodings and `Uint8Array`
// for any other byte-producing encoding (the platform API mirrors this).
// Default returns must respect that contract so tests that don't configure a
// resolver still get type-consistent values.
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

function resolveIconvCall(method: string, args: unknown[]): unknown {
  const state = getState();
  state.iconvCalls.push({ method, args: [...args] });
  if (state.iconvResolver) {
    const result = state.iconvResolver(method, args);
    // Treat both null and undefined as "no override" so resolvers using
    // implicit returns (e.g. early `return;` for unhandled methods) still
    // fall through to the type-consistent default.
    if (result != null) return result;
  }
  return defaultIconvResult(method, args);
}

function mockConvert<T extends string>(
  str: string | Uint8Array | ArrayBuffer,
  fromEncoding: string,
  toEncoding: T,
): T extends "UTF8" | "UTF-8" ? string : Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return resolveIconvCall("convert", [str, fromEncoding, toEncoding]) as any;
}

function mockConvertBuffer<T extends string>(
  buffer: Uint8Array | ArrayBuffer,
  fromEncoding: string,
  toEncoding: T,
): T extends "UTF8" | "UTF-8" ? string : Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return resolveIconvCall("convertBuffer", [buffer, fromEncoding, toEncoding]) as any;
}

function mockDecode(buffer: Uint8Array | ArrayBuffer, encoding: string): string {
  return resolveIconvCall("decode", [buffer, encoding]) as string;
}

function mockEncode<T extends string>(
  str: string,
  encoding: T,
): T extends "UTF8" | "UTF-8" ? string : Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return resolveIconvCall("encode", [str, encoding]) as any;
}

function mockEncodings(): string[] {
  return resolveIconvCall("encodings", []) as string[];
}

class MockIconv {
  #fromEncoding: string;
  #toEncoding: string;

  constructor(fromEncoding: string, toEncoding: string) {
    this.#fromEncoding = fromEncoding;
    this.#toEncoding = toEncoding;
  }

  convert(input: string | Uint8Array | ArrayBuffer): string | Uint8Array {
    return resolveIconvCall("convert", [input, this.#fromEncoding, this.#toEncoding]) as
      | string
      | Uint8Array;
  }
}

// ---------------------------------------------------------------------------
// Mock: tailordb.file
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
};

function resolveFileCall(
  method: string,
  namespace: string,
  typeName: string,
  fieldName: string,
  recordId: string,
): unknown {
  const state = getState();
  const call: FileCall = { method, namespace, typeName, fieldName, recordId };
  state.fileCalls.push(call);
  if (state.fileResultQueue.length > 0) return state.fileResultQueue.shift();
  const resolved = state.fileResolver(method, call);
  return resolved ?? FILE_DEFAULTS[method];
}

const mockTailordbFile = {
  async upload(
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
    _data: string | ArrayBuffer | Uint8Array | number[],
    _options?: { contentType?: string },
  ): Promise<{ metadata: { fileSize: number; sha256sum: string } }> {
    return resolveFileCall("upload", namespace, typeName, fieldName, recordId) as Awaited<
      ReturnType<typeof this.upload>
    >;
  },
  async download(
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
  ): Promise<{
    data: Uint8Array;
    metadata: { contentType: string; fileSize: number; sha256sum: string; lastUploadedAt: string };
  }> {
    return resolveFileCall("download", namespace, typeName, fieldName, recordId) as Awaited<
      ReturnType<typeof this.download>
    >;
  },
  async downloadAsBase64(
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
  ): Promise<{
    data: string;
    metadata: { contentType: string; fileSize: number; sha256sum: string; lastUploadedAt: string };
  }> {
    return resolveFileCall("downloadAsBase64", namespace, typeName, fieldName, recordId) as Awaited<
      ReturnType<typeof this.downloadAsBase64>
    >;
  },
  async delete(
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
  ): Promise<void> {
    resolveFileCall("delete", namespace, typeName, fieldName, recordId);
  },
  async getMetadata(
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
  ): Promise<{
    contentType: string;
    fileSize: number;
    sha256sum: string;
    urlPath: string;
    lastUploadedAt?: string;
  }> {
    return resolveFileCall("getMetadata", namespace, typeName, fieldName, recordId) as Awaited<
      ReturnType<typeof this.getMetadata>
    >;
  },
  openDownloadStream(
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
  ): Promise<AsyncIterableIterator<unknown> & { close(): Promise<void> }> {
    const resolved = resolveFileCall(
      "openDownloadStream",
      namespace,
      typeName,
      fieldName,
      recordId,
    );
    return Promise.resolve(toFileStream(resolved));
  },
};

type FileStream = AsyncIterableIterator<unknown> & { close(): Promise<void> };

function toFileStream(value: unknown): FileStream {
  // Already a complete stream-like object: pass through.
  if (
    value !== null &&
    typeof value === "object" &&
    Symbol.asyncIterator in value &&
    typeof (value as { close?: unknown }).close === "function"
  ) {
    return value as FileStream;
  }
  // Binary chunk shorthand: a single ArrayBuffer / TypedArray (e.g. Uint8Array)
  // should be delivered as one chunk, not iterated as a sequence of numbers.
  // Tests passing `[chunk1, chunk2]` continue to work via the iterable branch
  // below.
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return toFileStream([value]);
  }
  // Iterable (array, sync iterator, etc.): wrap as a chunked async iterator
  // so `fileMock.enqueueResult([chunk1, chunk2])` controls stream contents.
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
    // Match the PF runtime's TailorErrors serialization, which prefixes the
    // JSON payload with "TailorErrors: ". Other SDK code (e.g. apply
    // integration fixtures) strips this prefix before JSON.parse.
    super(`TailorErrors: ${JSON.stringify({ errors: validated })}`);
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
 * @param global - The global object to inject mocks into
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
    context: {
      getInvoker: mockGetInvoker,
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
 * @param global - The global object to clean up mocks from
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
