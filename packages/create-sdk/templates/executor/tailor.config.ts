import { defineAuth, defineConfig, defineIdp, definePlugins, t } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

const idp = defineIdp("main-idp", {
  clients: ["default-idp-client"],
  permission: {
    create: [{ conditions: [[{ user: "role" }, "=", "admin"]], permit: true }],
    read: [{ conditions: [[{ user: "role" }, "=", "admin"]], permit: true }],
    update: [{ conditions: [[{ user: "role" }, "=", "admin"]], permit: true }],
    delete: [{ conditions: [[{ user: "role" }, "=", "admin"]], permit: true }],
    sendPasswordResetEmail: [{ conditions: [[{ user: "role" }, "=", "admin"]], permit: true }],
  },
  userAuthPolicy: {
    useNonEmailIdentifier: false,
    allowSelfPasswordReset: true,
    passwordRequireUppercase: true,
    passwordRequireLowercase: true,
    passwordRequireNonAlphanumeric: true,
    passwordRequireNumeric: true,
    passwordMinLength: 8,
    passwordMaxLength: 128,
  },
});

export default defineConfig({
  name: "executor",
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
  executor: { files: ["./src/executor/*.ts"] },
  workflow: { files: ["./src/workflow/*.ts"] },
});

export const plugins = definePlugins(kyselyTypePlugin({ distPath: "./src/generated/db.ts" }));
