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
    id: "v2/plugin-cli-import",
    name: "@tailor-platform/sdk/cli plugin imports → dedicated subpaths",
    description:
      "Rewrite deprecated plugin re-export imports (kyselyTypePlugin, enumConstantsPlugin, fileUtilsPlugin, seedPlugin) from `@tailor-platform/sdk/cli` to their dedicated plugin subpaths",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/plugin-cli-import/scripts/transform.js",
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
      "Rewrite `tailor-sdk apply` invocations in package.json scripts, shell scripts, CI configs, and docs to the canonical v2 `tailor-sdk deploy` command",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/apply-to-deploy/scripts/transform.js",
    filePatterns: ["**/package.json", "**/*.{sh,bash,zsh,yml,yaml}", "**/*.md"],
  },
  {
    id: "v2/cli-rename",
    name: "v2 CLI rename",
    description:
      "Rewrite `tailor-sdk crash-report` to `tailor-sdk crashreport` and `--machineuser` to `--machine-user` across package.json scripts, shell scripts, CI configs, and docs",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/cli-rename/scripts/transform.js",
    filePatterns: ["**/package.json", "**/*.{sh,bash,zsh,yml,yaml}", "**/*.md"],
    legacyPatterns: ["tailor-sdk crash-report", "--machineuser"],
  },
  {
    id: "v2/auth-invoker-unwrap",
    name: 'auth.invoker("name") → "name"',
    description:
      'Replace `auth.invoker("name")` calls with the bare `"name"` string and drop the `auth` import when no other reference remains. The `auth.invoker()` helper is deprecated in v2 because importing `auth` from `tailor.config.ts` into runtime files pulls Node-only modules into the bundle.',
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/auth-invoker-unwrap/scripts/transform.js",
    suspiciousPatterns: ["auth.invoker"],
    prompt: [
      "In Tailor SDK v2 the auth.invoker() helper is removed; an invoker is now the",
      "machine user name passed directly as a string. The codemod already rewrote the",
      'string-literal form auth.invoker("name") to "name". These files still contain',
      "auth.invoker(...) because the argument is not a plain string literal (a variable,",
      "template literal, function call, or property access).",
      "",
      "For each remaining auth.invoker(<expr>) call:",
      "1. Replace the whole call with <expr> as-is (e.g. auth.invoker(name) becomes name).",
      "2. Make sure <expr> evaluates to the machine user name (a string); adjust it if it",
      "   resolves to an object or an auth config value instead.",
      "3. After removing every auth.invoker usage in a file, delete the now-unused auth",
      "   import (keeping it pulls Node-only config modules into runtime bundles); leave",
      "   the import if auth is still referenced elsewhere.",
      "",
      "Do not change behavior beyond removing the auth.invoker() indirection.",
    ].join("\n"),
  },
  {
    id: "v2/tailordb-namespace",
    name: "Tailordb → tailordb (lowercase ambient namespace)",
    description:
      "Rewrite references to the removed capital-cased `Tailordb` ambient namespace (`Tailordb.QueryResult`, `Tailordb.CommandType`, `Tailordb.Client`, `typeof Tailordb.Client`) to the lowercase `tailordb.*` namespace exposed by `@tailor-platform/sdk/runtime/globals`.",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/tailordb-namespace/scripts/transform.js",
    legacyPatterns: ["Tailordb."],
  },
  {
    id: "v2/execute-script-arg",
    name: "executeScript arg JSON.stringify → value",
    description:
      "Unwrap `JSON.stringify(...)` passed as the `executeScript` `arg` option. In v2 `arg` takes a JSON-serializable value and is serialized internally, so a pre-stringified argument double-encodes.",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/execute-script-arg/scripts/transform.js",
    filePatterns: ["**/*.{ts,tsx,mts,cts,mjs,cjs,js}"],
    legacyPatterns: [["executeScript", "JSON.stringify"]],
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
