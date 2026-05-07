/**
 * Ambient global type definitions for the Tailor Platform Function runtime.
 *
 * The Tailor Platform Function runtime injects `tailor.*` and `tailordb`
 * objects into the global scope. This file declares their type signatures so
 * they can be referenced from any TypeScript code that runs in (or is bundled
 * for) the runtime.
 * @example
 * // Side-effect import to enable the global types in a single file:
 * import "@tailor-platform/sdk/runtime/globals";
 *
 * // Or register globally in tsconfig.json:
 * // "compilerOptions": { "types": ["@tailor-platform/sdk/runtime/globals"] }
 *
 * Most users do not need to import this directly — `@tailor-platform/sdk/runtime`
 * exposes typed wrappers that cover the same surface without relying on globals.
 */

/* eslint-disable @typescript-eslint/no-namespace, @typescript-eslint/no-explicit-any, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-param-description */

// ---------------------------------------------------------------------------
// Module-scope types (exported, non-global)
//
// These types describe the data shapes used by the platform runtime. The
// `declare global` block below aliases each of them into the appropriate
// `tailor.*` / global namespace, so callers who opt into the globals see the
// same surface they always did. Callers who do not opt in can still import
// these types directly via `@tailor-platform/sdk/runtime/*` — none of the
// types below reference globals, so they are self-contained.
// ---------------------------------------------------------------------------

// --- Tailordb -------------------------------------------------------------

/** Result of a single `queryObject` call against the TailorDB driver. */
export interface TailordbQueryResult<T> {
  rows: T[];
  command: TailordbCommandType;
  rowCount: number;
}

/** SQL command type recorded on a {@link TailordbQueryResult}. */
export type TailordbCommandType =
  | "INSERT"
  | "DELETE"
  | "UPDATE"
  | "SELECT"
  | "MOVE"
  | "FETCH"
  | "COPY"
  | "CREATE";

// --- TailorDB file API ---------------------------------------------------

/** Upload response metadata. */
export interface UploadMetadata {
  fileSize: number;
  sha256sum: string;
}

/** Download response metadata. */
export interface DownloadMetadata {
  contentType: string;
  fileSize: number;
  sha256sum: string;
  lastUploadedAt: string;
}

/** File metadata (for `getMetadata`). */
export interface FileMetadata {
  contentType: string;
  fileSize: number;
  sha256sum: string;
  urlPath: string;
  lastUploadedAt?: string;
}

/** Stream metadata (first chunk). */
export interface StreamMetadata {
  contentType: string;
  fileSize: number;
  sha256sum: string;
}

/** Upload options. */
export interface FileUploadOptions {
  contentType?: string;
}

/** Upload response. */
export interface FileUploadResponse {
  metadata: UploadMetadata;
}

/** Download response. */
export interface FileDownloadResponse {
  data: Uint8Array;
  metadata: DownloadMetadata;
}

/** Download-as-Base64 response. */
export interface FileDownloadAsBase64Response {
  data: string;
  metadata: DownloadMetadata;
}

/** Stream chunk types. */
export type StreamValue =
  | { type: "metadata"; metadata: StreamMetadata }
  | { type: "chunk"; data: Uint8Array; position: number }
  | { type: "complete" };

/** Stream iterator interface. */
export interface FileStreamIterator extends AsyncIterableIterator<StreamValue> {
  next(): Promise<IteratorResult<StreamValue>>;
  close(): Promise<void>;
}

/** TailorDB File API surface. */
export interface TailorDBFileAPI {
  upload(
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
    data: string | ArrayBuffer | Uint8Array | number[],
    options?: FileUploadOptions,
  ): Promise<FileUploadResponse>;

  download(
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
  ): Promise<FileDownloadResponse>;

  downloadAsBase64(
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
  ): Promise<FileDownloadAsBase64Response>;

  delete(namespace: string, typeName: string, fieldName: string, recordId: string): Promise<void>;

  getMetadata(
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
  ): Promise<FileMetadata>;

  openDownloadStream(
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
  ): Promise<FileStreamIterator>;
}

/** Error code emitted by `TailorDBFileError`. */
export type TailorDBFileErrorCode =
  | "INVALID_PARAMS"
  | "INVALID_DATA_TYPE"
  | "OPERATION_FAILED"
  | "DELETE_FAILED"
  | "STREAM_OPEN_FAILED"
  | "STREAM_READ_ERROR"
  | "STREAM_ERROR"
  | "FILE_TOO_LARGE";

/**
 * Type-only shape of the `TailorDBFileError` runtime class. The class itself
 * is declared globally below; this interface mirrors it so callers can use
 * `import type { TailorDBFileError } from "@tailor-platform/sdk/runtime/file"`
 * without depending on the global declaration.
 */
