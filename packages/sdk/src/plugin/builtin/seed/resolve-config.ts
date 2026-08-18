import { createPluginConfigResolver } from "#/plugin/resolve-plugin-config";
import { SeedGeneratorID, type SeedPluginOptions } from "./index";

/** Not re-exported from `index.ts`, so `SeedPluginOptions` stays out of the package's public API. */
export const resolveSeedPluginConfig =
  createPluginConfigResolver<SeedPluginOptions>(SeedGeneratorID);
