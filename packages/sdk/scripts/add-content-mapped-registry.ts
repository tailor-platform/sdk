import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { REGISTRY_FILE_NAME } from "../src/cli/shared/tailor-file-extension";

const REGISTRY_IMPORT = `// @ts-ignore\nimport "./${REGISTRY_FILE_NAME}";\n`;
const REGISTRY_NOTE = [
  "// TypeScript does not read this file. The content mapper in @tailor-platform/sdk derives",
  "// the declarations tailor.d.ts used to hold (Env, Attributes, MachineUserName, ...) from",
  "// tailor.config.ts, so they stay current without running `tailor generate`.",
  '// Enable it in tsconfig.json: "contentMappers": [{ "package": "@tailor-platform/sdk", "extensions": [".tailor"] }]',
  "",
].join("\n");

/**
 * Ship the `.tailor` file the content mapper types, and make the entry types import it.
 * @param distDir - Build output directory of the package
 */
export function addContentMappedRegistry(distDir: string): void {
  const configureDir = join(distDir, "configure");
  const entryTypes = join(configureDir, "index.d.mts");
  const source = readFileSync(entryTypes, "utf8");

  writeFileSync(join(configureDir, REGISTRY_FILE_NAME), REGISTRY_NOTE);
  if (!source.startsWith(REGISTRY_IMPORT)) {
    writeFileSync(entryTypes, REGISTRY_IMPORT + source);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  addContentMappedRegistry(join(import.meta.dirname, "..", "dist"));
}
