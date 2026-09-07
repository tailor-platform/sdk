/**
 * TailorDB file (BLOB) utilities.
 *
 * Thin typed wrapper around the platform-provided `tailordb.file` runtime API.
 * At runtime this delegates to `globalThis.tailordb.file`. Use `mockFile` from
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

/** File metadata (for {@link TailorDBFileAPI.getMetadata}). */
export interface FileMetadata {
  contentType: string;
  fileSize: number;
  sha256sum: string;
  urlPath: string;
  lastUploadedAt?: string;
}

/** Upload options. */
export interface FileUploadOptions {
  contentType?: string;
  /** How to interpret string data. Ignored for byte arrays and buffers. */
  encoding?: "utf8" | "base64";
}

/** Upload options with an explicit interpretation for string data. */
export interface FileUploadStringOptions extends FileUploadOptions {
  encoding: "utf8" | "base64";
}

/** Binary contents accepted by {@link file.upload}. */
export type FileUploadBytes = ArrayBuffer | Uint8Array | number[];

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
 */
export interface TailorDBFileAPI {
  /**
   * Upload a file to TailorDB.
   * @param namespace - TailorDB namespace
   * @param tableName - TailorDB table name
   * @param fieldName - File field name on the table
   * @param recordId - Record ID owning the field
   * @param data - File contents
   * @param options - Upload options (e.g. `contentType`)
   * @returns Upload response containing the file metadata
   */
  upload(
    namespace: string,
    tableName: string,
    fieldName: string,
    recordId: string,
    data: string | FileUploadBytes,
    options?: Omit<FileUploadOptions, "encoding">,
  ): Promise<FileUploadResponse>;

  /**
   * Download a file from TailorDB.
   *
   * Throws `TailorDBFileError` with code `FILE_TOO_LARGE` when the file
   * exceeds 10MB — use {@link downloadStream} for large files.
   * @param namespace - TailorDB namespace
   * @param tableName - TailorDB table name
   * @param fieldName - File field name on the table
   * @param recordId - Record ID owning the field
   * @returns Bytes and metadata for the file
   */
  download(
    namespace: string,
    tableName: string,
    fieldName: string,
    recordId: string,
  ): Promise<FileDownloadResponse>;

  /**
   * Download a file from TailorDB as a Base64-encoded string.
   *
   * Throws `TailorDBFileError` with code `FILE_TOO_LARGE` when the file
   * exceeds 10MB — use {@link downloadStream} for large files.
   * @param namespace - TailorDB namespace
   * @param tableName - TailorDB table name
   * @param fieldName - File field name on the table
   * @param recordId - Record ID owning the field
   * @returns Base64-encoded contents and metadata for the file
   */
  downloadAsBase64(
    namespace: string,
    tableName: string,
    fieldName: string,
    recordId: string,
  ): Promise<FileDownloadAsBase64Response>;

  /**
   * Delete a file from TailorDB.
   * @param namespace - TailorDB namespace
   * @param tableName - TailorDB table name
   * @param fieldName - File field name on the table
   * @param recordId - Record ID owning the field
   * @returns Resolves once the file has been deleted
   */
  delete(namespace: string, tableName: string, fieldName: string, recordId: string): Promise<void>;

  /**
   * Get file metadata from TailorDB.
   * @param namespace - TailorDB namespace
   * @param tableName - TailorDB table name
   * @param fieldName - File field name on the table
   * @param recordId - Record ID owning the field
   * @returns Metadata for the stored file
   */
  getMetadata(
    namespace: string,
    tableName: string,
    fieldName: string,
    recordId: string,
  ): Promise<FileMetadata>;

  /**
   * Download a file as a ReadableStream.
   * @param namespace - TailorDB namespace
   * @param tableName - TailorDB table name
   * @param fieldName - File field name on the table
   * @param recordId - Record ID owning the field
   * @returns ReadableStream body and metadata for the file
   */
  downloadStream(
    namespace: string,
    tableName: string,
    fieldName: string,
    recordId: string,
  ): Promise<FileDownloadStreamResponse>;

  /**
   * Upload a file using a ReadableStream.
   * @param namespace - TailorDB namespace
   * @param tableName - TailorDB table name
   * @param fieldName - File field name on the table
   * @param recordId - Record ID owning the field
   * @param readableStream - ReadableStream providing the file data
   * @param options - Upload stream options (e.g. `contentType`, `fileSize`)
   * @returns Upload response containing the file metadata
   */
  uploadStream(
    namespace: string,
    tableName: string,
    fieldName: string,
    recordId: string,
    readableStream: ReadableStream<Uint8Array | ArrayBuffer>,
    options?: FileUploadStreamOptions,
  ): Promise<FileUploadResponse>;
}

const api = (): TailorDBFileAPI =>
  (globalThis as unknown as { tailordb: { file: TailorDBFileAPI } }).tailordb.file;

const DATA_URL_PREFIX = /^data:([^,]*);base64,/i;

function stripBase64DataUrl(data: string): { contentType?: string; payload: string } {
  const match = DATA_URL_PREFIX.exec(data);
  if (!match) return { payload: data };
  return { contentType: match[1] || undefined, payload: data.slice(match[0].length) };
}

function decodeBase64(data: string): Uint8Array {
  if (typeof Uint8Array.fromBase64 === "function") {
    try {
      return Uint8Array.fromBase64(data);
    } catch {
      throw new TypeError("Invalid Base64 file data.");
    }
  }

  // Uint8Array.fromBase64 is unflagged only from Node 25 (V8 14.1); decode manually before that.
  const base64 = data.replace(/[\t\n\f\r ]/g, "");
  if (
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) ||
    base64.length % 4 === 1 ||
    (base64.includes("=") && base64.length % 4 !== 0)
  ) {
    throw new TypeError("Invalid Base64 file data.");
  }
  const decoded = atob(base64);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

