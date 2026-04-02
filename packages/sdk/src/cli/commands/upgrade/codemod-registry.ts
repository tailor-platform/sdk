import { createRequire } from "node:module";
import * as path from "pathe";
import { lt, gte, valid } from "semver";
import type { CodemodPackage } from "./types";

/**
 * Resolve the SDK package root directory.
 * Uses createRequire to locate the SDK's package.json, which works in both
 * source (development) and bundled (production) environments.
 * Requires "./package.json" to be listed in the SDK's package.json exports.
 * @returns Absolute path to the SDK package root
 */
function getSdkPackageRoot(): string {
  const require = createRequire(import.meta.url);
  const pkgJsonPath = require.resolve("@tailor-platform/sdk/package.json");
  return path.dirname(pkgJsonPath);
}

/**
 * Registry of all available codemod packages.
 * Each entry maps to a codemod package under packages/sdk/codemods/.
 */
const allCodemods: CodemodPackage[] = [
  {
    id: "v2/define-generators-to-plugins",
    name: "defineGenerators → definePlugins",
    description:
      "Migrate defineGenerators() tuple syntax to definePlugins() with explicit plugin imports",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/define-generators-to-plugins/scripts/transform.ts",
  },
];

/**
 * Resolve the absolute path to a codemod script.
 * @param scriptPath - Relative path from the codemods root
 * @returns Absolute path to the script file
 */
export function resolveCodemodScript(scriptPath: string): string {
  return path.resolve(getSdkPackageRoot(), "codemods", scriptPath);
}

/**
 * Get codemod packages applicable for a version range.
 * A codemod applies when: fromVersion < codemod.until <= toVersion
 * @param fromVersion - Current SDK version (semver)
 * @param toVersion - Target SDK version (semver)
 * @returns Array of applicable codemod packages in registration order
 */
export function getApplicableCodemods(fromVersion: string, toVersion: string): CodemodPackage[] {
  if (!valid(fromVersion)) {
    throw new Error(`Invalid fromVersion: ${fromVersion}`);
  }
  if (!valid(toVersion)) {
    throw new Error(`Invalid toVersion: ${toVersion}`);
  }

  return allCodemods.filter(
    (codemod) => lt(fromVersion, codemod.until) && gte(toVersion, codemod.until),
  );
}
