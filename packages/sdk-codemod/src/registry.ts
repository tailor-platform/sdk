import * as url from "node:url";
import * as path from "pathe";
import { lt, gte, valid } from "semver";
import type { CodemodPackage } from "./types";

const CODEMODS_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "codemods");

const allCodemods: CodemodPackage[] = [
  {
    id: "v2/define-generators-to-plugins",
    name: "defineGenerators → definePlugins",
    description:
      "Migrate defineGenerators() tuple syntax to definePlugins() with explicit plugin imports",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/define-generators-to-plugins/scripts/transform.js",
    legacyPatterns: ["defineGenerators"],
  },
  {
    id: "v2/test-run-arg-input",
    name: "function test-run --arg input unwrap",
    description:
      "Strip the deprecated {input: ...} wrapper from `tailor-sdk function test-run --arg` JSON in scripts and docs",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/test-run-arg-input/scripts/transform.js",
    filePatterns: ["**/package.json", "**/*.{sh,bash,zsh}", "**/*.md"],
  },
  {
    id: "v2/sdk-skills-shim",
    name: "tailor-sdk-skills → tailor-sdk skills install",
    description:
      "Replace deprecated `tailor-sdk-skills` invocations with `tailor-sdk skills install`",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/sdk-skills-shim/scripts/transform.js",
    filePatterns: ["**/package.json", "**/*.{sh,bash,zsh,yml,yaml}", "**/*.md"],
    legacyPatterns: ["tailor-sdk-skills"],
  },
  {
    id: "v2/principal-unify",
    name: "Unify TailorUser/TailorActor/TailorInvoker → TailorPrincipal",
    description:
      "Rename TailorUser/TailorActor/TailorInvoker to TailorPrincipal, drop unauthenticatedTailorUser, and rename resolver body `user` to `caller`",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/principal-unify/scripts/transform.js",
    legacyPatterns: ["TailorUser", "TailorActor", "TailorInvoker", "unauthenticatedTailorUser"],
  },
];

/**
 * Resolve the absolute path to a codemod script.
 * @param scriptPath - Relative path from the codemods root
 * @returns Absolute path to the script file
 */
export function resolveCodemodScript(scriptPath: string): string {
  return path.resolve(CODEMODS_ROOT, scriptPath);
}

/**
 * Get codemod packages applicable for a version range.
 * A codemod applies when: since <= fromVersion < until <= toVersion
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
    (codemod) =>
      gte(fromVersion, codemod.since) &&
      lt(fromVersion, codemod.until) &&
      gte(toVersion, codemod.until),
  );
}
