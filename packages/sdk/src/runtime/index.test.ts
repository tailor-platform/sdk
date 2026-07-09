/**
 * Tests for the aggregate `@tailor-platform/sdk/runtime` entry point.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, test } from "vitest";
import { file, type iconv, type idp } from "#/runtime/index";
import { cleanupMocks, injectMocks, mockFile } from "#/vitest/mock";
import type { TailorDBFileErrorCode } from "#/runtime/file";
import type { IconvInstance } from "#/runtime/iconv";
import type { ClientConfig } from "#/runtime/idp";

const fileArgs = ["ns", "Doc", "blob", "rec-1"] as const;

describe("@tailor-platform/sdk/runtime aggregate exports", () => {
  beforeEach(() => {
    injectMocks(globalThis);
  });

  afterEach(() => {
    cleanupMocks(globalThis);
  });

  test("preserves namespace type access for aggregate imports", () => {
    expectTypeOf<iconv.IconvInstance>().toEqualTypeOf<IconvInstance>();
    expectTypeOf<idp.ClientConfig>().toEqualTypeOf<ClientConfig>();
    expectTypeOf<file.TailorDBFileErrorCode>().toEqualTypeOf<TailorDBFileErrorCode>();
  });

  test("keeps the file.deleteFile alias on the aggregate file namespace", async () => {
    using fileM = mockFile();

    await file.deleteFile(...fileArgs);

    expect(file.deleteFile).toBe(file.delete);
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
});
