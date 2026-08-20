import { type Mock, vi } from "vitest";
import { tailordbRoot, withDispose } from "./shared";
import type {
  FileDownloadAsBase64Response,
  FileDownloadResponse,
  FileDownloadStreamResponse,
  FileMetadata,
  FileUploadResponse,
  TailorDBFileAPI,
} from "../../runtime/file";

type FileMethod = keyof TailorDBFileAPI;
type FileResolver = (method: string, call: FileCall) => unknown;

interface FileCall {
  method: string;
  namespace: string;
  typeName: string;
  fieldName: string;
  recordId: string;
}

/** Controls fallback behavior for File calls without a configured result. */
export interface MockFileOptions {
  /** Return a type-compatible fixture or throw when no behavior is configured. */
  onUnhandled?: "fallback" | "error";
}

type FileMocks = {
  [Method in FileMethod]: Mock<TailorDBFileAPI[Method]>;
};

const FILE_METHODS = [
  "upload",
  "download",
  "downloadAsBase64",
  "delete",
  "getMetadata",
  "downloadStream",
  "uploadStream",
] as const satisfies readonly FileMethod[];

const FILE_DEFAULTS: Partial<Record<FileMethod, unknown>> = {
  upload: { metadata: { fileSize: 0, sha256sum: "" } },
  download: {
    data: new Uint8Array(),
    metadata: { contentType: "", fileSize: 0, sha256sum: "", lastUploadedAt: "" },
  },
  downloadAsBase64: {
    data: "",
    metadata: { contentType: "", fileSize: 0, sha256sum: "", lastUploadedAt: "" },
  },
  getMetadata: { contentType: "", fileSize: 0, sha256sum: "", urlPath: "" },
  downloadStream: null,
  uploadStream: { metadata: { fileSize: 0, sha256sum: "" } },
};

/**
 * Acquire a disposable mock for `tailordb.file`. Restored on dispose.
 * @param options - Controls behavior for calls without a configured result
 * @returns Disposable File mock control object
 * @example
 * ```typescript
 * import { mockFile } from "@tailor-platform/sdk/vitest";
 *
 * test("mock file download", async () => {
 *   using file = mockFile();
 *   file.download.mockResolvedValue({ data: new Uint8Array(), metadata: { ... } });
 *   // …
 * });
 * ```
 */
export function mockFile(options: MockFileOptions = {}) {
  const root = tailordbRoot();
  const prev = root.file;
  const { onUnhandled = "fallback" } = options;

  const queue: unknown[] = [];
  const calls: FileCall[] = [];
  let resolver: FileResolver = () => null;

  function handle(
    method: FileMethod,
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
  ): unknown {
    if (queue.length > 0) return queue.shift();
    const call: FileCall = { method, namespace, typeName, fieldName, recordId };
    const resolved = resolver(method, call);
    if (resolved != null) return resolved;
    if (onUnhandled === "error") {
      throw new Error(`No File mock configured for "${method}"`);
    }
    const fallback = FILE_DEFAULTS[method];
    return fallback === undefined ? undefined : structuredClone(fallback);
  }

  const upload = vi.fn<TailorDBFileAPI["upload"]>(async (...args) => {
    const [namespace, typeName, fieldName, recordId] = args;
    return handle("upload", namespace, typeName, fieldName, recordId) as FileUploadResponse;
  });
  const download = vi.fn<TailorDBFileAPI["download"]>(
    async (...args) => handle("download", ...args) as FileDownloadResponse,
  );
  const downloadAsBase64 = vi.fn<TailorDBFileAPI["downloadAsBase64"]>(
    async (...args) => handle("downloadAsBase64", ...args) as FileDownloadAsBase64Response,
  );
  const deleteFile = vi.fn<TailorDBFileAPI["delete"]>(async (...args) => {
    handle("delete", ...args);
  });
  const getMetadata = vi.fn<TailorDBFileAPI["getMetadata"]>(
    async (...args) => handle("getMetadata", ...args) as FileMetadata,
  );
  const downloadStream = vi.fn<TailorDBFileAPI["downloadStream"]>(async (...args) => {
    const resolved = handle("downloadStream", ...args);
    if (resolved != null) return resolved as FileDownloadStreamResponse;
    return {
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      metadata: { contentType: "", fileSize: 0, sha256sum: "", lastUploadedAt: "" },
    };
  });
  const uploadStream = vi.fn<TailorDBFileAPI["uploadStream"]>(async (...args) => {
    const [namespace, typeName, fieldName, recordId] = args;
    return handle("uploadStream", namespace, typeName, fieldName, recordId) as FileUploadResponse;
  });

  const mocks: FileMocks = {
    upload,
    download,
    downloadAsBase64,
    delete: deleteFile,
    getMetadata,
    downloadStream,
    uploadStream,
  };

  function track<Method extends FileMethod>(
    method: Method,
    operation: TailorDBFileAPI[Method],
  ): TailorDBFileAPI[Method] {
    return function (this: unknown, ...args: Parameters<TailorDBFileAPI[Method]>) {
      calls.push({
        method,
        namespace: args[0],
        typeName: args[1],
        fieldName: args[2],
        recordId: args[3],
      });
      return (
        operation as (
          ...call: Parameters<TailorDBFileAPI[Method]>
        ) => ReturnType<TailorDBFileAPI[Method]>
      ).apply(this, args);
    } as TailorDBFileAPI[Method];
  }

  root.file = {
    upload: track("upload", upload),
    download: track("download", download),
    downloadAsBase64: track("downloadAsBase64", downloadAsBase64),
    delete: track("delete", deleteFile),
    getMetadata: track("getMetadata", getMetadata),
    downloadStream: track("downloadStream", downloadStream),
    uploadStream: track("uploadStream", uploadStream),
  };

  function allMocks(): Mock[] {
    return FILE_METHODS.map((method) => mocks[method] as Mock);
  }

  const facade = {
    ...mocks,

    setResolver(value: FileResolver): void {
      resolver = value;
    },

    /**
     * Enqueue a single result for the next `tailordb.file` call.
     * The queue is shared across all methods and namespaces.
     * @param result - Result to return from the next file call
     */
    enqueueResult(result: unknown): void {
      queue.push(result);
    },

    /**
     * Enqueue results for multiple subsequent `tailordb.file` calls.
     * The queue is shared across all methods and namespaces.
     * @param results - Results to enqueue, one per upcoming call
     */
    enqueueResults(...results: unknown[]): void {
      queue.push(...results);
    },

    get calls(): FileCall[] {
      return calls;
    },

    clear(): void {
      calls.length = 0;
      for (const mock of allMocks()) mock.mockClear();
    },

    reset(): void {
      queue.length = 0;
      calls.length = 0;
      resolver = () => null;
      for (const mock of allMocks()) mock.mockReset();
    },
  };

  return withDispose(facade, () => {
    root.file = prev;
  });
}
