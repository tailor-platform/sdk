import { type Mock, vi } from "vitest";
import { tailorRoot, withDispose } from "./shared";
import type {
  CreateSandboxOptions,
  ExecOptions,
  ExecResult,
  Execution,
  ExecutionInfo,
  ExecutionPage,
  FileInfo,
  GetOrCreateSandboxOptions,
  ListExecutionsOptions,
  OutputChunk,
  PlatformSandboxAPI,
  Sandbox,
  SandboxError as SandboxErrorShape,
} from "../../runtime/sandbox";

const WORKSPACE = "/workspace";

class SandboxErrorMock extends Error implements SandboxErrorShape {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
  }
}

/** Output a {@link MockSandboxExecHandler} returns for one command. */
export interface MockSandboxExecOutput {
  /** Standard output. Default: empty. */
  stdout?: string | Uint8Array;
  /** Standard error. Default: empty. */
  stderr?: string | Uint8Array;
  /** Exit code. Default: `0`. */
  exitCode?: number;
}

/** Handler that decides the outcome of every `exec` / `start` call. */
export type MockSandboxExecHandler = (
  argv: string[],
  opts: ExecOptions | undefined,
) => MockSandboxExecOutput | Promise<MockSandboxExecOutput>;

/** One recorded command run, for assertions. */
export interface MockSandboxExecution {
  sandboxId: string;
  argv: string[];
  opts?: ExecOptions;
  executionId: string;
}

interface SandboxState {
  sandbox: Sandbox;
  files: Map<string, Uint8Array>;
  executions: ExecutionState[];
}

interface ExecutionState {
  execution: Execution;
  info: { -readonly [K in keyof ExecutionInfo]: ExecutionInfo[K] };
  stdout: Uint8Array;
  stderr: Uint8Array;
  idempotencyKey?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBytes(value: string | Uint8Array | undefined): Uint8Array {
  if (value === undefined) return new Uint8Array();
  return typeof value === "string" ? encoder.encode(value) : value;
}

function invalidPath(path: string): SandboxErrorMock {
  return new SandboxErrorMock(
    `path ${JSON.stringify(path)} must be an absolute path under ${WORKSPACE}`,
    "INVALID_ARGUMENT",
  );
}

// Resolve `.` and `..` segments, then require the result to stay under /workspace.
function normalizePath(path: unknown): string {
  if (typeof path !== "string" || !path.startsWith("/")) throw invalidPath(String(path));
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  const normalized = `/${parts.join("/")}`;
  if (normalized !== WORKSPACE && !normalized.startsWith(`${WORKSPACE}/`)) {
    throw invalidPath(path);
  }
  return normalized;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (bytes.length > 0) controller.enqueue(bytes);
      controller.close();
    },
  });
}

/**
 * Acquire a disposable in-memory mock for `tailor.sandbox`. Restored on dispose.
 *
 * Sandboxes, files under `/workspace` and executions live in memory. `exec` and
 * `start` run the handler set with `onExec` (default: exit code 0, empty output).
 * Errors are raised as `SandboxError` with the same codes the platform uses
 * (`NOT_FOUND`, `ALREADY_EXISTS`, `FAILED_PRECONDITION`, `INVALID_ARGUMENT`).
 * Holds are not modelled, so `ABORTED` is never raised. `start` runs the handler to completion
 * before it returns, so a `RUNNING` execution is never observable and `cancel` has no effect.
 *
 * **Beta:** This API may change in future releases.
 * @returns Disposable sandbox mock control object
 * @example
 * ```typescript
 * import { mockSandbox } from "@tailor-platform/sdk/vitest";
 *
 * test("runs a command", async () => {
 *   using sb = mockSandbox();
 *   sb.onExec((argv) => ({ stdout: argv.join(" ") }));
 *   const box = await tailor.sandbox.create({ template: "guest" });
 *   const result = await box.exec(["echo", "hi"]);
 *   expect(result.stdout).toBe("echo hi");
 * });
 * ```
 */
