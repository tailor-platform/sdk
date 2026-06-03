/**
 * TailorDB file (BLOB) utilities.
 *
 * Thin typed wrapper around the platform-provided `tailordb.file` runtime API.
 * At runtime this delegates to `globalThis.tailordb.file`. Use `fileMock` from
 * `@tailor-platform/sdk/vitest` to mock these calls in unit tests.
 * @example
 * import { file } from "@tailor-platform/sdk/runtime";
 *
 * const { metadata } = await file.upload(
 *   "my-namespace",
 *   "Document",
 *   "attachment",
 *   recordId,
 *   bytes,
 * );
 */

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

/** File metadata (for {@link getMetadata}). */
export interface FileMetadata {
  contentType: string;
  fileSize: number;
  sha256sum: string;
  urlPath: string;
  lastUploadedAt?: string;
}

/** Stream metadata (first chunk emitted by {@link openDownloadStream}). */
export interface StreamMetadata {
  contentType: string;
  fileSize: number;
  sha256sum: string;
}

/** Upload options. */
export interface FileUploadOptions {
  contentType?: string;
}

/** Upload stream options. */
export interface FileUploadStreamOptions {
  contentType?: string;
  fileSize?: number;
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

/** Download stream response. */
export interface FileDownloadStreamResponse {
  body: ReadableStream<Uint8Array>;
  metadata: DownloadMetadata;
}

/** Stream chunk types emitted by {@link FileStreamIterator}. */
export type StreamValue =
  | { type: "metadata"; metadata: StreamMetadata }
  | { type: "chunk"; data: Uint8Array; position: number }
  | { type: "complete" };

/** Stream iterator returned by {@link openDownloadStream}. */
export interface FileStreamIterator extends AsyncIterableIterator<StreamValue> {
  next(): Promise<IteratorResult<StreamValue>>;
  close(): Promise<void>;
}

/** Error code emitted by {@link TailorDBFileError}. */
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

/**
 * Platform API surface for `tailordb.file`. Describes the shape the platform
 * runtime injects on `globalThis.tailordb.file`.
 *
 * Each method below is also re-exported as a top-level named export from this
 * module (e.g. `upload`, `download`, `deleteFile`) so callers can either
 * `import * as file from "@tailor-platform/sdk/runtime/file"` or pick
 * individual methods.
 */
export interface TailorDBFileAPI {
  /**
   * Upload a file to TailorDB.
   * @param namespace - TailorDB namespace
   * @param typeName - TailorDB type name
   * @param fieldName - File field name on the type
   * @param recordId - Record ID owning the field
   * @param data - File contents
   * @param options - Upload options (e.g. `contentType`)
   * @returns Upload response containing the file metadata
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
   * Download a file from TailorDB.
   *
   * Throws `TailorDBFileError` with code `FILE_TOO_LARGE` when the file
   * exceeds 10MB — use {@link downloadStream} for large files.
   * @param namespace - TailorDB namespace
   * @param typeName - TailorDB type name
   * @param fieldName - File field name on the type
   * @param recordId - Record ID owning the field
   * @returns Bytes and metadata for the file
   */
  download(
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
  ): Promise<FileDownloadResponse>;

  /**
   * Download a file from TailorDB as a Base64-encoded string.
   *
   * Throws `TailorDBFileError` with code `FILE_TOO_LARGE` when the file
   * exceeds 10MB — use {@link downloadStream} for large files.
   * @param namespace - TailorDB namespace
   * @param typeName - TailorDB type name
   * @param fieldName - File field name on the type
   * @param recordId - Record ID owning the field
   * @returns Base64-encoded contents and metadata for the file
   */
  downloadAsBase64(
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
  ): Promise<FileDownloadAsBase64Response>;

  /**
   * Delete a file from TailorDB. Exported as `deleteFile` (and aliased as
   * `delete`) so it can be used both with named and namespace imports.
   * @param namespace - TailorDB namespace
   * @param typeName - TailorDB type name
   * @param fieldName - File field name on the type
   * @param recordId - Record ID owning the field
   * @returns Resolves once the file has been deleted
   */
  delete(namespace: string, typeName: string, fieldName: string, recordId: string): Promise<void>;

