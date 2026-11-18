import * as fs from "node:fs";
import * as path from "pathe";

/**
 * Lists the `.ts` files under a directory except `*.test.ts` files and `.`- or `__test_`-prefixed
 * entries, which hold test fixtures.
 * @param dir - Directory to walk
 * @returns Absolute paths of the listed files
 */
export function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.name.startsWith("__test_")) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}
