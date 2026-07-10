import * as fs from "node:fs";
import * as path from "pathe";

/**
 * Normalize a source module path for trigger binding lookup.
 * @param filePath - Source file path or extensionless import path
 * @returns Canonical absolute path without a JavaScript or TypeScript extension
 */
export function normalizeTriggerModulePath(filePath: string): string {
  const resolvedPath = path.resolve(filePath.replace(/[?#].*$/, ""));
  let canonicalPath = resolvedPath;
  try {
    canonicalPath = fs.realpathSync(resolvedPath);
  } catch {
    try {
      canonicalPath = path.join(
        fs.realpathSync(path.dirname(resolvedPath)),
        path.basename(resolvedPath),
      );
    } catch {
      canonicalPath = resolvedPath;
    }
  }
  return canonicalPath.replace(/\.(ts|mts|cts|js|mjs|cjs)$/, "");
}
