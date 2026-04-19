import { describe, it, expectTypeOf } from "vitest";
import type {
  TailorDBField as FullTailorDBField,
  TailorAnyDBField as FullTailorAnyDBField,
  TailorDBType as FullTailorDBType,
  TailorAnyDBType as FullTailorAnyDBType,
  TailorDBInstance as FullTailorDBInstance,
} from "@/configure/services/tailordb/schema";
import type {
  TailorField as FullTailorField,
  TailorAnyField as FullTailorAnyField,
} from "@/configure/types/type";
import type {
  TailorDBField as MinimalTailorDBField,
  TailorAnyDBField as MinimalTailorAnyDBField,
  TailorDBType as MinimalTailorDBType,
  TailorAnyDBType as MinimalTailorAnyDBType,
  TailorDBInstance as MinimalTailorDBInstance,
} from "@/types/tailor-db-field";
import type {
  TailorField as MinimalTailorField,
  TailorAnyField as MinimalTailorAnyField,
} from "@/types/tailor-field";

describe("configure/ full types extend types/ minimal structural interfaces", () => {
  it("TailorField (full) extends TailorField (minimal)", () => {
    expectTypeOf<FullTailorField>().toExtend<MinimalTailorField>();
  });

  it("TailorAnyField (full) extends TailorAnyField (minimal)", () => {
    expectTypeOf<FullTailorAnyField>().toExtend<MinimalTailorAnyField>();
  });

  it("TailorDBField (full) extends TailorDBField (minimal)", () => {
    expectTypeOf<FullTailorDBField>().toExtend<MinimalTailorDBField>();
  });

  it("TailorAnyDBField (full) extends TailorAnyDBField (minimal)", () => {
    expectTypeOf<FullTailorAnyDBField>().toExtend<MinimalTailorAnyDBField>();
  });

  it("TailorDBType (full) extends TailorDBType (minimal)", () => {
    expectTypeOf<FullTailorDBType>().toExtend<MinimalTailorDBType>();
  });

  it("TailorAnyDBType (full) extends TailorAnyDBType (minimal)", () => {
    expectTypeOf<FullTailorAnyDBType>().toExtend<MinimalTailorAnyDBType>();
  });

  it("TailorDBInstance (full) extends TailorDBInstance (minimal)", () => {
    expectTypeOf<FullTailorDBInstance>().toExtend<MinimalTailorDBInstance>();
  });
});
