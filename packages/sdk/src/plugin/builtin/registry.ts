import { enumConstantsPlugin, EnumConstantsGeneratorID } from "./enum-constants";
import { fileUtilsPlugin, FileUtilsGeneratorID } from "./file-utils";
import { kyselyTypePlugin, KyselyGeneratorID } from "./kysely-type";
import { seedPlugin, SeedGeneratorID } from "./seed";
import type { Plugin } from "@/types/plugin";

// Map of builtin generator IDs to plugin factory functions
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- builtin plugins accept heterogeneous options
export const builtinPlugins = new Map<string, (options: any) => Plugin<unknown, any>>([
  [KyselyGeneratorID, (options) => kyselyTypePlugin(options)],
  [SeedGeneratorID, (options) => seedPlugin(options)],
  [EnumConstantsGeneratorID, (options) => enumConstantsPlugin(options)],
  [FileUtilsGeneratorID, (options) => fileUtilsPlugin(options)],
]);
