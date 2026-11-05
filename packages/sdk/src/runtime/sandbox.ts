/**
 * Sandbox utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.sandbox` runtime API.
 * At runtime this delegates to `globalThis.tailor.sandbox`. Use `mockSandbox`
 * from `@tailor-platform/sdk/vitest` to mock these calls in unit tests.
 *
 * A sandbox is an isolated environment that runs commands and holds files under
 * `/workspace`. Every function that returns a sandbox takes a hold on it for the
 * current execution, and the runtime releases every hold when the execution ends.
 *
 * **Beta:** This API may change in future releases.
 * @example
 * import { sandbox } from "@tailor-platform/sdk/runtime/sandbox";
 *
 * const sb = await sandbox.create({ template: "guest" });
 * const result = await sb.exec(["sh", "-c", "echo hello"]);
 * console.log(result.stdout, result.exitCode);
 */

/** Lifecycle status of a sandbox. */
export type SandboxStatus = "PROVISIONING" | "RUNNING" | "SUSPENDED" | "DESTROYED" | "FAILED";

/** Status of a command execution inside a sandbox. */
export type ExecutionStatus =
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "TIMED_OUT"
  | "CANCELED"
  | "UNKNOWN";

/** Fields describing a sandbox. Timestamps are ISO 8601 strings with millisecond precision. */
export interface SandboxInfo {
  /** Sandbox ID. */
  id: string;
  /** Name of a kept sandbox. Absent for an ephemeral sandbox. */
  name?: string;
  /** Template the sandbox was created from. */
  template: string;
  /** Current lifecycle status. */
  status: SandboxStatus;
  /** Whether the sandbox outlives the execution that created it (it has a `name`). */
  kept: boolean;
  /** When the sandbox was created. */
  createdAt: string;
  /** When the sandbox last ran a command or file operation. */
  lastActiveAt: string;
  /** When the sandbox expires. */
  expiresAt: string;
  /** Why the sandbox failed. Set when `status` is `FAILED`. */
  failureMessage?: string;
}

/** Fields describing a command execution. Timestamps are ISO 8601 strings with millisecond precision. */
export interface ExecutionInfo {
  /** Execution ID. */
  id: string;
  /** ID of the sandbox the command runs in. */
  sandboxId: string;
  /** Current execution status. */
  status: ExecutionStatus;
  /** Exit code of the command. Set once the command has exited. */
  exitCode?: number;
  /** When the command started. */
  startedAt: string;
  /** When the command finished. Absent while it is running. */
  finishedAt?: string;
  /** Whether the stored output was truncated because it exceeded the size limit. */
  outputTruncated: boolean;
}

/** Options for {@link Sandbox.exec} and {@link Sandbox.start}. */
export interface ExecOptions {
  /** Working directory of the command. */
  cwd?: string;
  /** Environment variables for the command. */
  env?: Record<string, string>;
  /** Kill the command after this many seconds. */
  timeoutSeconds?: number;
  /** Starting twice with the same key returns the same execution instead of running the command again. */
  idempotencyKey?: string;
}

/** Result of {@link Sandbox.exec}. */
export interface ExecResult extends ExecutionInfo {
  /** Standard output decoded as UTF-8. */
  stdout: string;
  /** Standard error decoded as UTF-8. */
  stderr: string;
  /** Standard output as raw bytes. */
  stdoutBytes: Uint8Array;
  /** Standard error as raw bytes. */
  stderrBytes: Uint8Array;
}

/** A piece of execution output, or the final exit marker. */
export type OutputChunk =
  | {
      /** The stream the data was written to. */
      type: "stdout" | "stderr";
      /** Byte offset of this chunk within its stream. */
      offset: number;
      /** The bytes of this chunk. */
      data: Uint8Array;
    }
  | {
      /** Marks the end of the output. */
      type: "exit";
      /** The execution as it finished. */
      execution: ExecutionInfo;
    };

