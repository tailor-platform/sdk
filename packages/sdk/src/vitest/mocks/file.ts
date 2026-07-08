import { tailordbRoot, withDispose } from "./shared";

type FileResolver = (method: string, call: FileCall) => unknown;

interface FileCall {
  method: string;
  namespace: string;
  typeName: string;
  fieldName: string;
  recordId: string;
}

// ---------------------------------------------------------------------------
// File Mock (tailordb.file)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FILE_DEFAULTS: Record<string, any> = {
  upload: { metadata: { fileSize: 0, sha256sum: "" } },
  download: {
    data: new Uint8Array(),
    metadata: { contentType: "", fileSize: 0, sha256sum: "", lastUploadedAt: "" },
  },
  downloadAsBase64: {
    data: "",
    metadata: { contentType: "", fileSize: 0, sha256sum: "", lastUploadedAt: "" },
  },
  delete: undefined,
  getMetadata: { contentType: "", fileSize: 0, sha256sum: "", urlPath: "" },
  downloadStream: null,
  uploadStream: { metadata: { fileSize: 0, sha256sum: "" } },
};

/**
 * Acquire a disposable mock for `tailordb.file`. Restored on dispose.
 * @returns Disposable File mock control object
 * @example
 * ```typescript
 * import { mockFile } from "@tailor-platform/sdk/vitest";
 *
 * test("mock file download", async () => {
 *   using file = mockFile();
 *   file.enqueueResult({ data: new Uint8Array([1, 2, 3]), metadata: { ... } });
 *   // …
 * });
 * ```
 */
export function mockFile() {
  const root = tailordbRoot();
  const prev = root.file;

  const queue: unknown[] = [];
  let resolver: FileResolver = () => null;
  const calls: FileCall[] = [];

  function handle(
    method: string,
    namespace: string,
    typeName: string,
    fieldName: string,
    recordId: string,
  ): unknown {
    const call: FileCall = { method, namespace, typeName, fieldName, recordId };
    calls.push(call);
    if (queue.length > 0) return queue.shift();
    const resolved = resolver(method, call);
    if (resolved != null) return resolved;
    const fallback = FILE_DEFAULTS[method];
    return fallback === undefined ? undefined : structuredClone(fallback);
  }

  root.file = {
    async upload(namespace: string, typeName: string, fieldName: string, recordId: string) {
      return handle("upload", namespace, typeName, fieldName, recordId);
    },
    async download(namespace: string, typeName: string, fieldName: string, recordId: string) {
      return handle("download", namespace, typeName, fieldName, recordId);
    },
    async downloadAsBase64(
      namespace: string,
      typeName: string,
      fieldName: string,
      recordId: string,
    ) {
      return handle("downloadAsBase64", namespace, typeName, fieldName, recordId);
    },
    async delete(namespace: string, typeName: string, fieldName: string, recordId: string) {
      handle("delete", namespace, typeName, fieldName, recordId);
    },
    async getMetadata(namespace: string, typeName: string, fieldName: string, recordId: string) {
      return handle("getMetadata", namespace, typeName, fieldName, recordId);
    },
    async downloadStream(namespace: string, typeName: string, fieldName: string, recordId: string) {
      const resolved = handle("downloadStream", namespace, typeName, fieldName, recordId);
      if (resolved != null) return resolved;
      return {
        body: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        metadata: { contentType: "", fileSize: 0, sha256sum: "", lastUploadedAt: "" },
      };
    },
    async uploadStream(namespace: string, typeName: string, fieldName: string, recordId: string) {
      return handle("uploadStream", namespace, typeName, fieldName, recordId);
    },
  };

  const facade = {
    setResolver(value: FileResolver): void {
      resolver = value;
    },

    /**
     * Enqueue a single result for the next `tailordb.file` call (FIFO; falls
     * back to `setResolver` when exhausted).
     * @param result - Result to return from the next file call
     */
    enqueueResult(result: unknown): void {
      queue.push(result);
    },

    /**
     * Enqueue results for multiple subsequent `tailordb.file` calls.
     * @param results - Results to enqueue, one per upcoming call
     */
    enqueueResults(...results: unknown[]): void {
      queue.push(...results);
    },

    get calls(): FileCall[] {
      return calls;
    },

    reset(): void {
      queue.length = 0;
      resolver = () => null;
      calls.length = 0;
    },
  };

  return withDispose(facade, () => {
    root.file = prev;
  });
}
