// eslint-disable-next-line no-restricted-imports -- test fixture runs as standalone config, needs node:path
import * as path from "node:path";
import * as url from "node:url";
import { defineGenerators } from "@tailor-platform/sdk";
import config from "./tailor.config";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "generators-compat-out");

export default config;
export const generators = defineGenerators(
  ["@tailor-platform/kysely-type", { distPath: path.join(outDir, "db.ts") }],
  ["@tailor-platform/enum-constants", { distPath: path.join(outDir, "enums.ts") }],
);