export function mockSandbox() {
  const root = tailorRoot();
  const prev = root.sandbox;

  const byId = new Map<string, SandboxState>();
  const recorded: MockSandboxExecution[] = [];
  let handler: MockSandboxExecHandler = () => ({});
  let counter = 0;

  const nextId = (prefix: string): string => `${prefix}-${String(++counter).padStart(4, "0")}`;
  const now = (): string => new Date().toISOString();

  const liveByName = (name: string): SandboxState | undefined => {
    for (const state of byId.values()) {
      if (state.sandbox.name === name && state.sandbox.status !== "DESTROYED") return state;
    }
    return undefined;
  };

  const requireById = (id: string): SandboxState => {
    const state = byId.get(id);
    if (!state) throw new SandboxErrorMock(`sandbox ${id} not found`, "NOT_FOUND");
    return state;
  };

  const requireUsable = (state: SandboxState, caller: string): void => {
    const { status, id } = state.sandbox;
    if (status === "DESTROYED" || status === "FAILED") {
      throw new SandboxErrorMock(`${caller}: sandbox ${id} is ${status}`, "FAILED_PRECONDITION");
    }
    state.sandbox.lastActiveAt = now();
  };

  const executionView = (state: ExecutionState): Execution => {
    const exec = state.execution;
    Object.assign(exec, state.info);
    return exec;
  };

  const makeExecution = (state: ExecutionState): Execution => {
    const exec: Execution = {
      ...state.info,
      output(opts) {
        const stdoutOffset = opts?.stdoutOffset ?? 0;
        const stderrOffset = opts?.stderrOffset ?? 0;
        const chunks: OutputChunk[] = [];
        if (state.stdout.length > stdoutOffset) {
          chunks.push({
            type: "stdout",
            offset: stdoutOffset,
            data: state.stdout.slice(stdoutOffset),
          });
        }
        if (state.stderr.length > stderrOffset) {
          chunks.push({
            type: "stderr",
            offset: stderrOffset,
            data: state.stderr.slice(stderrOffset),
          });
        }
        chunks.push({ type: "exit", execution: { ...state.info } });
        return new ReadableStream<OutputChunk>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        });
      },
      async wait() {
        return executionView(state);
      },
      async cancel() {
        if (state.info.status === "RUNNING") {
          state.info.status = "CANCELED";
          state.info.finishedAt = now();
        }
        return executionView(state);
      },
      async refresh() {
        return executionView(state);
      },
    };
    state.execution = exec;
    return exec;
  };

  const run = async (
    sandboxState: SandboxState,
    argv: string[],
    opts: ExecOptions | undefined,
    caller: string,
  ): Promise<ExecutionState> => {
    if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== "string")) {
      throw new SandboxErrorMock(
        `${caller}: argv must be a non-empty array of strings`,
        "INVALID_ARGUMENT",
      );
    }
    requireUsable(sandboxState, caller);
    const key = opts?.idempotencyKey;
    if (key !== undefined) {
      const existing = sandboxState.executions.find((e) => e.idempotencyKey === key);
      if (existing) return existing;
    }
    const id = nextId("exec");
    const startedAt = now();
    const state: ExecutionState = {
      execution: undefined as unknown as Execution,
      info: {
        id,
        sandboxId: sandboxState.sandbox.id,
        status: "RUNNING",
        startedAt,
        outputTruncated: false,
      },
      stdout: new Uint8Array(),
      stderr: new Uint8Array(),
      ...(key !== undefined && { idempotencyKey: key }),
    };
    makeExecution(state);
    sandboxState.executions.push(state);
    recorded.push({
      sandboxId: sandboxState.sandbox.id,
      argv: [...argv],
      ...(opts !== undefined && { opts }),
      executionId: id,
    });

    const out = await handler([...argv], opts);
    state.stdout = toBytes(out.stdout);
    state.stderr = toBytes(out.stderr);
    state.info.exitCode = out.exitCode ?? 0;
    state.info.status = state.info.exitCode === 0 ? "SUCCESS" : "FAILED";
    state.info.finishedAt = now();
    executionView(state);
    return state;
  };

  const makeSandbox = (opts: CreateSandboxOptions): SandboxState => {
    const createdAt = now();
    const files = new Map<string, Uint8Array>();
    const executions: ExecutionState[] = [];
    const state: SandboxState = { files, executions, sandbox: undefined as unknown as Sandbox };

    const listPage = (listOpts?: ListExecutionsOptions): ExecutionPage => {
      let items = executions.filter((e) => !listOpts?.status || e.info.status === listOpts.status);
      const start = listOpts?.pageToken ? Number(listOpts.pageToken) : 0;
      const size = listOpts?.pageSize && listOpts.pageSize > 0 ? listOpts.pageSize : items.length;
      const end = start + size;
      const nextPageToken = end < items.length ? String(end) : "";
      items = items.slice(start, end);
      return { executions: items.map(executionView), nextPageToken };
    };

    const sandbox: Sandbox = {
      id: nextId("sandbox"),
      ...(opts.name !== undefined && { name: opts.name }),
      template: opts.template,
      status: "RUNNING",
      createdAt,
      lastActiveAt: createdAt,
      expiresAt: new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1000).toISOString(),
      async exec(argv, execOpts) {
        const exec = await run(state, argv, execOpts, "exec");
        const result: ExecResult = {
          ...exec.info,
          stdout: decoder.decode(exec.stdout),
          stderr: decoder.decode(exec.stderr),
          stdoutBytes: exec.stdout,
          stderrBytes: exec.stderr,
        };
        return result;
      },
      async start(argv, execOpts) {
        return executionView(await run(state, argv, execOpts, "start"));
      },
      async execution(id) {
        const found = executions.find((e) => e.info.id === id);
        if (!found) throw new SandboxErrorMock(`execution ${id} not found`, "NOT_FOUND");
        return executionView(found);
      },
      async executions(listOpts) {
        return listPage(listOpts);
      },
      readFile: (async (path: string, readOpts?: { encoding: string }) => {
        requireUsable(state, "readFile");
        const bytes = state.files.get(normalizePath(path));
        if (!bytes) throw new SandboxErrorMock(`file ${path} not found`, "NOT_FOUND");
        return readOpts ? new TextDecoder(readOpts.encoding).decode(bytes) : bytes.slice();
      }) as Sandbox["readFile"],
      readFileStream(path) {
        const normalized = normalizePath(path);
        requireUsable(state, "readFileStream");
        const bytes = state.files.get(normalized);
        if (!bytes) throw new SandboxErrorMock(`file ${path} not found`, "NOT_FOUND");
        return streamOf(bytes.slice());
      },
      async writeFile(path, data) {
        const normalized = normalizePath(path);
        requireUsable(state, "writeFile");
        let bytes: Uint8Array;
        if (typeof data === "string") bytes = encoder.encode(data);
        else if (data instanceof Uint8Array) bytes = data.slice();
        else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data.slice(0));
        else bytes = await collect(data);
        state.files.set(normalized, bytes);
        return { bytesWritten: bytes.length };
      },
      async listFiles(path) {
        const dir = normalizePath(path);
        requireUsable(state, "listFiles");
        const prefix = dir === "/" ? "/" : `${dir}/`;
        const entries = new Map<string, FileInfo>();
        for (const [filePath, bytes] of state.files) {
          if (!filePath.startsWith(prefix)) continue;
          const rest = filePath.slice(prefix.length);
          const slash = rest.indexOf("/");
          const name = slash === -1 ? rest : rest.slice(0, slash);
          if (slash === -1) {
            entries.set(name, { name, size: bytes.length, isDir: false, modTime: now() });
          } else if (!entries.has(name)) {
            entries.set(name, { name, size: 0, isDir: true, modTime: now() });
          }
        }
        return [...entries.values()].toSorted((a, b) => a.name.localeCompare(b.name));
      },
      async deleteFile(path) {
        const normalized = normalizePath(path);
        requireUsable(state, "deleteFile");
        if (!state.files.delete(normalized)) {
          throw new SandboxErrorMock(`file ${path} not found`, "NOT_FOUND");
        }
      },
      async destroy() {
        if (sandbox.status === "DESTROYED") return;
        sandbox.status = "DESTROYED";
        state.files.clear();
      },
    };
    state.sandbox = sandbox;
    byId.set(sandbox.id, state);
    return state;
  };

  const validateCreate = (opts: unknown, caller: string): CreateSandboxOptions => {
    const o = opts as CreateSandboxOptions | undefined;
    if (!o || typeof o.template !== "string" || o.template === "") {
      throw new SandboxErrorMock(`${caller}: template is required`, "INVALID_ARGUMENT");
    }
    if (o.name !== undefined && (typeof o.name !== "string" || o.name === "")) {
      throw new SandboxErrorMock(`${caller}: name must be a non-empty string`, "INVALID_ARGUMENT");
    }
    return o;
  };

  const create = vi.fn(async (opts: CreateSandboxOptions): Promise<Sandbox> => {
    const valid = validateCreate(opts, "create");
    if (valid.name !== undefined && liveByName(valid.name)) {
      throw new SandboxErrorMock(`sandbox named ${valid.name} already exists`, "ALREADY_EXISTS");
    }
    return makeSandbox(valid).sandbox;
  });
  const getOrCreate = vi.fn(async (opts: GetOrCreateSandboxOptions): Promise<Sandbox> => {
    const valid = validateCreate(opts, "getOrCreate");
    if (valid.name === undefined) {
      throw new SandboxErrorMock("getOrCreate: name is required", "INVALID_ARGUMENT");
    }
    return (liveByName(valid.name) ?? makeSandbox(valid)).sandbox;
  });
  const get = vi.fn(async (id: string): Promise<Sandbox> => requireById(id).sandbox);
  const getByName = vi.fn(async (name: string): Promise<Sandbox> => {
    const state = liveByName(name);
    if (!state) throw new SandboxErrorMock(`sandbox named ${name} not found`, "NOT_FOUND");
    return state.sandbox;
  });

  const installed: PlatformSandboxAPI = {
    SandboxError: SandboxErrorMock,
    create: (opts) => create(opts),
    getOrCreate: (opts) => getOrCreate(opts),
    get: (id) => get(id),
    getByName: (name) => getByName(name),
  };
  root.sandbox = installed;

  const facade = {
    /** The `create` `vi.fn`. */
    create: create as Mock<PlatformSandboxAPI["create"]>,
    /** The `getOrCreate` `vi.fn`. */
    getOrCreate: getOrCreate as Mock<PlatformSandboxAPI["getOrCreate"]>,
    /** The `get` `vi.fn`. */
    get: get as Mock<PlatformSandboxAPI["get"]>,
    /** The `getByName` `vi.fn`. */
    getByName: getByName as Mock<PlatformSandboxAPI["getByName"]>,

    /**
     * Set the handler that decides the outcome of every `exec` / `start` call.
     * Default: exit code 0 with empty output.
     * @param fn - Handler receiving the command and its options
     */
    onExec(fn: MockSandboxExecHandler): void {
      handler = fn;
    },

    /**
     * All sandboxes created so far, destroyed ones included, in creation order.
     * @returns Sandbox handles
     */
    get sandboxes(): Sandbox[] {
      return [...byId.values()].map((s) => s.sandbox);
    },

    /**
     * Every command run through `exec` / `start`, in order.
     * @returns Recorded executions
     */
    get executions(): MockSandboxExecution[] {
      return [...recorded];
    },

    /**
     * Files of a sandbox, keyed by absolute path. Mutating the returned map changes the sandbox.
     * @param sandboxId - Sandbox ID
     * @returns The file map of the sandbox
     */
    files(sandboxId: string): Map<string, Uint8Array> {
      return requireById(sandboxId).files;
    },

    /** Clear recorded calls and executions while keeping sandboxes and the exec handler. */
    clear(): void {
      create.mockClear();
      getOrCreate.mockClear();
      get.mockClear();
      getByName.mockClear();
      recorded.length = 0;
    },

    /** Remove all sandboxes and recordings and restore the default exec handler. */
    reset(): void {
      byId.clear();
      recorded.length = 0;
      handler = () => ({});
      counter = 0;
      create.mockClear();
      getOrCreate.mockClear();
      get.mockClear();
      getByName.mockClear();
    },
  };

  return withDispose(facade, () => {
    root.sandbox = prev;
  });
}