/**
 * Upload file bytes without encoding or decoding them.
 * @param namespace - TailorDB namespace
 * @param tableName - TailorDB table name
 * @param fieldName - File field name on the table
 * @param recordId - Record ID owning the field
 * @param data - File bytes
 * @param options - Upload options; encoding is ignored for bytes
 * @returns Upload response containing the file metadata
 */
function upload(
  namespace: string,
  tableName: string,
  fieldName: string,
  recordId: string,
  data: FileUploadBytes,
  options?: FileUploadOptions,
): Promise<FileUploadResponse>;
/**
 * Upload text as UTF-8 or decode Base64 into file bytes.
 * @param namespace - TailorDB namespace
 * @param tableName - TailorDB table name
 * @param fieldName - File field name on the table
 * @param recordId - Record ID owning the field
 * @param data - String to encode or decode, or file bytes to upload unchanged; a base64 value
 * may be a `data:<contentType>;base64,<payload>` URL, whose content type is extracted
 * @param options - String encoding and optional content type; utf8 defaults contentType to text/plain; charset=utf-8 when omitted
 * @returns Upload response containing the file metadata
 * @throws {TypeError} If the encoding is unsupported or Base64 data is invalid
 */
function upload(
  namespace: string,
  tableName: string,
  fieldName: string,
  recordId: string,
  data: string | FileUploadBytes,
  options: FileUploadStringOptions,
): Promise<FileUploadResponse>;
/**
 * Upload file contents, treating strings without encoding as text.
 * @deprecated since NEXT_RELEASE — pass encoding: "utf8" for text or "base64" for Base64 strings. codemod: v3/file-upload-encoding
 * @param namespace - TailorDB namespace
 * @param tableName - TailorDB table name
 * @param fieldName - File field name on the table
 * @param recordId - Record ID owning the field
 * @param data - File contents
 * @param options - Upload options
 * @returns Upload response containing the file metadata
 */
function upload(
  namespace: string,
  tableName: string,
  fieldName: string,
  recordId: string,
  data: string | FileUploadBytes,
  options?: FileUploadOptions,
): Promise<FileUploadResponse>;
async function upload(
  namespace: string,
  tableName: string,
  fieldName: string,
  recordId: string,
  data: string | FileUploadBytes,
  options?: FileUploadOptions,
): Promise<FileUploadResponse> {
  if (options?.encoding === undefined) {
    return api().upload(namespace, tableName, fieldName, recordId, data, options);
  }

  const { encoding, ...uploadOptions } = options;
  let contents = data;
  if (typeof data === "string") {
    switch (encoding) {
      case "utf8":
        contents = new TextEncoder().encode(data);
        uploadOptions.contentType ??= "text/plain; charset=utf-8";
        break;
      case "base64": {
        const { contentType, payload } = stripBase64DataUrl(data);
        contents = decodeBase64(payload);
        uploadOptions.contentType ??= contentType;
        break;
      }
      default:
        throw new TypeError(`Unsupported file upload encoding: ${encoding}`);
    }
  }
  return api().upload(namespace, tableName, fieldName, recordId, contents, uploadOptions);
}

/**
 * See {@link TailorDBFileAPI.download}.
 * @param args - Forwarded to {@link TailorDBFileAPI.download}
 * @returns Bytes and metadata for the file
 */
const download: TailorDBFileAPI["download"] = (...args) => api().download(...args);

/**
 * See {@link TailorDBFileAPI.downloadAsBase64}.
 * @param args - Forwarded to {@link TailorDBFileAPI.downloadAsBase64}
 * @returns Base64-encoded contents and metadata for the file
 */
const downloadAsBase64: TailorDBFileAPI["downloadAsBase64"] = (...args) =>
  api().downloadAsBase64(...args);

/**
 * See {@link TailorDBFileAPI.delete}.
 * @param args - Forwarded to {@link TailorDBFileAPI.delete}
 * @returns Resolves once the file has been deleted
 */
const deleteFile: TailorDBFileAPI["delete"] = (...args) => api().delete(...args);

/**
 * See {@link TailorDBFileAPI.getMetadata}.
 * @param args - Forwarded to {@link TailorDBFileAPI.getMetadata}
 * @returns Metadata for the stored file
 */
const getMetadata: TailorDBFileAPI["getMetadata"] = (...args) => api().getMetadata(...args);

/**
 * See {@link TailorDBFileAPI.downloadStream}.
 * @param args - Forwarded to {@link TailorDBFileAPI.downloadStream}
 * @returns ReadableStream body and metadata for the file
 */
const downloadStream: TailorDBFileAPI["downloadStream"] = (...args) =>
  api().downloadStream(...args);

/**
 * See {@link TailorDBFileAPI.uploadStream}.
 * @param args - Forwarded to {@link TailorDBFileAPI.uploadStream}
 * @returns Upload response containing the file metadata
 */
const uploadStream: TailorDBFileAPI["uploadStream"] = (...args) => api().uploadStream(...args);

/** Runtime wrapper namespace for `tailordb.file`. */
export const file = {
  // oxlint-disable-next-line typescript/no-deprecated -- Only the legacy overload is deprecated.
  upload,
  download,
  downloadAsBase64,
  delete: deleteFile,
  getMetadata,
  downloadStream,
  uploadStream,
} as const satisfies TailorDBFileAPI;
