import { describe, test, expectTypeOf } from "vitest";
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
import type { AppConfig as FullAppConfig } from "@/types/app-config";
import type { AppConfigParsed as MinimalAppConfig } from "@/types/app-config.generated";
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
  test("TailorField (full) extends TailorField (minimal)", () => {
    expectTypeOf<FullTailorField>().toExtend<MinimalTailorField>();
  });

  test("TailorAnyField (full) extends TailorAnyField (minimal)", () => {
    expectTypeOf<FullTailorAnyField>().toExtend<MinimalTailorAnyField>();
  });

  test("TailorDBField (full) extends TailorDBField (minimal)", () => {
    expectTypeOf<FullTailorDBField>().toExtend<MinimalTailorDBField>();
  });

  test("TailorAnyDBField (full) extends TailorAnyDBField (minimal)", () => {
    expectTypeOf<FullTailorAnyDBField>().toExtend<MinimalTailorAnyDBField>();
  });

  test("TailorDBType (full) extends TailorDBType (minimal)", () => {
    expectTypeOf<FullTailorDBType>().toExtend<MinimalTailorDBType>();
  });

  test("TailorAnyDBType (full) extends TailorAnyDBType (minimal)", () => {
    expectTypeOf<FullTailorAnyDBType>().toExtend<MinimalTailorAnyDBType>();
  });

  test("TailorDBInstance (full) extends TailorDBInstance (minimal)", () => {
    expectTypeOf<FullTailorDBInstance>().toExtend<MinimalTailorDBInstance>();
  });

  test("AppConfig (full) extends AppConfig (minimal)", () => {
    expectTypeOf<FullAppConfig>().toExtend<MinimalAppConfig>();
  });
});
