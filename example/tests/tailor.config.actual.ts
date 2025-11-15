import { defineGenerators } from "@tailor-platform/sdk";
import config from "../tailor.config";

export default config;

export const generators = defineGenerators([
  "@tailor-platform/kysely-type",
  { distPath: "./tests/fixtures/actual/db.ts" },
]);
