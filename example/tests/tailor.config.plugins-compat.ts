import { definePlugins } from "@tailor-platform/sdk";
import { enumConstantsPlugin } from "@tailor-platform/sdk/plugin/enum-constants";
import { fileUtilsPlugin } from "@tailor-platform/sdk/plugin/file-utils";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { seedPlugin } from "@tailor-platform/sdk/plugin/seed";
import config, { auth } from "./example-config";
export default config;
export { auth };
export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: "./fixtures/plugins/db.ts" }),
  enumConstantsPlugin({ distPath: "./fixtures/plugins/enums.ts" }),
  fileUtilsPlugin({ distPath: "./fixtures/plugins/files.ts" }),
  seedPlugin({
    distPath: "./fixtures/plugins/seed",
    machineUserName: "manager-machine-user",
  }),
);
