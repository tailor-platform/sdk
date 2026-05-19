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
  {
    id: "v2/apply-to-deploy",
    name: "tailor-sdk apply → tailor-sdk deploy",
    description:
      "Rewrite `tailor-sdk apply` invocations in package.json scripts, shell scripts, CI configs, and docs to the v2-recommended `tailor-sdk deploy` alias",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/apply-to-deploy/scripts/transform.js",
    filePatterns: ["**/package.json", "**/*.{sh,bash,zsh,yml,yaml}", "**/*.md"],
  },
  {
    id: "v2/cli-rename",
    name: "v2 CLI rename (single-word commands)",
    description:
      "Rewrite `tailor-sdk crash-report` invocations to the v2 single-word `tailor-sdk crashreport` form across package.json scripts, shell scripts, CI configs, and docs",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/cli-rename/scripts/transform.js",
    filePatterns: ["**/package.json", "**/*.{sh,bash,zsh,yml,yaml}", "**/*.md"],
  },
  {
    id: "v2/auth-invoker-unwrap",
    name: 'auth.invoker("name") → "name"',
    description:
      'Replace `auth.invoker("name")` calls with the bare `"name"` string and drop the `auth` import when no other reference remains. The `auth.invoker()` helper is deprecated in v2 because importing `auth` from `tailor.config.ts` into runtime files pulls Node-only modules into the bundle.',
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/auth-invoker-unwrap/scripts/transform.js",
    legacyPatterns: ["auth.invoker"],
  },
  {
    id: "v2/tailordb-namespace",
    name: "Tailordb → tailordb (lowercase ambient namespace)",
    description:
      "Rewrite references to the deprecated capital-cased `Tailordb` ambient namespace (`Tailordb.QueryResult`, `Tailordb.CommandType`, `Tailordb.Client`, `typeof Tailordb.Client`) to the new lowercase `tailordb.*` namespace re-published by the SDK in place of `@tailor-platform/function-types`.",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/tailordb-namespace/scripts/transform.js",
    legacyPatterns: ["Tailordb."],
  },
  {
    id: "v2/drop-function-types-dep",
    name: "Drop @tailor-platform/function-types dependency",
    description:
      "Remove `@tailor-platform/function-types` from package.json (`dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies`) and from `tsconfig.json` `compilerOptions.types`. Its declarations are now vendored inside `@tailor-platform/sdk` and activated automatically.",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/drop-function-types-dep/scripts/transform.js",
    filePatterns: ["**/package.json", "**/tsconfig*.json"],
    legacyPatterns: ["@tailor-platform/function-types"],
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
