/**
 * Tests for `@tailor-platform/sdk/runtime/file` typed wrappers.
 */
import "@/runtime/globals";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import * as file from "@/runtime/file";
import { cleanupMocks, fileMock, injectMocks } from "@/vitest/mock";

describe("@tailor-platform/sdk/runtime/file", () => {
  beforeEach(() => {
    injectMocks(globalThis);
    fileMock.reset();
  });

  afterEach(() => {
    cleanupMocks(globalThis);
  });

  test("upload forwards args and records the call", async () => {
    fileMock.enqueueResult({ metadata: { fileSize: 4, sha256sum: "abc" } });

    const result = await file.upload("ns", "Doc", "blob", "rec-1", new Uint8Array([1, 2, 3, 4]));

    expect(result).toEqual({ metadata: { fileSize: 4, sha256sum: "abc" } });
    expect(fileMock.calls).toEqual([
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
    fileMock.enqueueResult({
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
    expect(fileMock.calls[0]?.method).toBe("download");
  });

  test("downloadAsBase64 forwards", async () => {
    fileMock.enqueueResult({
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
    expect(fileMock.calls[0]?.method).toBe("downloadAsBase64");
  });

  test("getMetadata forwards", async () => {
    fileMock.enqueueResult({
      contentType: "image/png",
      fileSize: 100,
      sha256sum: "x",
      urlPath: "/url",
    });

    const meta = await file.getMetadata("ns", "Doc", "blob", "rec-1");

    expect(meta.contentType).toBe("image/png");
    expect(fileMock.calls[0]?.method).toBe("getMetadata");
  });

  test("delete forwards (re-exported from deleteFile)", async () => {
    await file.delete("ns", "Doc", "blob", "rec-1");

    expect(fileMock.calls).toEqual([
      {
        method: "delete",
        namespace: "ns",
        typeName: "Doc",
        fieldName: "blob",
        recordId: "rec-1",
      },
    ]);
  });

  test("openDownloadStream forwards and yields chunks", async () => {
    fileMock.enqueueResult([new Uint8Array([1]), new Uint8Array([2])]);

    const stream = await file.openDownloadStream("ns", "Doc", "blob", "rec-1");

    const chunks: unknown[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([new Uint8Array([1]), new Uint8Array([2])]);
    expect(fileMock.calls[0]?.method).toBe("openDownloadStream");
  });

  test("TailorDBFileError type alias resolves to globalThis class", () => {
    const TailorDBFileError = (
      globalThis as unknown as {
        TailorDBFileError: new (m: string, c?: string) => Error & { code?: string };
      }
    ).TailorDBFileError;
    const err = new TailorDBFileError("not found", "NOT_FOUND");
    expect(err.name).toBe("TailorDBFileError");
    expect(err.code).toBe("NOT_FOUND");
    // Type-level: file.TailorDBFileError is the global class
    const _typed: file.TailorDBFileError = err as file.TailorDBFileError;
    expect(_typed).toBe(err);
  });
});
