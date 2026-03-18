import { describe, it, expectTypeOf } from "vite-plus/test";
import type { Plugin } from "@/types/plugin";
import type { PluginConfig } from "@/types/plugin-config.generated";

describe("PluginConfig generated type alignment", () => {
  it("generated PluginConfig is assignable to Plugin", () => {
    expectTypeOf<PluginConfig>().toExtend<Plugin>();
  });
});
