import {
  defineConfig,
  defineGenerators,
  definePlugins,
  defineStaticWebSite,
} from "@tailor-platform/sdk";
import { auth, idp, website } from "./configure/auth";
import { softDeletePlugin } from "./plugins/soft-delete";

const erdSite = defineStaticWebSite("my-erd-site", {
  description: "ERD site for TailorDB",
});

export { auth };

export default defineConfig({
  name: "my-app",
  env: {
    foo: 1,
    bar: "hello",
    baz: true,
  },
  cors: [
    website.url, // This will be replaced with the actual Static Website URL
  ],
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
      erdSite: erdSite.name,
      migration: {
        directory: "./migrations",
      },
    },
    analyticsdb: { files: ["./analyticsdb/*.ts"] },
  },
  resolver: {
    "my-resolver": { files: ["./resolvers/*.ts"] },
  },
  idp: [idp],
  auth,
  executor: { files: ["./executors/*.ts"] },
  workflow: {
    files: ["./workflows/**/*.ts"],
  },
  staticWebsites: [website, erdSite],
});

export const generators = defineGenerators(
  ["@tailor-platform/kysely-type", { distPath: "./generated/tailordb.ts" }],
  ["@tailor-platform/enum-constants", { distPath: "./generated/enums.ts" }],
  ["@tailor-platform/file-utils", { distPath: "./generated/files.ts" }],
  ["@tailor-platform/seed", { distPath: "./seed", machineUserName: "manager-machine-user" }],
);

export const plugins = /*#__PURE__*/ definePlugins(
  // Custom plugin with pluginConfig - global settings for all types using this plugin
  softDeletePlugin({
    archiveTablePrefix: "Deleted_", // Custom prefix for archive tables
    defaultRetentionDays: 90, // Default retention period in days
  }),
);
