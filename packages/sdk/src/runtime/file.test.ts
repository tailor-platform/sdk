/**
 * Tests for `@tailor-platform/sdk/runtime/file` typed wrappers.
 */
import { spawnSync } from "node:child_process";
import { aroundEach, describe, expect, test } from "vitest";
import { file, type TailorDBFileError, type TailorDBFileErrorCode } from "#/runtime/file";
import { mockFile, injectMocks } from "#/vitest/mock";

const args = ["ns", "Doc", "blob", "rec-1"] as const;
const expectedCall = (method: string) => ({
  method,
  namespace: "ns",
  tableName: "Doc",
  fieldName: "blob",
  recordId: "rec-1",
});

describe("@tailor-platform/sdk/runtime/file", () => {
  aroundEach(async (runTest) => {
    using _mocks = injectMocks(globalThis);
    await runTest();
  });

  test("upload forwards args and records the call", async () => {
    using fileM = mockFile();
    fileM.enqueueResult({ metadata: { fileSize: 4, sha256sum: "abc" } });

    const result = await file.upload(...args, new Uint8Array([1, 2, 3, 4]));

    expect(result).toEqual({ metadata: { fileSize: 4, sha256sum: "abc" } });
    expect(fileM.calls).toEqual([expectedCall("upload")]);
  });

  test.each([
    {
      encoding: "utf8" as const,
      data: "日本語😀",
      expected: [230, 151, 165, 230, 156, 172, 232, 170, 158, 240, 159, 152, 128],
    },
    {
      encoding: "base64" as const,
      data: "iVBORw0KGgo=",
      expected: [137, 80, 78, 71, 13, 10, 26, 10],
    },
    { encoding: "base64" as const, data: "AP/+", expected: [0, 255, 254] },
    { encoding: "base64" as const, data: "YQ", expected: [97] },
    { encoding: "base64" as const, data: " Y Q==\n", expected: [97] },
    { encoding: "base64" as const, data: "", expected: [] },
  ])("upload interprets $encoding data $data", async ({ encoding, data, expected }) => {
    using fileM = mockFile();
    const options = { encoding, contentType: "image/png" };
    fileM.enqueueResult({ metadata: { fileSize: expected.length, sha256sum: "hash" } });

    const result = await file.upload(...args, data, options);

    expect(fileM.upload).toHaveBeenCalledWith(...args, new Uint8Array(expected), {
      contentType: "image/png",
    });
    expect(result.metadata.fileSize).toBe(expected.length);
    expect(options.encoding).toBe(encoding);
  });

  test.each(["!YQ==", "A", "YQ=", "Y===", "YQ===", "Y=Q=", "____", "data:image/png;base64,YQ=="])(
    "upload rejects invalid Base64 %s before storing anything",
    async (data) => {
      using fileM = mockFile();
      await expect(file.upload(...args, data, { encoding: "base64" })).rejects.toThrow(TypeError);
      expect(fileM.upload).not.toHaveBeenCalled();
    },
  );

  test("upload rejects unsupported string encodings", async () => {
    using fileM = mockFile();
    // @ts-expect-error Unsupported encodings must also fail at runtime.
    await expect(file.upload(...args, "text", { encoding: "hex" })).rejects.toThrow(
      "Unsupported file upload encoding",
    );
    expect(fileM.upload).not.toHaveBeenCalled();
  });

  test.each([undefined, { contentType: "image/png" }])(
    "upload preserves legacy string behavior with options %j",
    async (options) => {
      using fileM = mockFile();
      // oxlint-disable-next-line typescript/no-deprecated -- Verify backward compatibility.
      await file.upload(...args, "iVBORw0KGgo=", options);
      expect(fileM.upload).toHaveBeenCalledWith(...args, "iVBORw0KGgo=", options);
    },
  );

  test.each([new Uint8Array([1, 2, 3]).subarray(1), new ArrayBuffer(2), [1, 2]])(
    "upload leaves byte input unchanged",
    async (data) => {
      using fileM = mockFile();
      await file.upload(...args, data, { encoding: "base64" });
      expect(fileM.upload.mock.calls[0]?.[4]).toBe(data);
      expect(fileM.upload.mock.calls[0]?.[5]).toEqual({});
    },
  );

  test("upload decodes a 3 MB file within a 32 MB V8 heap", () => {
    const script = `
      import { file } from ${JSON.stringify(new URL("./file.ts", import.meta.url).href)};
      globalThis.tailordb = {
        file: {
          upload: async (...args) => ({ metadata: { fileSize: args[4].byteLength, sha256sum: "" } }),
        },
      };
      const result = await file.upload("ns", "Doc", "blob", "id", "AQID".repeat(1_000_000), { encoding: "base64" });
      console.log(result.metadata.fileSize);
    `;
    const result = spawnSync(
      process.execPath,
      ["--max-old-space-size=32", "--input-type=module", "--eval", script],
      {
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect({ status: result.status, output: result.stdout }).toEqual({
      status: 0,
      output: "3000000\n",
    });
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

    const result = await file.download(...args);

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

    const result = await file.downloadAsBase64(...args);

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

    const meta = await file.getMetadata(...args);

    expect(meta.contentType).toBe("image/png");
    expect(fileM.calls[0]?.method).toBe("getMetadata");
  });

  test("delete forwards", async () => {
    using fileM = mockFile();
    await file.delete(...args);

    expect(fileM.calls).toEqual([expectedCall("delete")]);
  });

  test("does not export the removed openDownloadStream wrapper", () => {
    expect("openDownloadStream" in file).toBe(false);
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

    const result = await file.downloadStream(...args);

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
    const result = await file.uploadStream(...args, stream);

    expect(result).toEqual({ metadata: { fileSize: 10, sha256sum: "xyz" } });
    expect(fileM.calls).toEqual([expectedCall("uploadStream")]);
  });

  test("TailorDBFileError structurally matches globalThis class", () => {
    const TailorDBFileError = (
      globalThis as unknown as {
        TailorDBFileError: new (
          m: string,
          c?: TailorDBFileErrorCode,
        ) => Error & { code?: TailorDBFileErrorCode };
      }
    ).TailorDBFileError;
    const err = new TailorDBFileError("operation failed", "OPERATION_FAILED");
    expect(err.name).toBe("TailorDBFileError");
    expect(err.code).toBe("OPERATION_FAILED");
    // Type-level: file.TailorDBFileError is a structural interface that the
    // global class instances satisfy (not a direct alias of the class itself).
    const _typed: TailorDBFileError = err as TailorDBFileError;
    expect(_typed).toBe(err);
  });
});