/** An entry returned by {@link Sandbox.listFiles}. */
export interface FileInfo {
  /** File or directory name. */
  name: string;
  /** Size in bytes. */
  size: number;
  /** Whether the entry is a directory. */
  isDir: boolean;
  /** Last modification time as an ISO 8601 string. */
  modTime: string;
}

/** A page of executions returned by {@link Sandbox.executions}. */
export interface ExecutionPage {
  /** Executions in this page. */
  executions: Execution[];
  /** Pass as `pageToken` to get the next page. Empty on the last page. */
  nextPageToken: string;
}

/** Options for {@link Execution.output}. */
export interface OutputOptions {
  /** Resume stdout from this byte offset. */
  stdoutOffset?: number;
  /** Resume stderr from this byte offset. */
  stderrOffset?: number;
}

/** Options for {@link Sandbox.executions}. */
export interface ListExecutionsOptions {
  /** Return only executions with this status. */
  status?: ExecutionStatus;
  /** Maximum number of executions per page. */
  pageSize?: number;
  /** Token from a previous page's `nextPageToken`. */
  pageToken?: string;
}

/** Options for {@link PlatformSandboxAPI.create}. */
export interface CreateSandboxOptions {
  /** Template to create the sandbox from. */
  template: string;
  /** Keeps the sandbox beyond this execution and makes it findable by name. */
  name?: string;
}

/** Options for {@link PlatformSandboxAPI.getOrCreate}. */
export interface GetOrCreateSandboxOptions {
  /** Name of the kept sandbox. */
  name: string;
  /** Template to create the sandbox from when it does not exist. */
  template: string;
}

/** A command execution inside a sandbox. */
export interface Execution extends ExecutionInfo {
  /**
   * Streams the command output as chunks, ending with an `exit` chunk.
   * @param opts - Offsets to resume from
   * @returns A stream of output chunks
   */
  output(opts?: OutputOptions): ReadableStream<OutputChunk>;
  /**
   * Waits until the command finishes.
   * @returns The finished execution
   */
  wait(): Promise<Execution>;
  /**
   * Cancels the command.
   * @returns The execution after cancellation
   */
  cancel(): Promise<Execution>;
  /**
   * Fetches the latest execution state.
   * @returns The refreshed execution
   */
  refresh(): Promise<Execution>;
}

/**
 * A handle to a sandbox. Operations on it need this execution to hold the sandbox;
 * without the hold they raise a {@link SandboxError} with code `FAILED_PRECONDITION`.
 */
export interface Sandbox extends SandboxInfo {
  /**
   * Runs a command and waits for it to finish. A non-zero exit code does not throw.
   * @param argv - Command and arguments
   * @param opts - Working directory, environment, timeout and idempotency key
   * @returns The execution fields with the collected output
   */
  exec(argv: string[], opts?: ExecOptions): Promise<ExecResult>;
  /**
   * Starts a command without waiting for it to finish.
   * @param argv - Command and arguments
   * @param opts - Working directory, environment, timeout and idempotency key
   * @returns The running execution
   */
  start(argv: string[], opts?: ExecOptions): Promise<Execution>;
  /**
   * Finds an execution of this sandbox.
   * @param id - Execution ID
   * @returns The execution
   */
  execution(id: string): Promise<Execution>;
  /**
   * Lists executions of this sandbox.
   * @param opts - Status filter and paging
   * @returns A page of executions
   */
  executions(opts?: ListExecutionsOptions): Promise<ExecutionPage>;
  /**
   * Reads a file as bytes.
   * @param path - Absolute path under `/workspace`
   * @returns The file contents
   */
  readFile(path: string): Promise<Uint8Array>;
  /**
   * Reads a file and decodes it.
   * @param path - Absolute path under `/workspace`
   * @param opts - Decoding options
   * @param opts.encoding - Text encoding, for example `"utf-8"`
   * @returns The decoded file contents
   */
  readFile(path: string, opts: { encoding: string }): Promise<string>;
  /**
   * Reads a file as a stream.
   * @param path - Absolute path under `/workspace`
   * @returns A stream of the file bytes
   */
  readFileStream(path: string): ReadableStream<Uint8Array>;
  /**
   * Writes a file, replacing it if it exists.
   * @param path - Absolute path under `/workspace`
   * @param data - File contents; strings are encoded as UTF-8
   * @returns The number of bytes written
   */
  writeFile(
    path: string,
    data: string | Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>,
  ): Promise<{ bytesWritten: number }>;
  /**
   * Lists a directory.
   * @param path - Absolute directory path under `/workspace`
   * @returns The entries of the directory
   */
  listFiles(path: string): Promise<FileInfo[]>;
  /**
   * Deletes a file.
   * @param path - Absolute path under `/workspace`
   */
  deleteFile(path: string): Promise<void>;
  /** Destroys the sandbox and its files. */
  destroy(): Promise<void>;
}

