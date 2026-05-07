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

import "./globals";

export type UploadMetadata = globalThis.UploadMetadata;
export type DownloadMetadata = globalThis.DownloadMetadata;
export type FileMetadata = globalThis.FileMetadata;
export type StreamMetadata = globalThis.StreamMetadata;
export type FileUploadOptions = globalThis.FileUploadOptions;
export type FileUploadResponse = globalThis.FileUploadResponse;
export type FileDownloadResponse = globalThis.FileDownloadResponse;
export type FileDownloadAsBase64Response = globalThis.FileDownloadAsBase64Response;
export type StreamValue = globalThis.StreamValue;
export type FileStreamIterator = globalThis.FileStreamIterator;
export type TailorDBFileError = globalThis.TailorDBFileError;

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
  return tailordb.file.upload(namespace, typeName, fieldName, recordId, data, options);
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
  return tailordb.file.download(namespace, typeName, fieldName, recordId);
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
  return tailordb.file.downloadAsBase64(namespace, typeName, fieldName, recordId);
}

/**
 * Delete a file from TailorDB.
 * @param namespace - TailorDB namespace
 * @param typeName - TailorDB type name
 * @param fieldName - File field name on the type
 * @param recordId - Record ID owning the field
 * @returns Resolves once the file has been deleted
 */
function deleteFile(
  namespace: string,
  typeName: string,
  fieldName: string,
  recordId: string,
): Promise<void> {
  return tailordb.file.delete(namespace, typeName, fieldName, recordId);
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
  return tailordb.file.getMetadata(namespace, typeName, fieldName, recordId);
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
  return tailordb.file.openDownloadStream(namespace, typeName, fieldName, recordId);
}

export { deleteFile as delete };
