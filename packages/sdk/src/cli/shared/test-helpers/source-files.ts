import * as fs from "node:fs";
import * as path from "pathe";

/**
 * Lists the TypeScript sources under a directory, leaving out tests and the `.`- and
 * `__test_`-prefixed fixture trees that suites create and delete while others walk the sources.
 * @param dir - Directory to walk
 * @returns Absolute paths of the non-test `.ts` files under the directory
 */
export function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.name.startsWith("__test_")) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}
