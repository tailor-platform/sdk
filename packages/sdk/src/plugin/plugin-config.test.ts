import { describe, test, expectTypeOf } from "vitest";
import type {
  PluginGeneratedTable,
  PluginExecutorContextBase,
  PluginTableProcessContext,
  TablePluginOutput,
  TailorDBTableForPlugin,
} from "#/configure/index";
import type { Plugin } from "#/plugin/types";
import type { PluginConfig } from "#/types/plugin-config.generated";

describe("PluginConfig generated type alignment", () => {
  test("generated PluginConfig is assignable to Plugin", () => {
    expectTypeOf<PluginConfig>().toExtend<Plugin>();
  });

  test("exports the table-oriented plugin contract", () => {
    expectTypeOf<PluginGeneratedTable>().toExtend<TailorDBTableForPlugin>();
    expectTypeOf<PluginTableProcessContext>().toHaveProperty("table");
    expectTypeOf<TablePluginOutput>().toHaveProperty("tables");
    expectTypeOf<PluginExecutorContextBase>().toHaveProperty("sourceTable");
    expectTypeOf<"onTableLoaded">().toExtend<keyof Plugin>();
    expectTypeOf<`on${"Type"}Loaded`>().not.toExtend<keyof Plugin>();
  });
});