  /**
   * Get file metadata from TailorDB.
   * @param namespace - TailorDB namespace
   * @param typeName - TailorDB type name
   * @param fieldName - File field name on the type
   * @param recordId - Record ID owning the field
   * @returns Metadata for the stored file
   */
  getMetadata(
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
  ): Promise<FileMetadata>;

  /**
   * Open a download stream for large files.
   * @deprecated Use {@link downloadStream} instead.
   * @param namespace - TailorDB namespace
   * @param typeName - TailorDB type name
   * @param fieldName - File field name on the type
   * @param recordId - Record ID owning the field
   * @returns Async iterator yielding file chunks; call `close()` to release resources
   */
  openDownloadStream(
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
  ): Promise<FileStreamIterator>;

  /**
   * Download a file as a ReadableStream.
   * @param namespace - TailorDB namespace
   * @param typeName - TailorDB type name
   * @param fieldName - File field name on the type
   * @param recordId - Record ID owning the field
   * @returns ReadableStream body and metadata for the file
   */
  downloadStream(
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
  ): Promise<FileDownloadStreamResponse>;

  /**
   * Upload a file using a ReadableStream.
   * @param namespace - TailorDB namespace
   * @param typeName - TailorDB type name
   * @param fieldName - File field name on the type
   * @param recordId - Record ID owning the field
   * @param readableStream - ReadableStream providing the file data
   * @param options - Upload stream options (e.g. `contentType`, `fileSize`)
   * @returns Upload response containing the file metadata
   */
  uploadStream(
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
    readableStream: ReadableStream<Uint8Array | ArrayBuffer>,
    options?: FileUploadStreamOptions,
  ): Promise<FileUploadResponse>;
}

const api = (): TailorDBFileAPI =>
  (globalThis as { tailordb: { file: TailorDBFileAPI } }).tailordb.file;

/**
 * See {@link TailorDBFileAPI.upload}.
 * @param args - Forwarded to {@link TailorDBFileAPI.upload}
 * @returns Upload response containing the file metadata
 */
export const upload: TailorDBFileAPI["upload"] = (...args) => api().upload(...args);

/**
 * See {@link TailorDBFileAPI.download}.
 * @param args - Forwarded to {@link TailorDBFileAPI.download}
 * @returns Bytes and metadata for the file
 */
export const download: TailorDBFileAPI["download"] = (...args) => api().download(...args);

/**
 * See {@link TailorDBFileAPI.downloadAsBase64}.
 * @param args - Forwarded to {@link TailorDBFileAPI.downloadAsBase64}
 * @returns Base64-encoded contents and metadata for the file
 */
export const downloadAsBase64: TailorDBFileAPI["downloadAsBase64"] = (...args) =>
  api().downloadAsBase64(...args);

/**
 * See {@link TailorDBFileAPI.delete}.
 * @param args - Forwarded to {@link TailorDBFileAPI.delete}
 * @returns Resolves once the file has been deleted
 */
export const deleteFile: TailorDBFileAPI["delete"] = (...args) => api().delete(...args);

/**
 * See {@link TailorDBFileAPI.getMetadata}.
 * @param args - Forwarded to {@link TailorDBFileAPI.getMetadata}
 * @returns Metadata for the stored file
 */
export const getMetadata: TailorDBFileAPI["getMetadata"] = (...args) => api().getMetadata(...args);

/**
 * See {@link TailorDBFileAPI.openDownloadStream}.
 * @deprecated Use {@link downloadStream} instead.
 * @param args - Forwarded to {@link TailorDBFileAPI.openDownloadStream}
 * @returns Async iterator yielding file chunks; call `close()` to release resources
 */
export const openDownloadStream: TailorDBFileAPI["openDownloadStream"] = (...args) =>
  api().openDownloadStream(...args);

/**
 * See {@link TailorDBFileAPI.downloadStream}.
 * @param args - Forwarded to {@link TailorDBFileAPI.downloadStream}
 * @returns ReadableStream body and metadata for the file
 */
export const downloadStream: TailorDBFileAPI["downloadStream"] = (...args) =>
  api().downloadStream(...args);

/**
 * See {@link TailorDBFileAPI.uploadStream}.
 * @param args - Forwarded to {@link TailorDBFileAPI.uploadStream}
 * @returns Upload response containing the file metadata
 */
export const uploadStream: TailorDBFileAPI["uploadStream"] = (...args) =>
  api().uploadStream(...args);

export { deleteFile as delete };
