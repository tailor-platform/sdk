import { defineGenerators } from "@tailor-platform/sdk";
import config, { auth } from "../tailor.config";
export default config;
export { auth };
export const generators = defineGenerators(
  ["@tailor-platform/kysely-type", { distPath: "./tests/fixtures/generators/db.ts" }],
  ["@tailor-platform/enum-constants", { distPath: "./tests/fixtures/generators/enums.ts" }],
  ["@tailor-platform/file-utils", { distPath: "./tests/fixtures/generators/files.ts" }],
  [
    "@tailor-platform/seed",
    { distPath: "./tests/fixtures/generators/seed", machineUserName: "manager-machine-user" },
  ],
);
