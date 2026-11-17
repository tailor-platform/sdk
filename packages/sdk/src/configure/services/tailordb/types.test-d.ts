import { describe, test, expectTypeOf } from "vitest";
import { db } from "./index";
import type { TailorDBServiceConfigInput } from "#/types/tailordb.generated";
import type { IsAutoFilledDBField, IsReadOnlyDBField, TailorDBServiceInput } from "./types";

const plain = db.string();
const defaulted = db.string().default("DRAFT");
const createHooked = db.string().hooks({ create: ({ input }) => input ?? "MANUAL" });
const updateHooked = db.string().hooks({ update: ({ input }) => input ?? "system" });
const serial = db.string().serial({ start: 1, format: "PO-%d" });

describe("IsReadOnlyDBField", () => {
  test("is true only for .serial() fields", () => {
    expectTypeOf<IsReadOnlyDBField<typeof serial>>().toEqualTypeOf<true>();
    expectTypeOf<IsReadOnlyDBField<typeof defaulted>>().toEqualTypeOf<false>();
    expectTypeOf<IsReadOnlyDBField<typeof createHooked>>().toEqualTypeOf<false>();
    expectTypeOf<IsReadOnlyDBField<typeof plain>>().toEqualTypeOf<false>();
  });
});

describe("IsAutoFilledDBField", () => {
  test("is true for .default() and .hooks({ create }) fields", () => {
    expectTypeOf<IsAutoFilledDBField<typeof defaulted>>().toEqualTypeOf<true>();
    expectTypeOf<IsAutoFilledDBField<typeof createHooked>>().toEqualTypeOf<true>();
  });

  test("is false for update-only hooks, serial and plain fields", () => {
    expectTypeOf<IsAutoFilledDBField<typeof updateHooked>>().toEqualTypeOf<false>();
    expectTypeOf<IsAutoFilledDBField<typeof serial>>().toEqualTypeOf<false>();
    expectTypeOf<IsAutoFilledDBField<typeof plain>>().toEqualTypeOf<false>();
  });
});

describe("TailorDBServiceInput", () => {
  test("a namespace config accepts the same keys and values as the schema", () => {
    type NamespaceConfig = Exclude<TailorDBServiceInput[string], { external: true }>;
    expectTypeOf<keyof NamespaceConfig>().toEqualTypeOf<keyof TailorDBServiceConfigInput>();
    expectTypeOf<NamespaceConfig["ignores"]>().toEqualTypeOf<
      TailorDBServiceConfigInput["ignores"]
    >();
  });
});
