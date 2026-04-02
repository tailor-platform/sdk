import * as path from "pathe";
import { readPackageJSON } from "pkg-types";

const SDK_PACKAGE_NAME = "@tailor-platform/sdk";

/**
 * Detect the installed SDK version from the user's project.
 * Looks for the SDK package in node_modules and reads its version.
 * @param projectRoot - The project root directory to search from
 * @returns The installed SDK version string, or null if not found
 */
export async function detectInstalledVersion(projectRoot: string): Promise<string | null> {
  try {
    const sdkPath = path.join(projectRoot, "node_modules", SDK_PACKAGE_NAME);
    const pkg = await readPackageJSON(sdkPath);
    return pkg.version ?? null;
  } catch {
    return null;
  }
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
