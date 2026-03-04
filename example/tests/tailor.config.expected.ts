import { definePlugins } from "@tailor-platform/sdk";
import { enumConstantsPlugin } from "@tailor-platform/sdk/plugin/enum-constants";
import { fileUtilsPlugin } from "@tailor-platform/sdk/plugin/file-utils";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { seedPlugin } from "@tailor-platform/sdk/plugin/seed";
import config, { auth } from "../tailor.config";
export default config;
export { auth };
export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: "./tests/fixtures/expected/db.ts" }),
  enumConstantsPlugin({ distPath: "./tests/fixtures/expected/enums.ts" }),
  fileUtilsPlugin({ distPath: "./tests/fixtures/expected/files.ts" }),
  seedPlugin({
    distPath: "./tests/fixtures/expected/seed",
    machineUserName: "manager-machine-user",
  }),
);
