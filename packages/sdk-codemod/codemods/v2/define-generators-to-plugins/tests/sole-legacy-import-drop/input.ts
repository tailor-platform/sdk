import * as path from "node:path";
import { definePlugins } from "@tailor-platform/sdk";
import { defineGenerators } from "@tailor-platform/sdk";

const __dirname = ".";
const outDir = path.join(__dirname, "out");

export const generators = defineGenerators([
  "@tailor-platform/kysely-type",
  { distPath: path.join(outDir, "db.ts") },
]);
// Referenced only to keep definePlugins used; the codemod picks up its
// presence in a separate SDK import statement.
export const _pluginFactoryRef = definePlugins;