export interface TailorDBFileError extends Error {
  name: "TailorDBFileError";
  code?: TailorDBFileErrorCode;
  cause?: unknown;
}

// --- tailor.idp -----------------------------------------------------------

/** Configuration for creating an IDP Client. */
export interface IdpClientConfig {
  namespace: string;
}

/** User object returned from IDP operations. */
export interface IdpUser {
  id: string;
  name: string;
  disabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Query options for filtering users. */
export interface IdpUserQuery {
  /** Filter by user IDs */
  ids?: string[];
  /** Filter by user names */
  names?: string[];
}

/** Options for listing users. */
export interface IdpListUsersOptions {
  /** Maximum number of users to return */
  first?: number;
  /** Page token for pagination */
  after?: string;
  /** Query filter for users */
  query?: IdpUserQuery;
}

/** Response from listing users. */
export interface IdpListUsersResponse {
  users: IdpUser[];
  nextPageToken: string | null;
  totalCount: number;
}

/** Input for creating a new user. */
export interface IdpCreateUserInput {
  /** The user's name (typically email) */
  name: string;
  /** The user's password. If omitted, the user is created without a password (cannot log in with any password). */
  password?: string;
  /** Whether the user is disabled */
  disabled?: boolean;
}

/** Input for updating an existing user. */
export interface IdpUpdateUserInput {
  /** The user's ID */
  id: string;
  /** New name for the user */
  name?: string;
  /** New password for the user. Cannot be used with clearPassword. */
  password?: string;
  /** If true, remove the user's password. Cannot be used with password. */
  clearPassword?: boolean;
  /** New disabled status for the user */
  disabled?: boolean;
}

/** Input for sending a password reset email. */
export interface IdpSendPasswordResetEmailInput {
  /** The ID of the user */
  userId: string;
  /** The URI to redirect to after password reset */
  redirectUri: string;
  /** The sender display name. Defaults to 'Tailor Platform IdP'. */
  fromName?: string;
  /** The email subject line. Defaults to the localized default subject. */
  subject?: string;
}

// --- tailor.workflow -----------------------------------------------------

/**
 * Specifies the machine user that should be used to execute the workflow.
 * This allows workflows to run with specific authentication context.
 */
export interface WorkflowAuthInvoker {
  /** The namespace where the machine user is defined */
  namespace: string;
  /** The name of the machine user to use for workflow execution */
  machineUserName: string;
}

/** Options for triggering a workflow. */
export interface WorkflowTriggerWorkflowOptions {
  /** Optional authentication invoker to specify which machine user should execute the workflow */
  authInvoker?: WorkflowAuthInvoker;
}

// --- tailor.context -------------------------------------------------------

/** Information about the invoker of the current function execution. */
export interface ContextInvoker {
  /** The invoker's ID */
  id: string;
  /** The invoker's type */
  type: "user" | "machine_user";
  /** The workspace ID */
  workspaceId: string;
  /** The invoker's attribute IDs */
  attributes: string[];
  /** The invoker's attribute map */
  attributeMap: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Ambient globals — alias the module-scope types into the runtime namespaces
// ---------------------------------------------------------------------------

declare global {
  namespace Tailordb {
    class Client {
      constructor(config: { namespace: string });
      connect(): Promise<void>;
      end(): Promise<void>;
      queryObject<O>(sql: string, args?: readonly unknown[]): Promise<QueryResult<O>>;
    }

    type QueryResult<T> = TailordbQueryResult<T>;
    type CommandType = TailordbCommandType;
  }

  // eslint-disable-next-line no-var
  var tailordb: {
    Client: typeof Tailordb.Client;
    file: TailorDBFileAPI;
  };

  namespace tailor.secretmanager {
    /**
     * getSecrets returns multiple secret objects (key = name, value = secret)
     * at once according to vault and secret names.
     *
     * If a secret does not exist, it will not be included in the result.
     * @param vault
     * @param names
     */
    function getSecrets<const T extends readonly string[]>(
      vault: string,
      names: T,
    ): Promise<Partial<Record<T[number], string>>>;

    /**
     * getSecret returns a secret according to vault and name.
     *
     * If the secret does not exist, undefined is returned.
     * @param vault
     * @param name
     */
    function getSecret(vault: string, name: string): Promise<string | undefined>;
  }

  namespace tailor.authconnection {
    /**
     * getConnectionToken returns the access token for an auth connection
     * @param connectionName
     */
    function getConnectionToken(connectionName: string): Promise<any>;
  }

  namespace tailor.iconv {
    /**
     * Convert string from one encoding to another
     * @param str
     * @param fromEncoding
     * @param toEncoding
     */
    function convert<T extends string>(
      str: string | Uint8Array | ArrayBuffer,
      fromEncoding: string,
      toEncoding: T,
    ): T extends "UTF8" | "UTF-8" ? string : Uint8Array;

    /**
     * Convert buffer from one encoding to another
     * @param buffer
     * @param fromEncoding
     * @param toEncoding
     */
    function convertBuffer<T extends string>(
      buffer: Uint8Array | ArrayBuffer,
      fromEncoding: string,
      toEncoding: T,
    ): T extends "UTF8" | "UTF-8" ? string : Uint8Array;

    /**
     * Decode buffer to string
     * @param buffer
     * @param encoding
     */
    function decode(buffer: Uint8Array | ArrayBuffer, encoding: string): string;

    /**
     * Encode string to buffer
     * @param str
     * @param encoding
     */
    function encode<T extends string>(
      str: string,
      encoding: T,
    ): T extends "UTF8" | "UTF-8" ? string : Uint8Array;

    /**
     * Get list of supported encodings
     */
    function encodings(): string[];

    /**
     * Iconv class for compatibility with node-iconv
     */
    class Iconv {
      constructor(fromEncoding: string, toEncoding: string);
      convert(input: string | Uint8Array | ArrayBuffer): string | Uint8Array;
    }
  }

  /** Custom error class for TailorDB File operations. */
  class TailorDBFileError extends Error {
    name: "TailorDBFileError";
    code?: TailorDBFileErrorCode;
    cause?: unknown;
  }

  namespace tailor.idp {
    type ClientConfig = IdpClientConfig;
    type User = IdpUser;
    type UserQuery = IdpUserQuery;
    type ListUsersOptions = IdpListUsersOptions;
    type ListUsersResponse = IdpListUsersResponse;
    type CreateUserInput = IdpCreateUserInput;
    type UpdateUserInput = IdpUpdateUserInput;
    type SendPasswordResetEmailInput = IdpSendPasswordResetEmailInput;

    /**
     * IDP Client for user management operations
     */
    class Client {
      constructor(config: ClientConfig);

      /**
       * List users in the namespace with optional filtering and pagination.
       */
      users(options?: ListUsersOptions): Promise<ListUsersResponse>;

      /**
       * Get a user by ID.
       */
      user(userId: string): Promise<User>;

      /**
       * Get a user by name.
       */
      userByName(name: string): Promise<User>;

      /**
       * Create a new user.
       */
      createUser(input: CreateUserInput): Promise<User>;

      /**
       * Update an existing user.
       */
      updateUser(input: UpdateUserInput): Promise<User>;

      /**
       * Delete a user by ID.
       * @returns True if successful
       */
      deleteUser(userId: string): Promise<boolean>;

      /**
       * Send a password reset email to a user.
       * @returns True if successful
       */
      sendPasswordResetEmail(input: SendPasswordResetEmailInput): Promise<boolean>;
    }
  }

  namespace tailor.workflow {
    type AuthInvoker = WorkflowAuthInvoker;
    type TriggerWorkflowOptions = WorkflowTriggerWorkflowOptions;

    /**
     * Triggers a workflow and returns its execution ID.
     * @param workflow_name
     * @param args
     * @param options
     */
    function triggerWorkflow(
      workflow_name: string,
      args?: any,
      options?: TriggerWorkflowOptions,
    ): Promise<string>;

    /**
     * Triggers a job function and returns its result.
     * @param job_name
     * @param args
     */
    function triggerJobFunction(job_name: string, args?: any): any;

    /**
     * Suspends the current workflow execution and waits for an external signal to resume.
     * @param key
     * @param payload
     */
    function wait(key: string, payload?: any): any;

    /**
     * Resolves a waiting workflow execution, causing it to resume.
     * @param executionId
     * @param key
     * @param callback
     */
    function resolve(
      executionId: string,
      key: string,
      callback: (waitPayload: any) => any,
    ): Promise<void>;
  }

  namespace tailor.context {
    type Invoker = ContextInvoker;

    /**
     * Returns information about the invoker of the current function execution,
     * or `null` for anonymous invocations.
     */
    function getInvoker(): Invoker | null;
  }
}

/**
 * Sentinel marker so that bundlers retain this module's `declare global` block
 * in the emitted `.d.mts` instead of tree-shaking it down to `export {}`.
 * Not part of the public SDK API.
 * @internal
 */
export const __TAILOR_RUNTIME_GLOBALS_LOADED__: true = true;
