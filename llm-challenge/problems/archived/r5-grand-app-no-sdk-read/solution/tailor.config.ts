import {
  defineAuth,
  defineConfig,
  defineIdp,
  definePlugins,
  defineStaticWebSite,
} from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { member } from "./tailordb/member";
import "./tailordb/organization";

const website = defineStaticWebSite("frontend", {
  description: "Org platform frontend",
});

const idp = defineIdp("my-idp", {
  clients: ["default-client"],
  permission: {
    create: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
    read: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
    update: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
    delete: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
    sendPasswordResetEmail: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
  },
});

const auth = defineAuth("my-auth", {
  userProfile: {
    type: member,
    usernameField: "email",
    attributes: {
      role: true,
    },
  },
  machineUsers: {
    "default-machine-user": {
      attributes: {
        role: "admin",
      },
    },
  },
  idProvider: idp.provider("default-client", "default-client"),
});

export default defineConfig({
  name: "r2-grand-app",
  cors: [website.url],
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
  resolver: {
    "my-resolver": { files: ["./resolvers/*.ts"] },
  },
  executor: { files: ["./executors/*.ts"] },
  workflow: { files: ["./workflows/**/*.ts"] },
  idp: [idp],
  auth,
  staticWebsites: [website],
});

export const plugins = definePlugins(kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }));
