import { describe, test, expectTypeOf, expect } from "vitest";
import { definePlugins } from "#/configure/config/index";
import { PluginConfigSchema } from "#/parser/plugin-config/schema";
import { hasGenerationHooks, getPluginGenerationDependencies } from "./guards";
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

test("rejects a non-function onDeployed hook", () => {
  expect(
    PluginConfigSchema.safeParse({ id: "deploy", description: "deploy", onDeployed: 42 }).success,
  ).toBe(false);
});
test("accepts a deploy-only plugin without importPath", () => {
  const plugin: Plugin = { id: "deploy", description: "deploy", onDeployed: () => {} };
  expect(PluginConfigSchema.parse(definePlugins(plugin)[0]).onDeployed).toBe(plugin.onDeployed);
});
test("deploy-only plugins do not introduce generation dependencies", () => {
  const plugin: Plugin = { id: "deploy", description: "deploy", onDeployed: () => {} };
  expect(hasGenerationHooks(plugin)).toBe(false);
  expect(getPluginGenerationDependencies(plugin)).toEqual(new Set());
});
