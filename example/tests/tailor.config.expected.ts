import { definePlugins } from "@tailor-platform/sdk";
import { enumConstantsPlugin } from "@tailor-platform/sdk/plugin/enum-constants";
import { fileUtilsPlugin } from "@tailor-platform/sdk/plugin/file-utils";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { seedPlugin } from "@tailor-platform/sdk/plugin/seed";
import config, { auth } from "./example-config";
export default config;
export { auth };
export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: "./fixtures/expected/db.ts" }),
  enumConstantsPlugin({ distPath: "./fixtures/expected/enums.ts" }),
  fileUtilsPlugin({ distPath: "./fixtures/expected/files.ts" }),
  seedPlugin({
    distPath: "./fixtures/expected/seed",
    machineUserName: "manager-machine-user",
  }),
);
