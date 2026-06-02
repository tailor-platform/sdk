/**
 * Tests for `@tailor-platform/sdk/runtime/file` typed wrappers.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import * as file from "@/runtime/file";
import { cleanupMocks, mockFile, injectMocks } from "@/vitest/mock";

describe("@tailor-platform/sdk/runtime/file", () => {
  beforeEach(() => {
    injectMocks(globalThis);
  });

  afterEach(() => {
    cleanupMocks(globalThis);
  });

  test("upload forwards args and records the call", async () => {
    using fileM = mockFile();
    fileM.enqueueResult({ metadata: { fileSize: 4, sha256sum: "abc" } });

    const result = await file.upload("ns", "Doc", "blob", "rec-1", new Uint8Array([1, 2, 3, 4]));

    expect(result).toEqual({ metadata: { fileSize: 4, sha256sum: "abc" } });
    expect(fileM.calls).toEqual([
      {
        method: "upload",
        namespace: "ns",
        typeName: "Doc",
        fieldName: "blob",
        recordId: "rec-1",
      },
    ]);
  });

  test("download forwards and returns the queued payload", async () => {
    using fileM = mockFile();
    fileM.enqueueResult({
      data: new Uint8Array([9, 9]),
      metadata: {
        contentType: "application/octet-stream",
        fileSize: 2,
        sha256sum: "h",
        lastUploadedAt: "2026-01-01T00:00:00Z",
      },
    });

    const result = await file.download("ns", "Doc", "blob", "rec-1");

    expect(result.data).toEqual(new Uint8Array([9, 9]));
    expect(fileM.calls[0]?.method).toBe("download");
  });

  test("downloadAsBase64 forwards", async () => {
    using fileM = mockFile();
    fileM.enqueueResult({
      data: "AQID",
      metadata: {
        contentType: "application/octet-stream",
        fileSize: 3,
        sha256sum: "h",
        lastUploadedAt: "2026-01-01T00:00:00Z",
      },
    });

    const result = await file.downloadAsBase64("ns", "Doc", "blob", "rec-1");

    expect(result.data).toBe("AQID");
    expect(fileM.calls[0]?.method).toBe("downloadAsBase64");
  });

  test("getMetadata forwards", async () => {
    using fileM = mockFile();
    fileM.enqueueResult({
      contentType: "image/png",
      fileSize: 100,
      sha256sum: "x",
      urlPath: "/url",
    });

    const meta = await file.getMetadata("ns", "Doc", "blob", "rec-1");

    expect(meta.contentType).toBe("image/png");
    expect(fileM.calls[0]?.method).toBe("getMetadata");
  });

  test("delete forwards (re-exported from deleteFile)", async () => {
    using fileM = mockFile();
    await file.delete("ns", "Doc", "blob", "rec-1");

    expect(fileM.calls).toEqual([
      {
        method: "delete",
        namespace: "ns",
        typeName: "Doc",
        fieldName: "blob",
        recordId: "rec-1",
      },
    ]);
  });

  test("openDownloadStream forwards and yields StreamValue chunks", async () => {
    using fileM = mockFile();
    const sequence: file.StreamValue[] = [
      {
        type: "metadata",
        metadata: { contentType: "application/octet-stream", fileSize: 2, sha256sum: "h" },
      },
      { type: "chunk", data: new Uint8Array([1]), position: 0 },
      { type: "chunk", data: new Uint8Array([2]), position: 1 },
      { type: "complete" },
    ];
    fileM.enqueueResult(sequence);

    const stream = await file.openDownloadStream("ns", "Doc", "blob", "rec-1");

    const chunks: file.StreamValue[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(sequence);
    expect(fileM.calls[0]?.method).toBe("openDownloadStream");
  });

  test("downloadStream forwards and returns body with metadata", async () => {
    using fileM = mockFile();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    fileM.enqueueResult({
      body,
      metadata: {
        contentType: "application/octet-stream",
        fileSize: 3,
        sha256sum: "h",
        lastUploadedAt: "2026-01-01T00:00:00Z",
      },
    });

    const result = await file.downloadStream("ns", "Doc", "blob", "rec-1");

    expect(result.body).toBe(body);
    expect(result.metadata.fileSize).toBe(3);
    expect(fileM.calls[0]?.method).toBe("downloadStream");
  });

  test("uploadStream forwards args and records the call", async () => {
    using fileM = mockFile();
    fileM.enqueueResult({ metadata: { fileSize: 10, sha256sum: "xyz" } });

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const result = await file.uploadStream("ns", "Doc", "blob", "rec-1", stream);

    expect(result).toEqual({ metadata: { fileSize: 10, sha256sum: "xyz" } });
    expect(fileM.calls).toEqual([
      {
        method: "uploadStream",
        namespace: "ns",
        typeName: "Doc",
        fieldName: "blob",
        recordId: "rec-1",
      },
    ]);
  });

  test("TailorDBFileError structurally matches globalThis class", () => {
    const TailorDBFileError = (
      globalThis as unknown as {
        TailorDBFileError: new (
          m: string,
          c?: file.TailorDBFileErrorCode,
        ) => Error & { code?: file.TailorDBFileErrorCode };
      }
    ).TailorDBFileError;
    const err = new TailorDBFileError("operation failed", "OPERATION_FAILED");
    expect(err.name).toBe("TailorDBFileError");
    expect(err.code).toBe("OPERATION_FAILED");
    // Type-level: file.TailorDBFileError is a structural interface that the
    // global class instances satisfy (not a direct alias of the class itself).
    const _typed: file.TailorDBFileError = err as file.TailorDBFileError;
    expect(_typed).toBe(err);
  });
});
