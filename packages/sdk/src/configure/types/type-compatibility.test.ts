import { describe, test, expectTypeOf } from "vitest";
import type { AppConfig as FullAppConfig } from "#src/configure/config/types";
import type {
  TailorDBField as FullTailorDBField,
  TailorAnyDBField as FullTailorAnyDBField,
  TailorDBType as FullTailorDBType,
  TailorAnyDBType as FullTailorAnyDBType,
  TailorDBInstance as FullTailorDBInstance,
} from "#src/configure/services/tailordb/schema";
import type {
  TailorDBField as MinimalTailorDBField,
  TailorAnyDBField as MinimalTailorAnyDBField,
  TailorDBType as MinimalTailorDBType,
  TailorAnyDBType as MinimalTailorAnyDBType,
  TailorDBInstance as MinimalTailorDBInstance,
} from "#src/configure/services/tailordb/types";
import type {
  TailorField as MinimalTailorField,
  TailorAnyField as MinimalTailorAnyField,
} from "#src/configure/types/field.types";
import type {
  TailorField as FullTailorField,
  TailorAnyField as FullTailorAnyField,
} from "#src/configure/types/type";
import type { AppConfigParsed as MinimalAppConfig } from "#src/types/app-config.generated";

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
