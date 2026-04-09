import { defineAuth, defineConfig, defineIdp, definePlugins, t } from "@tailor-platform/sdk";
import { enumConstantsPlugin } from "@tailor-platform/sdk/plugin/enum-constants";
import { fileUtilsPlugin } from "@tailor-platform/sdk/plugin/file-utils";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { seedPlugin } from "@tailor-platform/sdk/plugin/seed";

const idp = defineIdp("main-idp", {
  authorization: "loggedIn",
  clients: ["default-idp-client"],
});

export default defineConfig({
  name: "generators",
  auth: defineAuth("main-auth", {
    machineUserAttributes: {
      role: t.string(),
    },
    machineUsers: {
      admin: {
        attributes: {
          role: "admin",
        },
      },
    },
  }),
  idp: [idp],
  db: { "main-db": { files: ["./src/db/*.ts"] } },
  resolver: { "main-resolver": { files: ["./src/resolver/*.ts"] } },
});

export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: "./src/generated/db.ts" }),
  enumConstantsPlugin({ distPath: "./src/generated/enums.ts" }),
  fileUtilsPlugin({ distPath: "./src/generated/files.ts" }),
  seedPlugin({ distPath: "./src/seed", machineUserName: "admin" }),
);
