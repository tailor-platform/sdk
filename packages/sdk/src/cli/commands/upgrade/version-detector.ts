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
  // loop exits when a package.json is found or the root is reached
  // oxlint-disable-next-line typescript/no-unnecessary-condition
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
