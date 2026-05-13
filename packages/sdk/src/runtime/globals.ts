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

import type {
  ContextInvoker,
  IdpClientConfig,
  IdpCreateUserInput,
  IdpListUsersOptions,
  IdpListUsersResponse,
  IdpSendPasswordResetEmailInput,
  IdpUpdateUserInput,
  IdpUser,
  IdpUserQuery,
  TailorDBFileAPI,
  TailorDBFileErrorCode,
  TailordbCommandType,
  TailordbQueryResult,
  WorkflowAuthInvoker,
  WorkflowTriggerWorkflowOptions,
} from "./_runtime";

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
    constructor(message: string, code?: TailorDBFileErrorCode, cause?: unknown);
    name: "TailorDBFileError";
    code?: TailorDBFileErrorCode;
    cause?: unknown;
  }

  /** Individual error entry attached to {@link TailorErrors}. */
  interface TailorErrorItem {
    message: string;
    path: (string | number)[];
  }

  /**
   * Aggregate validation error raised by the Tailor Platform Function runtime.
   * The runtime serializes the items into the `message` (`"TailorErrors: {...}"`)
   * and also exposes them on `.errors`.
   */
  class TailorErrors extends Error {
    constructor(errors: TailorErrorItem[]);
    name: "TailorErrors";
    errors: TailorErrorItem[];
  }

  /**
   * Single-message error raised by the Tailor Platform Function runtime.
   */
  class TailorErrorMessage extends Error {
    constructor(message: string);
    name: "TailorErrorMessage";
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
