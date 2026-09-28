import * as path from "node:path";
import { definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";


const __dirname = ".";
const outDir = path.join(__dirname, "out");

export const plugins = definePlugins(kyselyTypePlugin({ distPath: path.join(outDir, "db.ts") }));
// Referenced only to keep definePlugins used; the codemod picks up its
// presence in a separate SDK import statement.
export const _pluginFactoryRef = definePlugins;
