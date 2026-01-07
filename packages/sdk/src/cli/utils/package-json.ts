import { readPackageJSON, type PackageJson } from "pkg-types";

let packageJson: PackageJson | null = null;

/**
 * Read and cache the package.json of the SDK package.
 * @returns {Promise<PackageJson>} Parsed package.json contents
 */
export async function readPackageJson() {
  if (packageJson) {
    return packageJson;
  }
  packageJson = await readPackageJSON(import.meta.url);
  return packageJson;
}
