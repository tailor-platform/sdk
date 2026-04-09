import * as path from "pathe";
import { readPackageJSON } from "pkg-types";

const SDK_PACKAGE_NAME = "@tailor-platform/sdk";

/**
 * Detect the installed SDK version from the user's project.
 * Walks up from projectRoot to find the SDK package in node_modules,
 * matching Node's module resolution for workspace setups with hoisted deps.
 * @param projectRoot - The project root directory to search from
 * @returns The installed SDK version string, or null if not found
 */
export async function detectInstalledVersion(projectRoot: string): Promise<string | null> {
  let dir = path.resolve(projectRoot);
  while (true) {
    try {
      const sdkPath = path.join(dir, "node_modules", SDK_PACKAGE_NAME);
      const pkg = await readPackageJSON(sdkPath);
      if (pkg.version) return pkg.version;
    } catch {
      // Not found at this level, try parent
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Read the SDK version range from the project's package.json dependencies.
 * Used as the default target version when --to is not specified.
 * @param projectRoot - The project root directory
 * @returns The version range string from dependencies, or null if not found
 */
export async function detectDeclaredVersion(projectRoot: string): Promise<string | null> {
  try {
    const pkg = await readPackageJSON(projectRoot);
    return pkg.dependencies?.[SDK_PACKAGE_NAME] ?? pkg.devDependencies?.[SDK_PACKAGE_NAME] ?? null;
  } catch {
    return null;
  }
}
