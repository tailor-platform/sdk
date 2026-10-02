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
import type {
  DeployedContext,
  DeployedStaticWebsite,
  Plugin,
  PublishableStaticWebsite,
} from "#/plugin/types";
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

test("accepts only JSON values as deploy hook outputs", () => {
  const plugin: Plugin = {
    id: "@example/outputs",
    description: "Returns outputs",
    // @ts-expect-error bigint is not a JSON value
    onDeployed: () => ({ outputs: { size: 1n } }),
  };
  expect(plugin.onDeployed).toBeTypeOf("function");
});

test("models static websites the config does not declare as possibly missing", () => {
  expectTypeOf<DeployedContext["application"]["staticWebsites"]["web"]>().toEqualTypeOf<
    PublishableStaticWebsite | undefined
  >();
});

test("gives other applications' static websites no publish method", () => {
  expectTypeOf<DeployedContext["applications"][number]["staticWebsites"]["web"]>().toEqualTypeOf<
    DeployedStaticWebsite | undefined
  >();
  expectTypeOf<DeployedStaticWebsite>().not.toHaveProperty("publish");
});
