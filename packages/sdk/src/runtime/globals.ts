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

/* eslint-disable @typescript-eslint/no-namespace, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-param-description */
declare global {
  namespace Tailordb {
    class Client {
      constructor(config: { namespace: string });
      connect(): Promise<void>;
      end(): Promise<void>;
      queryObject<O>(sql: string, args?: readonly unknown[]): Promise<QueryResult<O>>;
    }

    interface QueryResult<T> {
      rows: T[];
      command: CommandType;
      rowCount: number;
    }

    type CommandType =
      | "INSERT"
      | "DELETE"
      | "UPDATE"
      | "SELECT"
      | "MOVE"
      | "FETCH"
      | "COPY"
      | "CREATE";
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // TailorDB File Extension Types

  /**
   * Custom error class for TailorDB File operations
   */
  class TailorDBFileError extends Error {
    name: "TailorDBFileError";
    code?:
      | "INVALID_PARAMS"
      | "INVALID_DATA_TYPE"
      | "OPERATION_FAILED"
      | "DELETE_FAILED"
      | "STREAM_OPEN_FAILED"
      | "STREAM_READ_ERROR"
      | "STREAM_ERROR"
      | "FILE_TOO_LARGE";
    cause?: unknown;
  }

  /**
   * Upload response metadata
   */
  interface UploadMetadata {
    fileSize: number;
    sha256sum: string;
  }

  /**
   * Download response metadata
   */
  interface DownloadMetadata {
    contentType: string;
    fileSize: number;
    sha256sum: string;
    lastUploadedAt: string;
  }

  /**
   * File metadata (for getMetadata API)
   */
  interface FileMetadata {
    contentType: string;
    fileSize: number;
    sha256sum: string;
    urlPath: string;
    lastUploadedAt?: string;
  }

  /**
   * Stream metadata (first chunk)
   */
  interface StreamMetadata {
    contentType: string;
    fileSize: number;
    sha256sum: string;
  }

  /**
   * Upload options interface
   */
  interface FileUploadOptions {
    contentType?: string;
  }

  /**
   * Upload response interface
   */
  interface FileUploadResponse {
    metadata: UploadMetadata;
  }

  /**
   * Download response interface
   */
  interface FileDownloadResponse {
    data: Uint8Array;
    metadata: DownloadMetadata;
  }

  /**
   * Download as Base64 response interface
   */
  interface FileDownloadAsBase64Response {
    data: string;
    metadata: DownloadMetadata;
  }

  /**
   * Stream chunk types
   */
  type StreamValue =
    | { type: "metadata"; metadata: StreamMetadata }
    | { type: "chunk"; data: Uint8Array; position: number }
    | { type: "complete" };

  /**
   * Stream iterator interface
   */
  interface FileStreamIterator extends AsyncIterableIterator<StreamValue> {
    next(): Promise<IteratorResult<StreamValue>>;
    close(): Promise<void>;
  }

  /**
   * TailorDB File API
   */
  interface TailorDBFileAPI {
    /**
     * Upload a file to TailorDB
     */
    upload(
      namespace: string,
      typeName: string,
      fieldName: string,
      recordId: string,
      data: string | ArrayBuffer | Uint8Array | number[],
      options?: FileUploadOptions,
    ): Promise<FileUploadResponse>;

    /**
     * Download a file from TailorDB
     * @throws {TailorDBFileError} FILE_TOO_LARGE if file exceeds 10MB - use openDownloadStream() for large files
     */
    download(
      namespace: string,
      typeName: string,
      fieldName: string,
      recordId: string,
    ): Promise<FileDownloadResponse>;

    /**
     * Download a file from TailorDB as Base64 string.
     * Unlike download which returns decoded binary data (Uint8Array),
     * this returns the raw Base64-encoded string for use cases requiring
     * Base64 format (e.g., embedding in JSON responses, data URIs).
     * @throws {TailorDBFileError} FILE_TOO_LARGE if file exceeds 10MB - use openDownloadStream() for large files
     */
    downloadAsBase64(
      namespace: string,
      typeName: string,
      fieldName: string,
      recordId: string,
    ): Promise<FileDownloadAsBase64Response>;

    /**
     * Delete a file from TailorDB
     */
    delete(namespace: string, typeName: string, fieldName: string, recordId: string): Promise<void>;

    /**
     * Get file metadata from TailorDB
     */
    getMetadata(
      namespace: string,
      typeName: string,
      fieldName: string,
      recordId: string,
    ): Promise<FileMetadata>;

    /**
     * Open a download stream for large files
     */
    openDownloadStream(
      namespace: string,
      typeName: string,
      fieldName: string,
      recordId: string,
    ): Promise<FileStreamIterator>;
  }

  namespace tailor.idp {
    /**
     * Configuration for creating an IDP Client
     */
    interface ClientConfig {
      namespace: string;
    }

    /**
     * User object returned from IDP operations
     */
    interface User {
      id: string;
      name: string;
      disabled: boolean;
      createdAt?: string;
      updatedAt?: string;
    }

    /**
     * Query options for filtering users
     */
    interface UserQuery {
      /** Filter by user IDs */
      ids?: string[];
      /** Filter by user names */
      names?: string[];
    }

    /**
     * Options for listing users
     */
    interface ListUsersOptions {
      /** Maximum number of users to return */
      first?: number;
      /** Page token for pagination */
      after?: string;
      /** Query filter for users */
      query?: UserQuery;
    }

    /**
     * Response from listing users
     */
    interface ListUsersResponse {
      users: User[];
      nextPageToken: string | null;
      totalCount: number;
    }

    /**
     * Input for creating a new user
     */
    interface CreateUserInput {
      /** The user's name (typically email) */
      name: string;
      /** The user's password. If omitted, the user is created without a password (cannot log in with any password). */
      password?: string;
      /** Whether the user is disabled */
      disabled?: boolean;
    }

    /**
     * Input for updating an existing user
     */
    interface UpdateUserInput {
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

    /**
     * Input for sending a password reset email
     */
    interface SendPasswordResetEmailInput {
      /** The ID of the user */
      userId: string;
      /** The URI to redirect to after password reset */
      redirectUri: string;
      /** The sender display name. Defaults to 'Tailor Platform IdP'. */
      fromName?: string;
      /** The email subject line. Defaults to the localized default subject. */
      subject?: string;
    }

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
    /**
     * Specifies the machine user that should be used to execute the workflow.
     * This allows workflows to run with specific authentication context.
     */
    interface AuthInvoker {
      /** The namespace where the machine user is defined */
      namespace: string;
      /** The name of the machine user to use for workflow execution */
      machineUserName: string;
    }

    /**
     * Options for triggering a workflow
     */
    interface TriggerWorkflowOptions {
      /** Optional authentication invoker to specify which machine user should execute the workflow */
      authInvoker?: AuthInvoker;
    }

    /**
     * Triggers a workflow and returns its execution ID.
     * @param workflow_name
     * @param args
     * @param options
     */
    function triggerWorkflow(
      workflow_name: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args?: any,
      options?: TriggerWorkflowOptions,
    ): Promise<string>;

    /**
     * Triggers a job function and returns its result.
     * @param job_name
     * @param args
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function triggerJobFunction(job_name: string, args?: any): any;

    /**
     * Suspends the current workflow execution and waits for an external signal to resume.
     * The workflow will be parked in "Waiting" status until resolved via `resolve()`.
     * @param key
     * @param payload
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function wait(key: string, payload?: any): any;

    /**
     * Resolves a waiting workflow execution, causing it to resume.
     * The callback receives the wait payload and must return a JSON-serializable result
     * that will be passed back to the `wait()` caller.
     * @param executionId
     * @param key
     * @param callback
     */
    function resolve(
      executionId: string,
      key: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback: (waitPayload: any) => any,
    ): Promise<void>;
  }

  namespace tailor.context {
    /**
     * Information about the invoker of the current function execution.
     */
    interface Invoker {
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
