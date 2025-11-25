import { readPackageJSON, type PackageJson } from "pkg-types";

let packageJson: PackageJson | null = null;

// Reads and caches the package.json of the SDK package
export async function readPackageJson() {
  if (packageJson) {
    return packageJson;
  }
  packageJson = await readPackageJSON(import.meta.url);
  return packageJson;
}
