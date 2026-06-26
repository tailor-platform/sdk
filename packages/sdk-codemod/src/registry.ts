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
      "Strip the deprecated {input: ...} wrapper from `tailor function test-run --arg` JSON in scripts and docs",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/test-run-arg-input/scripts/transform.js",
    filePatterns: ["**/package.json", "**/*.{sh,bash,zsh}", "**/*.md"],
    examples: [
      {
        lang: "sh",
        before: 'tailor function test-run resolvers/add.ts --arg \'{"input":{"a":1}}\'',
        after: "tailor function test-run resolvers/add.ts --arg '{\"a\":1}'",
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
    suspiciousPatterns: [
      "caller?.",
      "context.user",
      "context.invoker ?? context.user",
      "ResolverContext",
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
      "- Review helper adapters that still accept or read `context.user`; v2 resolver",
      "  context uses nullable `caller` and `invoker`, so project-specific helper",
      "  semantics for anonymous callers and command invokers must be chosen explicitly.",
      "- Review `caller?.` values passed to APIs that require non-null values. If the",
      "  resolver requires authentication, throw or otherwise narrow before the call;",
      "  if anonymous callers are allowed, keep the nullable flow explicit.",
      "Use TailorPrincipal for the unified user/actor/invoker type.",
    ].join("\n"),
  },
  {
    id: "v2/auth-attributes-rename",
    name: "AttributeMap → Attributes",
    description:
      "Rename auth attribute module augmentation and related SDK type names from `AttributeMap` to `Attributes`",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/auth-attributes-rename/scripts/transform.js",
    legacyPatterns: [
      "AttributeMap",
      "interface AttributeMap",
      "UserAttributeMap",
      "InferredAttributeMap",
    ],
    examples: [
      {
        caption: "Module augmentation uses `Attributes`:",
        before:
          'declare module "@tailor-platform/sdk" {\n  interface AttributeMap {\n    role: string;\n  }\n}',
        after:
          'declare module "@tailor-platform/sdk" {\n  interface Attributes {\n    role: string;\n  }\n}',
      },
    ],
    prompt: [
      "In Tailor SDK v2, the auth attribute type API is renamed from `AttributeMap`",
      "to `Attributes`; related SDK types are renamed to `UserAttributes` and",
      "`InferredAttributes`. The codemod rewrites SDK imports, re-exports,",
      "namespace-qualified references, import() type references, and module",
      "augmentations. Review any remaining matches manually and leave unrelated",
      "local names or deploy/proto wire field names unchanged.",
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
      "Rewrite `tailor-sdk crash-report` to `tailor-sdk crashreport` and `--machineuser` to `--machine-user` across package.json scripts, shell scripts, CI configs, source files, and docs",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/cli-rename/scripts/transform.js",
    filePatterns: [
      "**/package.json",
      "**/*.{sh,bash,zsh,yml,yaml}",
      "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
      "**/*.md",
    ],
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
    id: "v2/env-var-rename",
    name: "SDK environment variable rename",
    description:
      "Rewrite unambiguous removed SDK environment variable names to their v2 `TAILOR_*` names and flag generic names for manual review",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/env-var-rename/scripts/transform.js",
    filePatterns: [
      "**/package.json",
      "**/.env",
      "**/.env.*",
      "**/*.{env,sh,bash,zsh,yml,yaml,json,md}",
      "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
    ],
    legacyPatterns: [
      "TAILOR_PLATFORM_SDK_CONFIG_PATH",
      "TAILOR_PLATFORM_SDK_DTS_PATH",
      "TAILOR_PLATFORM_SDK_ALLOW_CI_ID_INJECTION",
      "TAILOR_PLATFORM_SDK_BUILD_ONLY",
      "TAILOR_SDK_OUTPUT_DIR",
      "TAILOR_SDK_SKILLS_SOURCE",
      "TAILOR_SDK_VERSION",
      "PLATFORM_URL",
      "PLATFORM_OAUTH2_CLIENT_ID",
      "TAILOR_ENABLE_INLINE_SOURCEMAP",
      "TAILOR_PLATFORM_QUERY_NEWLINE_ON_ENTER",
      "LOG_LEVEL",
      "TAILOR_TOKEN",
    ],
    sourceStringLegacyPatterns: ["PLATFORM_URL", "PLATFORM_OAUTH2_CLIENT_ID", "LOG_LEVEL"],
    examples: [
      {
        lang: "sh",
        before: "TAILOR_PLATFORM_SDK_BUILD_ONLY=true tailor-sdk deploy",
        after: "TAILOR_DEPLOY_BUILD_ONLY=true tailor-sdk deploy",
      },
      {
        before: "const token = process.env.TAILOR_TOKEN;",
        after: "const token = process.env.TAILOR_PLATFORM_TOKEN;",
      },
    ],
    prompt: [
      "Review any remaining removed SDK environment variable names after the codemod",
      "runs. The codemod intentionally leaves generic names such as `LOG_LEVEL`,",
      "`PLATFORM_URL`, and `PLATFORM_OAUTH2_CLIENT_ID` for manual review because",
      "they can configure non-SDK tools. Replace only actual SDK usages with their",
      "v2 names. If a remaining match is an unrelated local identifier, fixture",
      "label, or historical documentation that intentionally does not configure the",
      "SDK, leave it unchanged.",
    ].join("\n"),
  },
  {
    id: "v2/auth-invoker-unwrap",
    name: 'auth.invoker("name") → invoker: "name"',
    description:
      'Rename statically identified SDK `authInvoker` options to `invoker`, replace `auth.invoker("name")` there with the bare `"name"` string, and drop the `auth` import when no other reference remains. Ambiguous workflow `.trigger()` calls are left for manual review. The `auth.invoker()` helper is removed in v2 because importing `auth` from `tailor.config.ts` into runtime files pulls Node-only modules into the bundle.',
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/auth-invoker-unwrap/scripts/transform.js",
    suspiciousPatterns: [
      "auth.invoker",
      "authInvoker:",
      "authInvoker :",
      "authInvoker?",
      "{ authInvoker",
      ", authInvoker",
      "\n  authInvoker",
      "\n    authInvoker",
      "\n      authInvoker",
      '"authInvoker":',
      '"authInvoker" :',
      '"authInvoker"?',
      "'authInvoker':",
      "'authInvoker' :",
      "'authInvoker'?",
    ],
    prompt: [
      "In Tailor SDK v2 the auth.invoker() helper is removed; an invoker is now the",
      "machine user name passed directly as a string. The codemod already rewrote the",
      'statically identified SDK option form authInvoker: auth.invoker("name") to invoker: "name" and renamed supported authInvoker option keys. These files still contain',
      "auth.invoker(...) calls or authInvoker keys that need manual review.",
      "",
      "For each remaining auth.invoker(<expr>) call:",
      "1. Replace the whole call with <expr> only where the target option expects a",
      "   machine user name string; platform/runtime authInvoker payloads still expect",
      "   the object form.",
      "2. Rename remaining authInvoker option keys to invoker only for SDK resolver,",
      "   executor, workflow.trigger(), or startWorkflow() options. Keep platform/runtime",
      "   payload keys such as tailor.workflow.triggerWorkflow(..., { authInvoker: ... }).",
      "3. After removing every auth.invoker usage in a file, delete the now-unused auth",
      "   import (keeping it pulls Node-only config modules into runtime bundles); leave",
      "   the import if auth is still referenced elsewhere.",
      "",
      "Do not change behavior beyond the SDK option rename and auth.invoker() removal.",
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
    suspiciousPatterns: [
      ["executeScript", "JSON.stringify", /\barg\s*[:=]|["']arg["']\s*(?::|\]\s*[:=])/],
    ],
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
    filePatterns: ["**/*.{ts,tsx,mts,cts,mjs,cjs,js}"],
    suspiciousPatterns: ["openDownloadStream", "openFileDownloadStream"],
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
    filePatterns: ["**/*.{ts,tsx,mts,cts}"],
    suspiciousPatterns: [
      "tailor.context",
      "tailor.iconv",
      "tailor.idp",
      "tailor.workflow",
      "tailor[",
      "tailordb.Client",
      "tailordb.CommandType",
      "tailordb.QueryResult",
      "tailordb.file",
      "tailordb[",
      "TailorDBFileError",
      "TailorErrorItem",
      "TailorErrorMessage",
      "TailorErrors",
    ],
    examples: [
      {
        caption:
          "Preferred: switch to the typed wrappers from `@tailor-platform/sdk/runtime` and drop the ambient globals:",
        before: "const client = new tailor.idp.Client();",
        after:
          'import { idp } from "@tailor-platform/sdk/runtime";\nconst client = new idp.Client({ namespace: "my-namespace" });',
      },
      {
        caption:
          "Fallback: only if you must keep referencing the bare `tailor.*` names, opt into the global declarations:",
        before: "const client = new tailor.idp.Client();",
        after:
          'import "@tailor-platform/sdk/runtime/globals";\nconst client = new tailor.idp.Client();',
      },
    ],
    prompt: [
      "The v2 SDK no longer enables ambient Tailor runtime globals from",
      "`@tailor-platform/sdk`. For each flagged file that uses `tailor.*`,",
      "`tailordb.*`, or Tailor runtime error globals, prefer migrating to the",
      "typed wrappers from `@tailor-platform/sdk/runtime` (e.g. replace",
      '`new tailor.idp.Client()` with `import { idp } from "@tailor-platform/sdk/runtime"`',
      "and `new idp.Client({ namespace })`). The wrappers are self-contained, so the",
      "ambient globals are no longer needed.",
      "",
      "Only when the file must keep referencing the bare `tailor.*` names directly,",
      "opt into the global declarations instead by adding one of these:",
      '- per-file: `import "@tailor-platform/sdk/runtime/globals";`',
      '- project-wide: `"types": ["@tailor-platform/sdk/runtime/globals"]` in',
      "  the relevant tsconfig compilerOptions",
      "",
      "Leave files unchanged when the matching name is local, imported from another",
      "module, or appears only in comments or strings.",
    ].join("\n"),
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
      "`tailor function logs` maps stack traces against the function bundle only when the execution recorded a `contentHash`. Executions without one now show raw stack traces instead of mapped frames. No source change is required.",
    since: "1.0.0",
    until: "2.0.0",
    notice: true,
  },
  {
    id: "v2/rename-bin",
    name: "tailor-sdk binary → tailor",
    description:
      "Rename the CLI binary from `tailor-sdk` to `tailor` in package.json scripts, shell scripts, CI workflows, source files, generated declaration comments, and documentation. Does not rename `.tailor-sdk` directory paths or the `create-tailor-sdk` scaffolding package. Note: v2 also changes the default generated output directory from `.tailor-sdk/` to `.tailor/` and the setup lock file from `.github/tailor-sdk.lock` to `.github/tailor.lock`. Run `mv .tailor-sdk .tailor` to migrate the generated output directory (preserves auth connection state and other local files). Run `git mv .github/tailor-sdk.lock .github/tailor.lock` if the old lock file exists; without it `tailor setup check` will treat all managed workflows as missing. Update `.gitignore` entries manually (the codemod skips paths preceded by a dot).",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/rename-bin/scripts/transform.js",
    filePatterns: [
      "**/package.json",
      "**/*.{sh,bash,zsh,yml,yaml}",
      "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
      "**/*.md",
    ],
    legacyPatterns: ["tailor-sdk"],
    examples: [
      {
        lang: "sh",
        before: "tailor-sdk deploy\nnpx tailor-sdk@latest login",
        after: "tailor deploy\nnpx @tailor-platform/sdk@latest login",
      },
    ],
    prompt: [
      "Rename any remaining `tailor-sdk` binary invocations to `tailor`. Only rewrite",
      "the binary name — leave `.tailor-sdk` directory paths and `create-tailor-sdk`",
      "package references unchanged.",
    ].join("\n"),
  },
  {
    id: "v2/node-minimum-22-15-0",
    name: "Node.js minimum version raised to 22.15.0",
    description:
      "v2 requires Node.js **22.15.0** or later. This is the first version that includes `module.registerHooks()`, which the SDK uses to register its TypeScript loader hook synchronously in the main thread. No source change is required; ensure your environment runs Node.js 22.15.0+.",
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
