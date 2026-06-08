import { describe, test, expectTypeOf } from "vitest";
import type { Plugin } from "@/types/plugin";
import type { PluginConfig } from "@/types/plugin-config.generated";

describe("PluginConfig generated type alignment", () => {
  test("generated PluginConfig is assignable to Plugin", () => {
    expectTypeOf<PluginConfig>().toExtend<Plugin>();
  });
});
