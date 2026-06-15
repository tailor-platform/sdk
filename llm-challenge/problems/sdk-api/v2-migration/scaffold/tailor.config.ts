import { defineAuth, defineConfig, defineGenerators, definePlugins } from "@tailor-platform/sdk";
import * as sdkCli from "@tailor-platform/sdk/cli";
import { customer } from "./tailordb/customer";

export const auth = defineAuth("main-auth", {
  userProfile: {
    type: customer,
    usernameField: "email",
  },
  machineUsers: {
    "batch-worker": {},
  },
});

export default defineConfig({
  id: "00000000-0000-0000-0000-000000000001",
  name: "v2-migration-workspace",
  env: {
    APP_NAME: "Migration Challenge",
  },
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
  resolver: {
    customer: {
      files: ["./src/customerResolver.ts"],
    },
  },
  workflow: {
    files: ["./src/workflowLauncher.ts"],
  },
  auth,
});

export const generators = defineGenerators(
  ["@tailor-platform/kysely-type", { distPath: "./generated/db.ts" }],
  ["@tailor-platform/enum-constants", { distPath: "./generated/enums.ts" }],
);

export const legacyCliPlugins = definePlugins(
  sdkCli.fileUtilsPlugin({ distPath: "./generated/files.ts" }),
);