/**
 * Error raised by `tailor.sandbox` calls. `code` is the gRPC code name, for example
 * `NOT_FOUND`, `ABORTED`, `FAILED_PRECONDITION`, or `INVALID_ARGUMENT` for arguments
 * rejected before any request is sent. `name` is `"SandboxError"`.
 */
export interface SandboxError extends Error {
  /** gRPC code name. */
  code: string;
}

/** Constructor of {@link SandboxError}, exposed as `tailor.sandbox.SandboxError`. */
export interface SandboxErrorConstructor {
  new (message: string, code: string): SandboxError;
}

/**
 * Platform API surface for `tailor.sandbox`. Describes the shape the platform
 * runtime injects on `globalThis.tailor.sandbox`.
 *
 * Holds are renewed by the runtime only while the script yields to the event loop.
 * A synchronous CPU loop longer than about a minute lets a hold lapse. Every hold is
 * released when the execution ends.
 */
export interface PlatformSandboxAPI {
  /** Error class raised by sandbox calls, for `instanceof` checks. */
  readonly SandboxError: SandboxErrorConstructor;

  /**
   * Creates a sandbox.
   *
   * Without `name` the sandbox is ephemeral: it is destroyed when this execution
   * ends, so it cannot be shared with later Workflow steps. Pass `name` to keep it.
   * This execution holds a named sandbox until the execution ends, and a later
   * execution can take it with {@link PlatformSandboxAPI.getByName}.
   * Fails with `ALREADY_EXISTS` when a live sandbox already has that name.
   * @param opts - Template and optional name
   * @returns A handle to the new sandbox
   */
  create(opts: CreateSandboxOptions): Promise<Sandbox>;

  /**
   * Gets a kept sandbox by name and takes its hold, or creates it when it does not exist.
   * Retries `ABORTED` for up to 1 minute while another execution holds the sandbox.
   * A `FAILED` sandbox is returned as is, so the caller can destroy it.
   * @param opts - Name and template
   * @returns A handle to the sandbox
   */
  getOrCreate(opts: GetOrCreateSandboxOptions): Promise<Sandbox>;

  /**
   * Finds a sandbox by ID and takes its hold.
   * Retries `ABORTED` for up to 1 minute while another execution holds the sandbox.
   * A `FAILED` sandbox is returned as is, so the caller can destroy it.
   * @param id - Sandbox ID
   * @returns A handle to the sandbox
   */
  get(id: string): Promise<Sandbox>;

  /**
   * Finds a kept sandbox by name and takes its hold.
   * Retries `ABORTED` for up to 1 minute while another execution holds the sandbox.
   * A `FAILED` sandbox is returned as is, so the caller can destroy it.
   * @param name - Sandbox name
   * @returns A handle to the sandbox
   */
  getByName(name: string): Promise<Sandbox>;
}

const api = (): PlatformSandboxAPI =>
  (globalThis as unknown as { tailor: { sandbox: PlatformSandboxAPI } }).tailor.sandbox;

/** Runtime wrapper namespace for `tailor.sandbox`. */
export const sandbox: PlatformSandboxAPI = {
  get SandboxError() {
    return api().SandboxError;
  },
  create: (opts) => api().create(opts),
  getOrCreate: (opts) => api().getOrCreate(opts),
  get: (id) => api().get(id),
  getByName: (name) => api().getByName(name),
};
