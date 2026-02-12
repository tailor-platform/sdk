import * as fs from "node:fs";
import { findUpSync } from "find-up-simple";
import * as path from "pathe";

/**
 * Collect base directories for resolving plugin import paths.
 * @param configPath - Path to tailor.config.ts
 * @returns Ordered list of base directories
 */
export function getPluginImportBaseDirs(configPath?: string): string[] {
  const baseDirs: string[] = [];
  const cwd = process.cwd();

  if (configPath) {
    baseDirs.push(path.dirname(configPath));
  }

  const searchCwd = configPath ? path.dirname(configPath) : cwd;
  const packageJsonPath = findUpSync("package.json", { cwd: searchCwd });
  if (packageJsonPath) {
    baseDirs.push(path.dirname(packageJsonPath));
  }

  if (!baseDirs.includes(cwd)) {
    baseDirs.push(cwd);
  }

  return Array.from(new Set(baseDirs));
}

/**
 * Resolve a relative plugin import path against candidate base directories.
 * @param pluginImportPath - Relative plugin import path
 * @param baseDirs - Candidate base directories
 * @returns Absolute path if found, otherwise null
 */
export function resolveRelativePluginImportPath(
  pluginImportPath: string,
  baseDirs: string[],
): string | null {
  if (!pluginImportPath.startsWith(".")) {
    return null;
  }

  for (const baseDir of baseDirs) {
    const absolutePath = path.resolve(baseDir, pluginImportPath);
    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  return null;
}
