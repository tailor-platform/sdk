import * as path from "node:path";
import * as url from "node:url";
import { definePlugins } from "@tailor-platform/sdk";
import { enumConstantsPlugin } from "@tailor-platform/sdk/plugin/enum-constants";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import config from "./tailor.config";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "generators-compat-out");

export default config;
export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: path.join(outDir, "db.ts") }),
  enumConstantsPlugin({ distPath: path.join(outDir, "enums.ts") }),
);
