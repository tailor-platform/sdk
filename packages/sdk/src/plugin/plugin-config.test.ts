import { describe, test, expectTypeOf } from "vitest";
import type { Plugin } from "#src/plugin/types";
import type { PluginConfig } from "#src/types/plugin-config.generated";

describe("PluginConfig generated type alignment", () => {
  test("generated PluginConfig is assignable to Plugin", () => {
    expectTypeOf<PluginConfig>().toExtend<Plugin>();
  });
});
