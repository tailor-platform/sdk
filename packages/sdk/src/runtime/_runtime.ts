/**
 * Internal runtime bindings shared by the typed wrappers in
 * `@tailor-platform/sdk/runtime/*`. Not part of the public API.
 *
 * - The exported `runtime` value reads `tailor` / `tailordb` from `globalThis`
 *   lazily through getters so wrappers stay decoupled from module-load order
 *   (mocks injected in `beforeEach` are picked up on next access).
 * - The exported module-scope types describe the platform runtime surface
 *   without introducing any ambient global declarations. The `declare global`
 *   block lives only in `./globals`, which callers opt into explicitly.
 * @internal
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Module-scope data types
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
 * is provided by the platform runtime (and by `injectMocks` in tests); this
 * interface mirrors it so callers can `import type { TailorDBFileError }` from
 * the wrapper module without depending on any ambient declaration.
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

/** Instance methods exposed by `tailor.idp.Client`. */
export interface IdpClientInstance {
  users(options?: IdpListUsersOptions): Promise<IdpListUsersResponse>;
  user(userId: string): Promise<IdpUser>;
  userByName(name: string): Promise<IdpUser>;
  createUser(input: IdpCreateUserInput): Promise<IdpUser>;
  updateUser(input: IdpUpdateUserInput): Promise<IdpUser>;
  deleteUser(userId: string): Promise<boolean>;
  sendPasswordResetEmail(input: IdpSendPasswordResetEmailInput): Promise<boolean>;
}

/** Constructor shape for `tailor.idp.Client`. */
export interface IdpClientConstructor {
  new (config: IdpClientConfig): IdpClientInstance;
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

// --- tailor.iconv ---------------------------------------------------------

/** Instance methods exposed by `tailor.iconv.Iconv`. */
export interface IconvInstance {
  convert(input: string | Uint8Array | ArrayBuffer): string | Uint8Array;
}

/** Constructor shape for `tailor.iconv.Iconv`. */
export interface IconvConstructor {
  new (fromEncoding: string, toEncoding: string): IconvInstance;
}

// ---------------------------------------------------------------------------
// API surface types — describe the shape of `globalThis.tailor` / `tailordb`
// without polluting any ambient namespace
// ---------------------------------------------------------------------------

/** `tailor.secretmanager` API surface. */
export interface TailorSecretmanagerAPI {
  getSecrets<const T extends readonly string[]>(
    vault: string,
    names: T,
  ): Promise<Partial<Record<T[number], string>>>;
  getSecret(vault: string, name: string): Promise<string | undefined>;
}

/** `tailor.authconnection` API surface. */
export interface TailorAuthconnectionAPI {
  getConnectionToken(connectionName: string): Promise<any>;
}

/** `tailor.iconv` API surface. */
export interface TailorIconvAPI {
  convert<T extends string>(
    str: string | Uint8Array | ArrayBuffer,
    fromEncoding: string,
    toEncoding: T,
  ): T extends "UTF8" | "UTF-8" ? string : Uint8Array;
  convertBuffer<T extends string>(
    buffer: Uint8Array | ArrayBuffer,
    fromEncoding: string,
    toEncoding: T,
  ): T extends "UTF8" | "UTF-8" ? string : Uint8Array;
  decode(buffer: Uint8Array | ArrayBuffer, encoding: string): string;
  encode<T extends string>(
    str: string,
    encoding: T,
  ): T extends "UTF8" | "UTF-8" ? string : Uint8Array;
  encodings(): string[];
  Iconv: IconvConstructor;
}

/** `tailor.idp` API surface. */
export interface TailorIdpAPI {
  Client: IdpClientConstructor;
}

/** `tailor.workflow` API surface. */
export interface TailorWorkflowAPI {
  triggerWorkflow(
    workflow_name: string,
    args?: any,
    options?: WorkflowTriggerWorkflowOptions,
  ): Promise<string>;
  triggerJobFunction(job_name: string, args?: any): any;
  wait(key: string, payload?: any): any;
  resolve(executionId: string, key: string, callback: (waitPayload: any) => any): Promise<void>;
}

/** `tailor.context` API surface. */
export interface TailorContextAPI {
  getInvoker(): ContextInvoker | null;
}

/** Top-level `tailor` runtime object. */
export interface TailorRuntime {
  secretmanager: TailorSecretmanagerAPI;
  authconnection: TailorAuthconnectionAPI;
  iconv: TailorIconvAPI;
  idp: TailorIdpAPI;
  workflow: TailorWorkflowAPI;
  context: TailorContextAPI;
}

/** Instance methods exposed by `tailordb.Client`. */
export interface TailordbClientInstance {
  connect(): Promise<void>;
  end(): Promise<void>;
  queryObject<O>(sql: string, args?: readonly unknown[]): Promise<TailordbQueryResult<O>>;
}

/** Constructor shape for `tailordb.Client`. */
export interface TailordbClientConstructor {
  new (config: { namespace: string }): TailordbClientInstance;
}

/** Top-level `tailordb` runtime object. */
export interface TailordbRuntime {
  Client: TailordbClientConstructor;
  file: TailorDBFileAPI;
}

// ---------------------------------------------------------------------------
// Typed accessor — reads `tailor` / `tailordb` from globalThis lazily.
// Importing this value does NOT activate any ambient global declarations.
// ---------------------------------------------------------------------------

interface RuntimeBindings {
  readonly tailor: TailorRuntime;
  readonly tailordb: TailordbRuntime;
}

/**
 * Lazy typed view of the platform runtime globals (`tailor`, `tailordb`).
 * Each property read returns the current `globalThis` value, so test setups
 * that inject mocks in `beforeEach` work without needing to re-import.
 */
export const runtime: RuntimeBindings = {
  get tailor() {
    return (globalThis as unknown as { tailor: TailorRuntime }).tailor;
  },
  get tailordb() {
    return (globalThis as unknown as { tailordb: TailordbRuntime }).tailordb;
  },
};
