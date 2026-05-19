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
 * @internal
 */
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
export function upload(
  namespace: string,
  typeName: string,
  fieldName: string,
  recordId: string,
  data: string | ArrayBuffer | Uint8Array | number[],
  options?: FileUploadOptions,
): Promise<FileUploadResponse> {
  return (globalThis as { tailordb: { file: TailorDBFileAPI } }).tailordb.file.upload(
    namespace,
    typeName,
    fieldName,
    recordId,
    data,
    options,
  );
}

/**
 * Download a file from TailorDB.
 *
 * Throws `TailorDBFileError` with code `FILE_TOO_LARGE` when the file
 * exceeds 10MB — use {@link openDownloadStream} for large files.
 * @param namespace - TailorDB namespace
 * @param typeName - TailorDB type name
 * @param fieldName - File field name on the type
 * @param recordId - Record ID owning the field
 * @returns Bytes and metadata for the file
 */
export function download(
  namespace: string,
  typeName: string,
  fieldName: string,
  recordId: string,
): Promise<FileDownloadResponse> {
  return (globalThis as { tailordb: { file: TailorDBFileAPI } }).tailordb.file.download(
    namespace,
    typeName,
    fieldName,
    recordId,
  );
}

/**
 * Download a file from TailorDB as a Base64-encoded string.
 *
 * Throws `TailorDBFileError` with code `FILE_TOO_LARGE` when the file
 * exceeds 10MB — use {@link openDownloadStream} for large files.
 * @param namespace - TailorDB namespace
 * @param typeName - TailorDB type name
 * @param fieldName - File field name on the type
 * @param recordId - Record ID owning the field
 * @returns Base64-encoded contents and metadata for the file
 */
export function downloadAsBase64(
  namespace: string,
  typeName: string,
  fieldName: string,
  recordId: string,
): Promise<FileDownloadAsBase64Response> {
  return (globalThis as { tailordb: { file: TailorDBFileAPI } }).tailordb.file.downloadAsBase64(
    namespace,
    typeName,
    fieldName,
    recordId,
  );
}

/**
 * Delete a file from TailorDB.
 * @param namespace - TailorDB namespace
 * @param typeName - TailorDB type name
 * @param fieldName - File field name on the type
 * @param recordId - Record ID owning the field
 * @returns Resolves once the file has been deleted
 */
export function deleteFile(
  namespace: string,
  typeName: string,
  fieldName: string,
  recordId: string,
): Promise<void> {
  return (globalThis as { tailordb: { file: TailorDBFileAPI } }).tailordb.file.delete(
    namespace,
    typeName,
    fieldName,
    recordId,
  );
}

/**
 * Get file metadata from TailorDB.
 * @param namespace - TailorDB namespace
 * @param typeName - TailorDB type name
 * @param fieldName - File field name on the type
 * @param recordId - Record ID owning the field
 * @returns Metadata for the stored file
 */
export function getMetadata(
  namespace: string,
  typeName: string,
  fieldName: string,
  recordId: string,
): Promise<FileMetadata> {
  return (globalThis as { tailordb: { file: TailorDBFileAPI } }).tailordb.file.getMetadata(
    namespace,
    typeName,
    fieldName,
    recordId,
  );
}

/**
 * Open a download stream for large files.
 * @param namespace - TailorDB namespace
 * @param typeName - TailorDB type name
 * @param fieldName - File field name on the type
 * @param recordId - Record ID owning the field
 * @returns Async iterator yielding file chunks; call `close()` to release resources
 */
export function openDownloadStream(
  namespace: string,
  typeName: string,
  fieldName: string,
  recordId: string,
): Promise<FileStreamIterator> {
  return (globalThis as { tailordb: { file: TailorDBFileAPI } }).tailordb.file.openDownloadStream(
    namespace,
    typeName,
    fieldName,
    recordId,
  );
}

export { deleteFile as delete };
