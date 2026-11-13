import { defineAuth, defineConfig, definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { user } from "./src/db/user";

export default defineConfig({
  name: "content-mapper",
  env: {
    greeting: "Hello",
    pageSize: 20,
  },
  auth: defineAuth("main-auth", {
    userProfile: {
      type: user,
      usernameField: "email",
      attributes: {
        role: true,
      },
    },
    machineUsers: {
      "admin-machine-user": {
        attributes: {
          role: "ADMIN",
        },
      },
    },
  }),
  db: { "main-db": { files: ["./src/db/*.ts"] } },
  resolver: {
    "main-resolver": {
      files: ["./src/resolvers/*.ts"],
      defaultPermission: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
    },
  },
});

export const plugins = definePlugins(kyselyTypePlugin({ contentMapper: true }));
