import * as url from "node:url";
import * as path from "pathe";
import { lt, gte, valid } from "semver";
import type { CodemodPackage } from "./types";

const CODEMODS_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "codemods");

/** All registered codemods, in registration order. */
export const allCodemods: CodemodPackage[] = [
  {
    id: "v2/define-generators-to-plugins",
    name: "defineGenerators → definePlugins",
    description:
      "Migrate defineGenerators() tuple syntax to definePlugins() with explicit plugin imports",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/define-generators-to-plugins/scripts/transform.js",
    legacyPatterns: ["defineGenerators"],
    examples: [
      {
        before: [
          'import { defineGenerators } from "@tailor-platform/sdk";',
          "",
          "export const generators = defineGenerators(",
          '  ["@tailor-platform/kysely-type", { distPath: "db.ts" }],',
          ");",
        ].join("\n"),
        after: [
          'import { definePlugins } from "@tailor-platform/sdk";',
          'import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";',
          "",
          'export const generators = definePlugins(kyselyTypePlugin({ distPath: "db.ts" }));',
        ].join("\n"),
      },
    ],
    prompt: [
      "defineGenerators() is replaced by definePlugins() in v2. The codemod rewrites the",
      "known plugin tuples (kysely-type, enum-constants, file-utils, seed). For any",
      "remaining defineGenerators([...]) the codemod left in place — a plugin it does not",
      "know, or a non-tuple/spread form — convert it to definePlugins(pluginFn(config)),",
      "importing the matching plugin from its @tailor-platform/sdk/plugin/<name> subpath.",
    ].join("\n"),
  },
  {
    id: "v2/plugin-cli-import",
    name: "@tailor-platform/sdk/cli plugin imports → dedicated subpaths",
    description:
      "Rewrite deprecated plugin re-export imports (kyselyTypePlugin, enumConstantsPlugin, fileUtilsPlugin, seedPlugin) from `@tailor-platform/sdk/cli` to their dedicated plugin subpaths",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/plugin-cli-import/scripts/transform.js",
    examples: [
      {
        before: 'import { kyselyTypePlugin } from "@tailor-platform/sdk/cli";',
        after: 'import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";',
      },
    ],
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
    examples: [
      {
        lang: "sh",
        before: 'tailor-sdk function test-run resolvers/add.ts --arg \'{"input":{"a":1}}\'',
        after: "tailor-sdk function test-run resolvers/add.ts --arg '{\"a\":1}'",
      },
    ],
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
    examples: [
      {
        lang: "sh",
        before: "npx tailor-sdk-skills",
        after: "tailor-sdk skills install",
      },
    ],
    prompt: [
      "The standalone tailor-sdk-skills binary is removed in v2; call the skills install",
      "subcommand on the main tailor-sdk CLI instead. Replace any remaining",
      "tailor-sdk-skills invocations the codemod did not rewrite with",
      "`tailor-sdk skills install`.",
    ].join("\n"),
  },
  {
    id: "v2/principal-unify",
    name: "Unify TailorUser/TailorActor/TailorActorType/TailorInvoker → TailorPrincipal",
    description:
      "Rename TailorUser/TailorActor/TailorActorType/TailorInvoker to TailorPrincipal, drop unauthenticatedTailorUser, rename resolver body `user` to `caller`, and rename TailorDB callback `user` to `invoker`",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/principal-unify/scripts/transform.js",
    legacyPatterns: [
      "TailorUser",
      "TailorActor",
      "TailorActorType",
      "TailorInvoker",
      "unauthenticatedTailorUser",
    ],
    examples: [
      {
        caption: "Type references unify under `TailorPrincipal`:",
        before: 'import type { TailorUser } from "@tailor-platform/sdk";',
        after: 'import type { TailorPrincipal } from "@tailor-platform/sdk";',
      },
      {
        caption: "The resolver body `user` becomes `caller`:",
        before: "body: ({ input, user }) => user.id,",
        after: "body: ({ input, caller }) => caller.id,",
      },
    ],
    prompt: [
      "Finish the cases the codemod left for manual migration:",
      "- Rename user -> caller in resolver bodies the codemod skipped because a `caller`",
      "  binding already exists or renaming would shadow/collide with another value.",
      "- Replace member-access on the removed unauthenticatedTailorUser (e.g.",
      "  unauthenticatedTailorUser.id); the codemod only replaced standalone references",
      "  with null and left member access to surface a type error.",
      "Use TailorPrincipal for the unified user/actor/invoker type.",
    ].join("\n"),
  },
  {
    id: "v2/apply-to-deploy",
    name: "tailor-sdk apply → tailor-sdk deploy",
    description:
      "Rewrite `tailor-sdk apply` invocations in package.json scripts, shell scripts, CI configs, and docs to the canonical v2 `tailor-sdk deploy` command",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/apply-to-deploy/scripts/transform.js",
    filePatterns: [
      "**/package.json",
      "**/*.{sh,bash,zsh,yml,yaml}",
      "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
      "**/*.md",
    ],
    examples: [
      {
        lang: "sh",
        before: "tailor-sdk apply --profile prod",
        after: "tailor-sdk deploy --profile prod",
      },
    ],
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
    examples: [
      {
        lang: "sh",
        before: "tailor-sdk crash-report list\ntailor-sdk login --machineuser",
        after: "tailor-sdk crashreport list\ntailor-sdk login --machine-user",
      },
    ],
    prompt: [
      "Apply the v2 CLI renames the codemod did not reach (only `tailor-sdk`-prefixed",
      "invocations are rewritten): `tailor-sdk crash-report` -> `tailor-sdk crashreport`",
      "and the `--machineuser` option -> `--machine-user`. Leave unrelated commands that",
      "happen to use `--machineuser` alone.",
    ].join("\n"),
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
    examples: [
      {
        before: 'createResolver({ invoker: auth.invoker("manager") });',
        after: 'createResolver({ invoker: "manager" });',
      },
    ],
  },
  {
    id: "v2/tailordb-namespace",
    name: "Tailordb → tailordb (lowercase ambient namespace)",
    description:
      'Rewrite references to the removed capital-cased `Tailordb` ambient namespace (`Tailordb.QueryResult`, `Tailordb.CommandType`, `Tailordb.Client`, `typeof Tailordb.Client`) to the lowercase `tailordb.*` namespace exposed by `@tailor-platform/sdk/runtime/globals`. Because v2 no longer activates ambient declarations automatically, each file that contains `tailordb.*` references after the rewrite must also add `import "@tailor-platform/sdk/runtime/globals"`.',
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/tailordb-namespace/scripts/transform.js",
    legacyPatterns: ["Tailordb."],
    examples: [
      {
        before: 'const command: Tailordb.CommandType = "SELECT";',
        after:
          'import "@tailor-platform/sdk/runtime/globals";\nconst command: tailordb.CommandType = "SELECT";',
      },
    ],
    prompt: [
      "The capital-cased Tailordb ambient namespace is removed in v2; use the lowercase",
      "tailordb.* namespace from @tailor-platform/sdk/runtime/globals. The codemod rewrites",
      "the known members (QueryResult, CommandType, Client). Rewrite any other remaining",
      "Tailordb.* reference to its tailordb.* equivalent (and confirm the member still",
      "exists on the lowercase namespace).",
      'Also add `import "@tailor-platform/sdk/runtime/globals"` at the top of each file',
      "that contains any tailordb.* type reference — v2 no longer activates ambient",
      "declarations automatically on SDK import.",
    ].join("\n"),
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
    suspiciousPatterns: ["executeScript"],
    prompt: [
      "In Tailor SDK v2 the executeScript() arg option takes a JSON-serializable value",
      "and is serialized internally, so a pre-stringified argument double-encodes. The",
      "codemod already rewrote the direct form arg: JSON.stringify(X) to arg: X. Review",
      "the executeScript calls in these files for cases it could not rewrite — where the",
      "arg value is reached indirectly, for example:",
      "- a variable holding a JSON.stringify(...) result (const s = JSON.stringify(x); ... arg: s)",
      "- JSON.stringify(x, null, 2) or another multi-argument form",
      "- an options object built or spread dynamically",
      "",
      "For each such call, pass the underlying value directly as arg (drop the",
      "JSON.stringify wrapper) so executeScript serializes it once. Leave calls that",
      "already pass a plain value unchanged.",
    ].join("\n"),
    examples: [
      {
        before: "await executeScript({ ...opts, arg: JSON.stringify({ a: 1 }) });",
        after: "await executeScript({ ...opts, arg: { a: 1 } });",
      },
    ],
  },
  {
    id: "v2/open-download-stream",
    name: "openDownloadStream → downloadStream",
    description:
      "The deprecated `openDownloadStream` file-streaming API is removed in v2. Use `downloadStream` for streamed file downloads. The generated file utilities now emit `downloadFileStream` (which calls `downloadStream` and returns `FileDownloadStreamResponse`) instead of the removed `openFileDownloadStream` helper.",
    since: "1.0.0",
    until: "2.0.0",
    // No scriptPath: this is a codemod-less ("manual") migration.
    examples: [
      {
        before: "const res = await openDownloadStream(namespace, typeName, fieldName, recordId);",
        after: "const res = await downloadStream(namespace, typeName, fieldName, recordId);",
      },
    ],
    prompt: [
      "The openDownloadStream file-streaming API is removed in v2. Replace every call to",
      "openDownloadStream with downloadStream (same arguments). If you used the generated",
      "openFileDownloadStream helper, switch to downloadFileStream, which calls",
      "downloadStream and returns FileDownloadStreamResponse.",
    ].join("\n"),
  },
  {
    id: "v2/runtime-globals-opt-in",
    name: "Ambient runtime globals are opt-in",
    description:
      'Importing `@tailor-platform/sdk` no longer activates the ambient `tailor.*` / `tailordb.*` global declarations. Normal SDK development does not need them — use the SDK APIs and the typed wrappers from `@tailor-platform/sdk/runtime`. Only if you relied on the ambient globals directly, add `import "@tailor-platform/sdk/runtime/globals"`. (The capital-cased `Tailordb.*` namespace is removed separately — see the `Tailordb → tailordb` codemod.)',
    since: "1.0.0",
    until: "2.0.0",
    notice: true,
  },
  {
    id: "v2/workflow-trigger-dispatch",
    name: "Workflow .trigger() and trigger tests",
    description:
      "Workflow job `.trigger()` now aligns with the platform runtime: it returns the job result directly instead of a Promise wrapper, and tests no longer run job bodies locally. Mock trigger responses with `mockWorkflow()` (`setJobHandler` / `enqueueResult`, assert via `triggeredJobs`), or use `runWorkflowLocally()` for a full-chain local run.",
    since: "1.0.0",
    until: "2.0.0",
    suspiciousPatterns: [".trigger("],
    examples: [
      {
        caption: "Tests must mock the workflow runtime instead of running bodies locally:",
        before:
          'const result = await orderJob.trigger({ id });\nexpect(result.status).toBe("done");',
        after:
          'using wf = mockWorkflow();\nwf.setJobHandler((jobName) => (jobName === "order-job" ? { status: "done" } : null));\nconst result = await orderJob.trigger({ id });\nexpect(result.status).toBe("done");',
      },
    ],
    prompt: [
      "Workflow job .trigger() now uses the platform workflow runtime instead of running",
      "the job body locally. In tests, acquire `using wf = mockWorkflow()` and provide",
      "trigger responses (setJobHandler / enqueueResult), or use runWorkflowLocally() for a",
      "full-chain local run; an unmocked trigger now throws. Outside tests, treat the",
      "trigger result as the job output directly (no Promise wrapper to unwrap).",
    ].join("\n"),
  },
  {
    id: "v2/cli-token-keyring-storage",
    name: "CLI tokens stored in the OS keyring",
    description:
      "CLI login tokens are stored in the OS keyring by default when available, falling back to the platform config file when it is not. No source change is required; re-login if you need tokens moved into the keyring.",
    since: "1.0.0",
    until: "2.0.0",
    notice: true,
  },
  {
    id: "v2/cli-users-by-subject",
    name: "CLI users keyed by subject ID",
    description:
      "The CLI stores human users by their stable subject ID instead of email (email is kept for display). Legacy email-keyed entries are migrated automatically on the next login or token refresh. No source change is required.",
    since: "1.0.0",
    until: "2.0.0",
    notice: true,
  },
  {
    id: "v2/function-logs-content-hash",
    name: "function logs require a content hash for source mapping",
    description:
      "`tailor-sdk function logs` maps stack traces against the function bundle only when the execution recorded a `contentHash`. Executions without one now show raw stack traces instead of mapped frames. No source change is required.",
    since: "1.0.0",
    until: "2.0.0",
    notice: true,
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
