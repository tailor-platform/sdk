import * as url from "node:url";
import * as path from "pathe";
import { gte, lt, parse, valid } from "semver";
import type { CodemodPackage } from "./types";

const CODEMODS_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "codemods");
const RENAME_BIN_SOURCE_VALUE_FLAGS = [
  "--env-file-if-exists",
  "--env-file",
  "--profile",
  "--config",
  "--workspace-id",
  "--arg",
  "--query",
  "--file",
  "--name",
  "--namespace",
  "--dir",
  "-e",
  "-p",
  "-c",
  "-w",
  "-a",
  "-q",
  "-f",
  "-n",
];
const RENAME_BIN_SOURCE_COMMANDS = [
  "api",
  "apply",
  "authconnection",
  "completion",
  "crash-report",
  "crashreport",
  "deploy",
  "executor",
  "function",
  "generate",
  "init",
  "login",
  "logout",
  "machineuser",
  "oauth2client",
  "open",
  "organization",
  "profile",
  "query",
  "remove",
  "secret",
  "setup",
  "show",
  "skills",
  "staticwebsite",
  "tailordb",
  "upgrade",
  "user",
  "workflow",
  "workspace",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const RENAME_BIN_SOURCE_VALUE_GUARDS = RENAME_BIN_SOURCE_VALUE_FLAGS.flatMap((flag) => {
  const escaped = escapeRegExp(flag);
  return [`(?<!${escaped}\\s+)`, `(?<!${escaped}=)`];
}).join("");
const RENAME_BIN_SOURCE_COMMAND_OR_FLAG = `(?:--?[\\w-]+|${RENAME_BIN_SOURCE_COMMANDS.join("|")})`;
const RENAME_BIN_SOURCE_COMMAND_TOKEN =
  "tailor-sdk(?:(?:\\.(?:cmd|ps1|exe))|(?:@[^\\s'\"`;|&)]+))?(?![\\w-])";
const RENAME_BIN_SOURCE_LEGACY_PATTERN = new RegExp(
  [
    "(?<![.\\w-])",
    "(?<![\"'])",
    "(?<!\\\\[\"'])",
    RENAME_BIN_SOURCE_VALUE_GUARDS,
    RENAME_BIN_SOURCE_COMMAND_TOKEN,
    `(?=\\s*(?:$|${RENAME_BIN_SOURCE_COMMAND_OR_FLAG}\\b))`,
  ].join(""),
);
const RENAME_BIN_QUOTED_SOURCE_LEGACY_PATTERN = new RegExp(
  [
    "(?:^|[\\s;&|\\x00])(?:sh|bash|zsh)\\s+-\\w*c\\w*\\s+\\\\?[\"']",
    RENAME_BIN_SOURCE_COMMAND_TOKEN,
    `(?=\\s*(?:$|${RENAME_BIN_SOURCE_COMMAND_OR_FLAG}\\b))`,
  ].join(""),
);
const RENAME_BIN_QUOTED_LEGACY_COMMAND_PATTERN = new RegExp(
  [
    RENAME_BIN_SOURCE_VALUE_GUARDS,
    "[\"']",
    RENAME_BIN_SOURCE_COMMAND_TOKEN,
    "(?=\\s*(?:apply\\b|crash-report\\b|[^\"'`]*\\s--machineuser\\b))",
  ].join(""),
);
const V2_NEXT_1 = "2.0.0-next.1";
const V2_NEXT_2 = "2.0.0-next.2";
const V2_NEXT_4 = "2.0.0-next.4";
const V2_NEXT_5 = "2.0.0-next.5";
const V2_NEXT_6 = "2.0.0-next.6";
const V2_NEXT_7 = "2.0.0-next.7";
const V2_NEXT_9 = "2.0.0-next.9";
/**
 * Sentinel `prereleaseUntil` for a codemod whose exact `2.0.0-next.N` release is not
 * known yet. `pnpm codemod:resolve-pending`, run in CI against the release PR, replaces
 * it with the resolved `V2_NEXT_N` constant once the version is bumped. Keep this as an
 * `export const V2_NEXT_PENDING = "pending";` declaration: resolve-pending-boundaries.ts
 * matches it (tolerating whitespace changes and an optional preceding JSDoc block like
 * this one) to find where to insert that constant, and it's exported so registry.test.ts
 * can reference the sentinel directly.
 */
export const V2_NEXT_PENDING = "pending";

/** All registered codemods, in registration order. */
export const allCodemods: CodemodPackage[] = [
  {
    id: "v2/define-generators-to-plugins",
    name: "defineGenerators → definePlugins",
    description:
      "Migrate defineGenerators() tuple syntax to definePlugins() with explicit plugin imports",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_1,
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
    prereleaseUntil: V2_NEXT_1,
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
    prereleaseUntil: V2_NEXT_1,
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
    name: "tailor-sdk-skills → tailor skills add",
    description: "Replace deprecated `tailor-sdk-skills` invocations with `tailor skills add`",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_1,
    scriptPath: "v2/sdk-skills-shim/scripts/transform.js",
    filePatterns: ["**/package.json", "**/*.{sh,bash,zsh,yml,yaml}", "**/*.md"],
    legacyPatterns: ["tailor-sdk-skills"],
    examples: [
      {
        lang: "sh",
        before: "npx tailor-sdk-skills",
        after: "tailor skills add",
      },
    ],
    prompt: [
      "The standalone tailor-sdk-skills binary is removed in v2; call the skills add",
      "subcommand on the main tailor CLI instead. Replace any remaining",
      "tailor-sdk-skills invocations the codemod did not rewrite with",
      "`tailor skills add`.",
    ].join("\n"),
  },
  {
    id: "v2/principal-unify",
    name: "Unify TailorUser/TailorActor/TailorActorType/TailorInvoker → TailorPrincipal",
    description:
      "Rename TailorUser/TailorActor/TailorActorType/TailorInvoker to TailorPrincipal, drop unauthenticatedTailorUser, rename resolver body `user` to `caller`, and rename TailorDB callback `user` to `invoker`",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_2,
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
    prereleaseUntil: V2_NEXT_1,
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
    prereleaseUntil: V2_NEXT_1,
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
    id: "v2/auth-invoker-call-unwrap",
    name: 'auth.invoker("name") → "name"',
    description:
      'Replace statically identified SDK `auth.invoker("name")` option values with the bare `"name"` string while preserving the `authInvoker` key for SDK versions before the option rename.',
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_1,
    scriptPath: "v2/auth-invoker-call-unwrap/scripts/transform.js",
    suspiciousPatterns: ["auth.invoker"],
    reviewSupersededBy: ["v2/auth-invoker-unwrap"],
    prompt: [
      "In Tailor SDK v2 the auth.invoker() helper is removed; an invoker is now the",
      "machine user name passed directly as a string. The codemod already rewrote the",
      'statically identified SDK option form authInvoker: auth.invoker("name") to authInvoker: "name". These files still contain',
      "auth.invoker(...) calls that need manual review.",
      "",
      "For each remaining auth.invoker(<expr>) call:",
      "1. Replace the whole call with <expr> only where the target option expects a",
      "   machine user name string; platform/runtime authInvoker payloads still expect",
      "   the object form.",
      "2. Keep the authInvoker key when targeting SDK versions before the invoker",
      "   option rename; later v2 targets run a separate codemod for that key rename.",
      "3. After removing every auth.invoker usage in a file, delete the now-unused auth",
      "   import (keeping it pulls Node-only config modules into runtime bundles); leave",
      "   the import if auth is still referenced elsewhere.",
      "",
      "Do not change behavior beyond the auth.invoker() removal.",
    ].join("\n"),
    examples: [
      {
        before: 'createResolver({ authInvoker: auth.invoker("manager") });',
        after: 'createResolver({ authInvoker: "manager" });',
      },
    ],
  },
  {
    id: "v2/auth-invoker-unwrap",
    name: 'auth.invoker("name") → invoker: "name"',
    description:
      'Rename statically identified SDK `authInvoker` options to `invoker`, replace `auth.invoker("name")` there with the bare `"name"` string, and drop the `auth` import when no other reference remains. Ambiguous workflow `.start()` calls are left for manual review. The `auth.invoker()` helper is removed in v2 because importing `auth` from `tailor.config.ts` into runtime files pulls Node-only modules into the bundle.',
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_2,
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
      "   executor, workflow.start(), or startWorkflow() options. Keep platform/runtime",
      "   payload keys such as tailor.workflow.startWorkflow(..., { authInvoker: ... }).",
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
    id: "v2/auth-connection-token-helper",
    name: "auth.getConnectionToken() → runtime authconnection",
    description:
      "The deprecated `auth.getConnectionToken()` helper returned by `defineAuth()` is removed in v2. Use `authconnection.getConnectionToken(...)` from `@tailor-platform/sdk/runtime` in resolvers, executors, and workflows instead.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_2,
    scriptPath: "v2/auth-connection-token-helper/scripts/transform.js",
    filePatterns: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    examples: [
      {
        before:
          'import { auth } from "../tailor.config";\n\nconst token = await auth.getConnectionToken("google");',
        after:
          'import { authconnection } from "@tailor-platform/sdk/runtime";\n\nconst token = await authconnection.getConnectionToken("google");',
      },
    ],
    prompt: [
      "In Tailor SDK v2 the auth.getConnectionToken() helper returned by defineAuth()",
      "is removed. Runtime code should call authconnection.getConnectionToken(...) from",
      "@tailor-platform/sdk/runtime instead of importing auth from tailor.config.ts.",
      "",
      "For each getConnectionToken usage where <receiver> is a defineAuth() result",
      "imported from tailor.config.ts:",
      "1. Replace <receiver>.getConnectionToken(<expr>) calls with",
      "   authconnection.getConnectionToken(<expr>).",
      "2. Update non-call references, including <receiver>.getConnectionToken,",
      '   <receiver>["getConnectionToken"], and destructuring from <receiver>, to',
      "   reference authconnection instead.",
      '3. Add or reuse `import { authconnection } from "@tailor-platform/sdk/runtime"`.',
      "4. Remove the auth import from tailor.config.ts only when no other auth reference",
      "   remains in the file.",
      "",
      "Leave usages unchanged when the receiver is already the runtime authconnection",
      "wrapper or global tailor.authconnection.",
    ].join("\n"),
  },
  {
    id: "v2/runtime-subpath-namespace",
    name: "Runtime subpath imports use namespace objects",
    description:
      "Rewrite `@tailor-platform/sdk/runtime/*` namespace-star and flat value imports to self-named namespace imports, and aggregate `file.deleteFile` calls to `file.delete`. `TailorContextAPI` and `TailorWorkflowAPI` now describe SDK wrappers; direct platform globals use `PlatformContextAPI` and `PlatformWorkflowAPI`.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_4,
    scriptPath: "v2/runtime-subpath-namespace/scripts/transform.js",
    filePatterns: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    legacyPatterns: [
      "@tailor-platform/sdk/runtime/iconv",
      "@tailor-platform/sdk/runtime/secretmanager",
      "@tailor-platform/sdk/runtime/authconnection",
      "@tailor-platform/sdk/runtime/idp",
      "@tailor-platform/sdk/runtime/workflow",
      "@tailor-platform/sdk/runtime/context",
      "@tailor-platform/sdk/runtime/file",
      "@tailor-platform/sdk/runtime/aigateway",
    ],
    examples: [
      {
        before:
          'import * as iconv from "@tailor-platform/sdk/runtime/iconv";\niconv.convert(value, "UTF-8", "Shift_JIS");',
        after:
          'import { iconv } from "@tailor-platform/sdk/runtime/iconv";\niconv.convert(value, "UTF-8", "Shift_JIS");',
      },
      {
        before:
          'import { get } from "@tailor-platform/sdk/runtime/aigateway";\nconst gateway = await get("main");',
        after:
          'import { aigateway } from "@tailor-platform/sdk/runtime/aigateway";\nconst gateway = await aigateway.get("main");',
      },
      {
        before:
          'import { file } from "@tailor-platform/sdk/runtime";\nawait file.deleteFile("ns", "Doc", "blob", "record-id");',
        after:
          'import { file } from "@tailor-platform/sdk/runtime";\nawait file.delete("ns", "Doc", "blob", "record-id");',
      },
    ],
    prompt: [
      "In Tailor SDK v2, runtime subpath modules export only a self-named namespace",
      "object (for example, `iconv` from `@tailor-platform/sdk/runtime/iconv`).",
      "Default and flat value imports such as",
      '`import { get } from "@tailor-platform/sdk/runtime/aigateway"` are removed.',
      "The codemod rewrites straightforward namespace-star imports and flat named value",
      "imports. It also rewrites direct `file.deleteFile` calls on the aggregate runtime",
      "namespace to `file.delete`. Destructured aggregate `deleteFile` references require",
      "manual migration. Review any remaining runtime imports manually, especially when",
      "a local binding or nested scope shadows an imported value, or when",
      "type-position namespace member references need explicit top-level type imports.",
      "For direct platform globals, replace `TailorContextAPI` and `TailorWorkflowAPI`",
      "type references with `PlatformContextAPI` and `PlatformWorkflowAPI` respectively.",
    ].join("\n"),
  },
  {
    id: "v2/tailordb-namespace",
    name: "Tailordb → tailordb (lowercase ambient namespace)",
    description:
      'Rewrite references to the removed capital-cased `Tailordb` ambient namespace (`Tailordb.QueryResult`, `Tailordb.CommandType`, `Tailordb.Client`, `typeof Tailordb.Client`) to the lowercase `tailordb.*` namespace exposed by `@tailor-platform/sdk/runtime/globals`. Because v2 no longer activates ambient declarations automatically, each file that contains `tailordb.*` references after the rewrite must also add `import "@tailor-platform/sdk/runtime/globals"`.',
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_1,
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
    id: "v2/db-type-to-table",
    name: "db.type() → db.table()",
    description:
      "Rename TailorDB schema builder calls from `db.type()` to `db.table()`. TailorDB schema definitions now use table terminology in SDK projects.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_4,
    scriptPath: "v2/db-type-to-table/scripts/transform.js",
    filePatterns: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    legacyPatterns: ["db.type"],
    examples: [
      {
        before:
          'import { db } from "@tailor-platform/sdk";\n\nexport const user = db.type("User", {\n  name: db.string(),\n});',
        after:
          'import { db } from "@tailor-platform/sdk";\n\nexport const user = db.table("User", {\n  name: db.string(),\n});',
      },
    ],
    prompt: [
      "In Tailor SDK v2, TailorDB schema definitions use db.table(...) instead of",
      "db.type(...). The codemod rewrites member accesses on db imported from",
      "@tailor-platform/sdk, including aliases such as `import { db as schema }`.",
      "It flags destructured builder aliases such as `const { type } = db` and",
      "local builder aliases such as `const schema = db`, `schema = db`, or",
      "`function make(schema = db) { ... }` for manual review because the local",
      "alias may require call-site renaming.",
      "Review any remaining db.type references and rename SDK TailorDB schema builder",
      "calls to db.table. Leave unrelated local objects with a .type() method unchanged.",
    ].join("\n"),
  },
  {
    id: "v2/forward-relation-name",
    name: "TailorDB forward relation names derive from field names",
    description:
      "Review TailorDB relations that omit `toward.as`. Their forward GraphQL field names now derive from the relation field name with a trailing `ID`, `Id`, or `id` removed, instead of from the target table name.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_5,
    scriptPath: "v2/forward-relation-name/scripts/transform.js",
    filePatterns: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    suspiciousPatterns: [
      /\.relation\b(?!\s*\()/,
      /\{[^}\n]*\brelation\b[^}\n]*\}\s*=/,
      /\[\s*["']relation["']\s*\]/,
    ],
    examples: [
      {
        caption: "Preserve the v1 GraphQL field name by making it explicit:",
        before: [
          "ownerId: db.uuid().relation({",
          '  type: "n-1",',
          "  toward: { type: user },",
          "}),",
        ].join("\n"),
        after: [
          "ownerId: db.uuid().relation({",
          '  type: "n-1",',
          '  toward: { type: user, as: "user" },',
          "}),",
        ].join("\n"),
      },
    ],
    prompt: [
      "Tailor SDK v2 derives a default forward GraphQL relation name from the source",
      "field name by removing a trailing ID, Id, or id. V1 derived it from the target",
      "table name. Review each reported non-self relation that omits toward.as.",
      "",
      "If consumers must keep using the v1 GraphQL field name, inspect the v1 schema and",
      "copy that exact field name into toward.as. Otherwise, update GraphQL operations",
      "and consumer code to use the new field-based name. No change is needed when the old",
      "and new names are identical. Relations with a guaranteed non-empty toward.as,",
      "self-relations, and keyOnly relations are unchanged. For an empty or dynamic",
      "toward.as, determine whether its runtime value can be falsy; if so, treat the",
      "relation as using the default name.",
      "",
      "A relation field without a trailing ID, Id, or id would default to its own scalar",
      "field name and therefore conflict. Give that relation an explicit toward.as.",
    ].join("\n"),
  },
  {
    id: "v2/execute-script-arg",
    name: "executeScript arg JSON.stringify → value",
    description:
      "Unwrap `JSON.stringify(...)` passed as the `executeScript` `arg` option. In v2 `arg` takes a JSON-serializable value and is serialized internally, so a pre-stringified argument double-encodes.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_2,
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
    id: "v2/idp-publish-events-rename",
    name: "defineIdp publishUserEvents → publishEvents",
    description:
      "Rename the `defineIdp` option `publishUserEvents` to `publishEvents`, matching the field name TailorDB types, resolvers, and workflows already use.",
    since: "1.5.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_PENDING,
    // No legacyPatterns: a shorthand rewrite keeps `publishUserEvents` as the
    // value identifier, so the token survives a successful migration. What the
    // transform cannot reach is reported by reviewFindings instead.
    scriptPath: "v2/idp-publish-events-rename/scripts/transform.js",
    examples: [
      {
        before:
          'import { defineIdp } from "@tailor-platform/sdk";\n\nexport const idp = defineIdp("my-idp", {\n  clients: ["my-client"],\n  publishUserEvents: true,\n});',
        after:
          'import { defineIdp } from "@tailor-platform/sdk";\n\nexport const idp = defineIdp("my-idp", {\n  clients: ["my-client"],\n  publishEvents: true,\n});',
      },
      {
        caption: "A shorthand option keeps reading the same local:",
        before: 'defineIdp("my-idp", { clients, publishUserEvents });',
        after: 'defineIdp("my-idp", { clients, publishEvents: publishUserEvents });',
      },
    ],
    prompt: [
      "In Tailor SDK v2, the IdP option `publishUserEvents` is renamed to",
      "`publishEvents`, so all four services that publish events use one field name.",
      "The codemod rewrites the option key on `defineIdp` calls whose callee resolves",
      "to the SDK export, including aliased and namespace imports, and rewrites a",
      "shorthand `{ publishUserEvents }` to `{ publishEvents: publishUserEvents }` so",
      "it keeps reading the same local.",
      "",
      "Also review, and migrate by hand:",
      "- An options object built in a variable or spread into the call — the codemod",
      "  only rewrites object literals passed directly to `defineIdp`.",
      "- A computed key (e.g. `[key]: value`) that resolves to `publishUserEvents`.",
      "- Type annotations or interfaces that declare the option themselves.",
      "- A file where a local declaration shadows the `defineIdp` import; the codemod",
      "  skips it because the call may not be the SDK export.",
    ].join("\n"),
  },
  {
    id: "v2/wait-point-rename",
    name: "defineWaitPoint/defineWaitPoints → createWaitPoint/createWaitPoints",
    description:
      "Rename `defineWaitPoint` and `defineWaitPoints` to `createWaitPoint` and `createWaitPoints`. The functions create runtime instances with `.wait()` / `.resolve()` methods, so the `create*` prefix is used consistently.",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/wait-point-rename/scripts/transform.js",
    legacyPatterns: ["defineWaitPoint", "defineWaitPoints"],
    examples: [
      {
        before:
          'import { defineWaitPoints } from "@tailor-platform/sdk";\n\nexport const { approval } = defineWaitPoints((define) => ({\n  approval: define<{ message: string }, { approved: boolean }>(),\n}));',
        after:
          'import { createWaitPoints } from "@tailor-platform/sdk";\n\nexport const { approval } = createWaitPoints((define) => ({\n  approval: define<{ message: string }, { approved: boolean }>(),\n}));',
      },
    ],
  },
  {
    id: "v2/workflow-trigger-rename",
    name: "workflow.triggerWorkflow/triggerJobFunction/resumeWorkflow → startWorkflow/execJobFunction/resumeWorkflowExecution",
    description:
      "Rename tailor.workflow call sites from the pre-alignment triggerWorkflow/triggerJobFunction/resumeWorkflow names to the canonical startWorkflow/execJobFunction/resumeWorkflowExecution names, on both the ambient tailor.workflow global and a workflow value imported from @tailor-platform/sdk/runtime(/workflow). For a renamed triggerWorkflow call, also renames a literal `invoker` option key to `authInvoker` — startWorkflow's options expect the platform shape directly, unlike the removed triggerWorkflow wrapper, which converted invoker to authInvoker internally.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_6,
    scriptPath: "v2/workflow-trigger-rename/scripts/transform.js",
    filePatterns: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    legacyPatterns: ["triggerWorkflow", "triggerJobFunction", "resumeWorkflow"],
    examples: [
      {
        before:
          'import { workflow } from "@tailor-platform/sdk/runtime";\n\nawait workflow.triggerWorkflow("myWorkflow", { data: "value" });',
        after:
          'import { workflow } from "@tailor-platform/sdk/runtime";\n\nawait workflow.startWorkflow("myWorkflow", { data: "value" });',
      },
      {
        caption: "A literal invoker option is renamed to authInvoker:",
        before:
          'await workflow.triggerWorkflow("myWorkflow", { data: "value" }, { invoker: myInvoker });',
        after:
          'await workflow.startWorkflow("myWorkflow", { data: "value" }, { authInvoker: myInvoker });',
      },
    ],
    prompt: [
      "The pre-alignment tailor.workflow names triggerWorkflow, triggerJobFunction, and",
      "resumeWorkflow are removed from the SDK's type surface in v2; use the canonical",
      "startWorkflow, execJobFunction, and resumeWorkflowExecution names instead. The",
      "codemod rewrites direct member-access call sites on the ambient tailor.workflow",
      "global and on a workflow value imported from @tailor-platform/sdk/runtime or",
      "@tailor-platform/sdk/runtime/workflow (including aliased imports). It skips a",
      "file entirely when a local declaration shadows the workflow import or the",
      "ambient tailor name, to avoid rewriting an unrelated same-named value — review",
      "those manually.",
      "",
      "For a renamed triggerWorkflow call, the codemod also renames a literal invoker",
      "option key (including shorthand { invoker }) to authInvoker, since startWorkflow",
      "expects the platform's authInvoker shape directly while triggerWorkflow's removed",
      "wrapper converted invoker to authInvoker internally.",
      "",
      "Also review, and migrate by hand:",
      "- Destructured references (e.g. const { triggerWorkflow } = workflow) — the",
      "  codemod only rewrites direct member-access calls.",
      "- Imported TriggerWorkflowOptions / TriggerJobFunctionOptions types — rename",
      "  them to StartWorkflowOptions / ExecJobFunctionOptions.",
      "- An invoker option passed via a variable or spread (not a literal object) —",
      "  the codemod only inspects literal object arguments; rename the invoker key",
      "  to authInvoker in the options object's own definition.",
    ].join("\n"),
  },
  {
    id: "v2/exec-job-function-rename",
    name: "workflow.startJobFunction → execJobFunction",
    description:
      "`tailor.workflow.startJobFunction` and the `StartJobFunctionOptions` type are removed in v2. Use the canonical `execJobFunction` / `ExecJobFunctionOptions`: `Exec*` blocks and returns the job's result, while `Start*` returns only an execution ID. The codemod rewrites member-access call sites on the ambient `tailor.workflow` global and on a `workflow` value imported from @tailor-platform/sdk/runtime(/workflow), and renames `StartJobFunctionOptions` imports along with the type references that resolve to them.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_PENDING,
    scriptPath: "v2/exec-job-function-rename/scripts/transform.js",
    filePatterns: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    legacyPatterns: ["startJobFunction", "StartJobFunctionOptions"],
    examples: [
      {
        before:
          'import { workflow } from "@tailor-platform/sdk/runtime";\n\nconst result = workflow.startJobFunction("myJob", { data: "value" });',
        after:
          'import { workflow } from "@tailor-platform/sdk/runtime";\n\nconst result = workflow.execJobFunction("myJob", { data: "value" });',
      },
    ],
    prompt: [
      "startJobFunction is removed from the SDK's workflow runtime surface in v2;",
      "execJobFunction is the canonical name for a blocking job call that returns the",
      "job's result. The codemod rewrites direct member-access calls on the ambient",
      "tailor.workflow global and on a workflow value imported from",
      "@tailor-platform/sdk/runtime or @tailor-platform/sdk/runtime/workflow (including",
      "aliased imports), and renames the StartJobFunctionOptions type. It skips a file",
      "entirely when a local declaration shadows the workflow import or the ambient",
      "tailor name, to avoid rewriting an unrelated same-named value.",
      "",
      "Also review, and migrate by hand:",
      "- Destructured references (e.g. const { startJobFunction } = workflow) — the",
      "  codemod only rewrites direct member-access calls.",
      "- mockWorkflow().startJobFunction in tests — assert on the execJobFunction vi.fn",
      "  instead; the alias was the same mock function.",
      "- A file that already imports ExecJobFunctionOptions alongside the removed type —",
      "  rename the remaining references by hand and drop the duplicate specifier.",
    ].join("\n"),
  },
  {
    id: "v2/open-download-stream",
    name: "openDownloadStream → downloadStream",
    description:
      "The deprecated `openDownloadStream` file-streaming API is removed in v2. Use `downloadStream` for streamed file downloads. The generated file utilities now emit `downloadFileStream` (which calls `downloadStream` and returns `FileDownloadStreamResponse`) instead of the removed `openFileDownloadStream` helper.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_2,
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
      'Importing `@tailor-platform/sdk` no longer activates the ambient `tailor.*` / `tailordb.*` global declarations. The codemod rewrites simple direct `new tailor.idp.Client(...)` calls to the typed `idp.Client` wrapper from `@tailor-platform/sdk/runtime`; broader runtime global usage remains review-only. Only if you relied on the ambient globals directly, add `import "@tailor-platform/sdk/runtime/globals"`. (The capital-cased `Tailordb.*` namespace is removed separately — see the `Tailordb → tailordb` codemod.)',
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_1,
    scriptPath: "v2/runtime-globals-opt-in/scripts/transform.js",
    filePatterns: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    suspiciousPatterns: [
      "tailor.context",
      "tailor.iconv",
      "tailor.idp",
      "tailor.secretmanager",
      "tailor.authconnection",
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
    sourceStringSuspiciousPatterns: [
      "new tailor.idp.Client",
      /[=(:,[]\s*tailor\.idp\.Client\b/,
      /(?:(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)tailor\.(?:authconnection|context|iconv|idp|secretmanager|workflow)(?:\.[A-Za-z_$][\w$]*)?\b/,
      /\btailor\.(?:authconnection|context|iconv|idp|secretmanager|workflow)\.[A-Za-z_$][\w$]*\s*\(/,
      "tailor[",
      /\btailordb\.file\.[A-Za-z_$][\w$]*\s*\(/,
      /(?:(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)tailordb\.file\b/,
      /(?:\bnew\s+|(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)tailordb\.(?:Client|CommandType|QueryResult)\b/,
      /<\s*tailordb\.(?:Client|CommandType|QueryResult)\b/,
      "tailordb[",
      /(?:\bnew\s+|\bthrow\s+|\binstanceof\s+)Tailor(?:DBFileError|Errors|ErrorMessage)\b/,
      /(?:[:=<]\s*|\bas\s+)Tailor(?:DBFileError|Errors|ErrorMessage|ErrorItem)\b/,
      /[:<]\s*TailorErrorItem\b/,
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
      "typed wrappers from `@tailor-platform/sdk/runtime`. The codemod already",
      "rewrites direct `new tailor.idp.Client(...)` calls to `new idp.Client(...)`",
      "when the file has no conflicting `tailor` or `idp` binding. For any remaining",
      "`tailor.idp.Client` references, either resolve the binding collision and use",
      "`idp.Client`, or keep the ambient global deliberately.",
      "",
      "Only when the file must keep referencing the bare `tailor.*` names directly,",
      "opt into the global declarations instead by adding one of these:",
      '- per-file: `import "@tailor-platform/sdk/runtime/globals";`',
      '- project-wide: `"types": ["@tailor-platform/sdk/runtime/globals"]` in',
      "  the relevant tsconfig compilerOptions",
      "",
      "Leave files unchanged when the matching name is local, imported from another",
      "module, or appears only in comments or prose strings. Embedded code strings",
      "that use runtime globals are review-only findings; do not insert imports inside",
      "string literals.",
    ].join("\n"),
  },
  {
    id: "v2/workflow-trigger-dispatch",
    name: "Workflow job start() and start tests",
    description:
      "Workflow job `.start()` (previously `.trigger()`) now aligns with the platform runtime: it returns the job result directly instead of a Promise wrapper, and tests no longer run job bodies locally. Mock start responses with `mockWorkflow()` (`setJobHandler` / `enqueueResult`, assert via `startedJobs`), or use `runWorkflowLocally()` for a full-chain local run.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_1,
    suspiciousPatterns: [".trigger("],
    examples: [
      {
        caption: "Tests must mock the workflow runtime instead of running bodies locally:",
        before: 'const result = await orderJob.start({ id });\nexpect(result.status).toBe("done");',
        after:
          'using wf = mockWorkflow();\nwf.setJobHandler((jobName) => (jobName === "order-job" ? { status: "done" } : null));\nconst result = await orderJob.start({ id });\nexpect(result.status).toBe("done");',
      },
    ],
    prompt: [
      "Workflow job .start() now uses the platform workflow runtime instead of running",
      "the job body locally. In tests, acquire `using wf = mockWorkflow()` and provide",
      "start responses (setJobHandler / enqueueResult), or use runWorkflowLocally() for a",
      "full-chain local run; an unmocked start now throws. Outside tests, treat the",
      "start result as the job output directly (no Promise wrapper to unwrap).",
    ].join("\n"),
  },
  {
    id: "v2/workflow-start-rename",
    name: "Workflow.trigger()/WorkflowJob.trigger() → .start()",
    description:
      "Rename `Workflow.trigger()` (returned by `createWorkflow()`) and `WorkflowJob.trigger()` (returned by `createWorkflowJob()`) to `.start()`, aligning the SDK's ergonomic verb with the platform's `start*` RPC vocabulary. No codemod ships for this rename: distinguishing a workflow/job `.trigger()` call from an unrelated object's own `.trigger()` method requires resolving the receiver back to a `createWorkflow`/`createWorkflowJob` result across files, which the SDK's own CLI bundler already does for build-time rewriting. Reusing that logic in a standalone script is a nontrivial lift, and — unlike the bundler, which fails loudly when it cannot rewrite a call — a codemod false positive would silently rewrite an unrelated `.trigger()` call with no error. For the call-site volume this rename typically involves, manual review guided by the prompt below is the safer trade-off.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_7,
    filePatterns: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    suspiciousPatterns: [".trigger("],
    examples: [
      {
        before: [
          "const inventory = checkInventory.trigger({ orderId: input.orderId });",
          'const workflowRunId = await orderProcessingWorkflow.trigger(args, { invoker: "manager" });',
        ].join("\n"),
        after: [
          "const inventory = checkInventory.start({ orderId: input.orderId });",
          'const workflowRunId = await orderProcessingWorkflow.start(args, { invoker: "manager" });',
        ].join("\n"),
      },
    ],
    prompt: [
      "In Tailor SDK v2, the ergonomic .trigger() method on a createWorkflow() or",
      "createWorkflowJob() result is renamed to .start(). This is unrelated to the",
      "separate tailor.workflow.triggerWorkflow/triggerJobFunction/resumeWorkflow removal",
      "(see the workflow-trigger-rename codemod) — this rename targets the SDK's own",
      "ergonomic wrapper, not the low-level platform call.",
      "",
      "For each flagged `.trigger(` call in these files:",
      "1. Confirm the receiver is a workflow or job object — typically a local const",
      "   assigned from createWorkflow(...)/createWorkflowJob(...), a named import of one,",
      "   or the default import of a workflow module. Skip receivers that are unrelated",
      "   objects with their own .trigger() method (state machines, event emitters, etc.).",
      "2. Rename the call from .trigger(...) to .start(...); the argument list is unchanged.",
      "3. Update any mock/test code that reads WorkflowJob['trigger'] / Workflow['trigger']",
      "   as a type, or that mocks the ergonomic method via a wrapper — for example,",
      "   `wf.job(definition)` / `wf.workflow(definition)` from mockWorkflow() now return a",
      "   mock of the `.start` method.",
      '4. Update prose/docs/comments that say "trigger the workflow/job" to "start" only',
      "   where they describe this SDK verb specifically, not unrelated event terminology.",
    ].join("\n"),
  },
  {
    id: "v2/publish-events-recomputed-per-deploy",
    name: "publishEvents recomputed from the executors in each deploy",
    description:
      "An unset `publishEvents` is recomputed on every `deploy` from the executors taking part in the run, in both directions: adding a subscribing trigger turns publishing on, and removing the last one turns it back off. Previously a workflow or job kept publishing once it had been enabled, so a workflow whose subscribing trigger is already gone stops publishing on the next `deploy` — declare `publishEvents: true` on it if something outside this project consumes those events. `deploy` also stops instead of applying when a subscription cannot be satisfied: when a trigger names a resource no config in the run declares, when a workflow or job combines `publishEvents: false` with a subscribing trigger, and when a config that resolves without an `id` subscribes across configs. Each of those errors names the resource and both ways to resolve it.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_PENDING,
    notice: true,
  },
  {
    id: "v2/cli-token-keyring-storage",
    name: "CLI tokens stored in the OS keyring",
    description:
      "CLI login tokens are stored in the OS keyring by default when available, falling back to the platform config file when it is not. No source change is required; re-login if you need tokens moved into the keyring.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_2,
    notice: true,
  },
  {
    id: "v2/cli-users-by-subject",
    name: "CLI users keyed by subject ID",
    description:
      "The CLI stores human users by their stable subject ID instead of email (email is kept for display). Legacy email-keyed entries are migrated automatically on the next login or token refresh. No source change is required.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_1,
    notice: true,
  },
  {
    id: "v2/function-logs-content-hash",
    name: "function logs require a content hash for source mapping",
    description:
      "`tailor function logs` maps stack traces against the function bundle only when the execution recorded a `contentHash`. Executions without one now show raw stack traces instead of mapped frames. No source change is required.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_1,
    notice: true,
  },
  {
    id: "v2/rename-bin",
    name: "tailor-sdk binary → tailor",
    description:
      "Rename the CLI binary from `tailor-sdk` to `tailor` in package.json scripts, shell scripts, CI workflows, source files, generated declaration comments, and documentation. Does not rename `.tailor-sdk` directory paths or the `create-tailor-sdk` scaffolding package. Note: v2 also changes the default generated output directory from `.tailor-sdk/` to `.tailor/` and the setup lock file from `.github/tailor-sdk.lock` to `.github/tailor.lock`. Run `mv .tailor-sdk .tailor` to migrate the generated output directory (preserves auth connection state and other local files). Run `git mv .github/tailor-sdk.lock .github/tailor.lock` if the old lock file exists; without it `tailor setup check` will treat all managed workflows as missing. Exact ignore-file entries for `.tailor-sdk/` are handled by the generated-output ignore codemod. If your CI workflows were generated by `tailor setup`, re-run `tailor setup` afterwards so they pin tailor-platform/actions v2 — the v1 actions invoke the removed `tailor-sdk` bin.",
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
    sourceStringLegacyPatterns: [
      RENAME_BIN_SOURCE_LEGACY_PATTERN,
      RENAME_BIN_QUOTED_SOURCE_LEGACY_PATTERN,
      RENAME_BIN_QUOTED_LEGACY_COMMAND_PATTERN,
    ],
    sourceTextLegacyPatterns: [
      RENAME_BIN_SOURCE_LEGACY_PATTERN,
      RENAME_BIN_QUOTED_SOURCE_LEGACY_PATTERN,
      RENAME_BIN_QUOTED_LEGACY_COMMAND_PATTERN,
    ],
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
    id: "v2/tailor-output-ignore-dir",
    name: ".tailor-sdk ignore entries → .tailor",
    description:
      "Rewrite exact ignore-file entries for the v1 generated output directory from `.tailor-sdk` to the v2 `.tailor` directory. Other `.tailor-sdk` paths and prose are left unchanged.",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/tailor-output-ignore-dir/scripts/transform.js",
    filePatterns: [
      "**/.gitignore",
      "**/.npmignore",
      "**/.dockerignore",
      "**/gitignore",
      "**/npmignore",
      "**/dockerignore",
      "**/_gitignore",
      "**/_npmignore",
      "**/_dockerignore",
      "**/__dot__gitignore",
      "**/__dot__npmignore",
      "**/__dot__dockerignore",
      "**/*.gitignore",
      "**/*.npmignore",
      "**/*.dockerignore",
    ],
    examples: [
      {
        lang: "gitignore",
        before: ".tailor-sdk/",
        after: ".tailor/",
      },
    ],
  },
  {
    id: "v2/tailordb-validate-simplify",
    name: "ValidateFn simplification and type-level validate",
    description:
      "Field-level `ValidateFn` is simplified from `(args: { value, data, invoker }) => boolean` to `(args: { value }) => string | void` — the function now returns the error message directly instead of a separate `[fn, message]` tuple. The `ValidateConfig` tuple form and `Validators<F>` record syntax on `db.type().validate()` are removed. Type-level validation uses `db.type().validate((args, issues) => void)` with `{ newRecord, oldRecord, invoker }` args and an `issues(field, message)` callback for cross-field rules.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_5,
    suspiciousPatterns: ["ValidateConfig", "Validators<", "ValidatorsBase", ".validate("],
    examples: [
      {
        caption:
          "Field-level validate: return an error message string instead of a boolean (tuple form removed):",
        before:
          '.validate(\n  [({ value }) => value.length > 5, "Name must be longer than 5 characters"],\n)',
        after:
          '.validate(({ value }) =>\n  value.length <= 5 ? "Name must be longer than 5 characters" : undefined,\n)',
      },
      {
        caption:
          "Type-level validate: per-field record syntax replaced by a single function with `issues()` callback:",
        before:
          '.validate({\n  name: [({ value }) => value.length > 5, "Name must be longer than 5"],\n})',
        after:
          '.validate(({ newRecord }, issues) => {\n  if (newRecord.name && newRecord.name.length <= 5) {\n    issues("name", "Name must be longer than 5");\n  }\n})',
      },
    ],
    prompt: [
      "The v2 SDK simplifies field validation and introduces type-level validation.",
      "",
      "Field-level `.validate()` changes:",
      "- Signature: `(args: { value, data, invoker }) => boolean` → `(args: { value }) => string | void`",
      "- The function now returns the error message string directly (or undefined/void to pass)",
      "  instead of returning a boolean with the message in a separate tuple.",
      "- The `[fn, errorMessage]` tuple form (`ValidateConfig`) is removed.",
      "- `data` and `invoker` are no longer available in field-level validators.",
      "  Use type-level `.validate()` for cross-field or invoker-dependent rules.",
      "",
      "Type-level `.validate()` on `db.type()` changes:",
      "- Old: `.validate({ fieldName: fn | [fn, msg] | fn[] })` (per-field record, `Validators<F>` type)",
      "- New: `.validate((args, issues) => void)` (single function, `TypeValidateFn<F>` type)",
      "- Args: `{ newRecord, oldRecord, invoker }` — `newRecord` is the record after hooks run",
      "- Call `issues(field, message)` to report validation errors; `field` supports dotted paths",
      "- Move per-field validators that need `data`/`invoker` to the type-level function",
      "",
      "For each remaining `ValidateConfig`, `Validators<`, or old-signature `.validate()` usage:",
      "1. Rewrite field-level validators to return the error string directly",
      "2. Move cross-field / invoker-dependent validators to the type-level function",
      "3. Remove unused `ValidateConfig` / `Validators` type imports",
    ].join("\n"),
  },
  {
    id: "v2/tailordb-hook-redesign",
    name: "TailorDB hook redesign: field-level args and type-level hooks",
    description:
      "Field-level `HookFn` args change from `{ value, data, invoker }` to create `{ input, invoker, now }` / update `{ input, oldValue, invoker, now }` — `value` is renamed to `input`, matching the `input` arg on type-level hooks (same pre-hook data, narrowed to one field); `data` (the full record) is removed; `oldValue` (previous field value) is added for update hooks only; `now` (operation timestamp) is shared across all hooks. Type-level hooks on `db.type().hooks()` change from per-field mapping `{ fieldName: { create, update } }` (`Hooks<F>`) to a single `{ create, update }` object (`TypeHook<F>`) — create hooks take `{ input, invoker, now }`, update hooks take `{ input, oldRecord, invoker, now }` (oldRecord is always non-null). Both return partial field overrides.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_5,
    suspiciousPatterns: ["Hooks<", "HookFn<", "Hook<", ".hooks("],
    examples: [
      {
        caption:
          "Field-level hooks: `value` renamed to `input`, `data` replaced by `oldValue` and `now`; use `now` instead of `new Date()`:",
        before:
          "db.datetime().hooks({\n  create: ({ value }) => value ?? new Date(),\n  update: () => new Date(),\n})",
        after:
          "db.datetime().hooks({\n  create: ({ input, now }) => input ?? now,\n  update: ({ now }) => now,\n})",
      },
      {
        caption: "Type-level hooks: per-field mapping replaced by single create/update functions:",
        before:
          ".hooks({\n  fullAddress: {\n    create: ({ data }) => `${data.postalCode} ${data.address}`,\n    update: ({ data }) => `${data.postalCode} ${data.address}`,\n  },\n})",
        after:
          ".hooks({\n  create: ({ input }) => ({\n    fullAddress: `${input.postalCode} ${input.address}`,\n  }),\n  update: ({ input }) => ({\n    fullAddress: `${input.postalCode} ${input.address}`,\n  }),\n})",
      },
    ],
    prompt: [
      "The v2 SDK redesigns TailorDB hooks at both field and type levels.",
      "",
      "Field-level `.hooks()` on individual fields:",
      "- Create args: `{ value, data, invoker }` → `{ input, invoker, now }` (no `oldValue`)",
      "- Update args: `{ value, data, invoker }` → `{ input, oldValue, invoker, now }`",
      "- `value` is renamed to `input`, matching the type-level hook's `input` arg — both are",
      "  the same pre-hook data, at different granularity",
      "- `data` (full record) is removed; update hooks get `oldValue` (previous field value) instead",
      "- `now` provides the operation timestamp — use `now` instead of `new Date()`",
      "- If a field-level hook needs the full record (other fields), move it to a type-level hook",
      "",
      "Type-level `.hooks()` on `db.type()`:",
      "- Old: `.hooks({ fieldName: { create: fn, update: fn } })` (per-field mapping, `Hooks<F>` type)",
      "- New: `.hooks({ create: fn, update: fn })` (single object, `TypeHook<F>` type)",
      "- Each function: `({ input, oldRecord, invoker, now }) => ({ fieldName: value, ... })`",
      "- `input` is the pre-hook input (may have nullish values for optional/defaulted fields)",
      "- Create hooks do not receive `oldRecord`; update hooks receive `oldRecord` (always non-null)",
      "- Return an object with only the fields to override; unmentioned fields are unchanged",
      "",
      "Migration steps for each `.hooks()` call on a `db.type()`:",
      "1. If the old per-field hooks only use `value`/`invoker` and don't reference `data`,",
      "   convert them to field-level hooks with the new args (`value` → `input`, plus `oldValue`, `now`)",
      "2. If the old hooks reference `data` (cross-field access), convert to a type-level hook",
      "   using `input`/`oldRecord`",
      "3. Remove unused `Hooks<F>` / `HookFn<>` type imports",
    ].join("\n"),
  },
  {
    id: "v2/erd-site-to-plugin",
    name: "`db.<namespace>.erdSite` → `tailordbErdPlugin({ sites })`",
    description:
      "Move the TailorDB `erdSite` setting from `db.<namespace>` in tailor.config.ts into `tailordbErdPlugin({ sites })` from `@tailor-platform/sdk-plugin-tailordb-erd`, registered via definePlugins(). The core config schema no longer accepts `erdSite`; the `tailor tailordb erd` commands read the target static website from the plugin configuration and validate each site name against `staticWebsites`. Install `@tailor-platform/sdk-plugin-tailordb-erd` as a dev dependency: the migrated config imports it, so config loading fails with a module-not-found error until it is installed.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_9,
    scriptPath: "v2/erd-site-to-plugin/scripts/transform.js",
    legacyPatterns: ["erdSite:"],
    // Quoted keys ("erdSite": ...) survive only as string fragments after
    // masking, so they need the sourceString variants to be detected at all.
    sourceStringLegacyPatterns: ["erdSite"],
    // erdSite matching uses property-key shapes only, so an unrelated
    // `erdSite` variable (e.g. a defineStaticWebSite binding) is not
    // re-flagged after a clean transform. tailordbErdPlugin flags every
    // migrated config so the LLM verifies the new package is installed.
    suspiciousPatterns: ["erdSite:", /\berdSite\s*[,}]/, "tailordbErdPlugin"],
    sourceStringSuspiciousPatterns: ["erdSite"],
    examples: [
      {
        before: [
          "export default defineConfig({",
          "  db: {",
          "    tailordb: {",
          '      files: ["./tailordb/*.ts"],',
          '      erdSite: "my-erd-site",',
          "    },",
          "  },",
          "});",
        ].join("\n"),
        after: [
          'import { tailordbErdPlugin } from "@tailor-platform/sdk-plugin-tailordb-erd";',
          "",
          "export default defineConfig({",
          "  db: {",
          "    tailordb: {",
          '      files: ["./tailordb/*.ts"],',
          "    },",
          "  },",
          "});",
          "",
          "export const plugins = definePlugins(",
          '  tailordbErdPlugin({ sites: { tailordb: "my-erd-site" } }),',
          ");",
        ].join("\n"),
      },
    ],
    prompt: [
      "In Tailor SDK v2 the TailorDB `erdSite` setting is removed from the core config",
      "schema; the ERD deploy target is configured on the ERD CLI plugin instead. The",
      "codemod rewrites literal `db.<namespace>.erdSite` entries inside top-level",
      "defineConfig() calls into a `tailordbErdPlugin({ sites: { <namespace>: <value> } })`",
      "argument of definePlugins(), importing it from @tailor-platform/sdk-plugin-tailordb-erd.",
      "",
      "First, for every config that now registers tailordbErdPlugin, make sure",
      "@tailor-platform/sdk-plugin-tailordb-erd is installed as a dev dependency — the",
      "migrated config imports it, so config loading fails with ERR_MODULE_NOT_FOUND",
      "until it is installed.",
      "",
      "For any remaining `erdSite` config keys the codemod did not rewrite — a db config",
      "built dynamically or passed via a variable, quoted or computed keys, spread",
      "properties, a defineConfig() call inside a factory function, or a file that",
      "already registers tailordbErdPlugin — move the namespace → static-website-name",
      "mapping into tailordbErdPlugin({ sites }) and delete the `erdSite` key. For",
      "factory-built configs, keep any referenced parameters or locals in scope when",
      "moving the value to the module-level definePlugins() export. Each site name",
      "must match a static website defined in staticWebsites. Leave unrelated",
      "identifiers that merely contain the name (e.g. a defineStaticWebSite variable",
      "named erdSite) unchanged.",
    ].join("\n"),
  },
  {
    id: "v2/generate-watch-flag",
    name: "generate --watch flag removed",
    description:
      "Review and remove `tailor generate --watch` / `-W` invocations and the `watch` option on `GenerateOptions`. The flag, its dependency watcher, and the self-restart-on-change logic are removed; `generate` now always performs a single generation pass.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_6,
    filePatterns: [
      "**/package.json",
      "**/*.{sh,bash,zsh,yml,yaml}",
      "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
      "**/*.md",
    ],
    suspiciousPatterns: [
      /\bgenerate\b[^\n]*(?:--watch\b|\s-W\b)/,
      [/\bgenerate\s*\(/, /\bwatch\s*:/],
    ],
    examples: [
      {
        lang: "sh",
        caption: "The --watch/-W flag no longer exists; re-run generate after each change:",
        before: "tailor generate --watch",
        after: "tailor generate",
      },
    ],
    prompt: [
      "Tailor SDK v2 removes the `generate --watch` (`-W`) flag along with the",
      "dependency watcher and self-restart logic that powered it. `tailor generate`",
      "now always runs a single generation pass and exits.",
      "",
      "For each flagged `tailor generate ... --watch` / `-W` invocation (package.json",
      "scripts, shell scripts, CI configs, or docs), drop the flag and re-run",
      "`tailor generate` after each change instead. If automatic regeneration on file",
      "change is still needed, wrap the command with a general-purpose file watcher",
      "(e.g. `chokidar-cli`, `nodemon`) at the project level.",
      "",
      "For programmatic use of `generate()` from `@tailor-platform/sdk/cli`, remove the",
      "`watch` field from the `GenerateOptions` argument — the function now performs a",
      "single generation pass and resolves once it completes.",
    ].join("\n"),
  },
  {
    id: "v2/seed-exec-to-cli-plugin",
    name: "Generated seed exec.mjs → tailor seed CLI plugin",
    description:
      "`seedPlugin` no longer generates the `exec.mjs` seed runner. Seeding and validation move to the `tailor seed` commands provided by the `@tailor-platform/sdk-plugin-seed` CLI plugin: install it as a devDependency, replace `node <distPath>/exec.mjs` invocations with `tailor seed apply` and `node <distPath>/exec.mjs validate` with `tailor seed validate`, and delete the stale generated `<distPath>/exec.mjs` file. Seed data and schema generation (`data/*.jsonl`, `data/*.schema.ts`) is unchanged, and the `tailor seed apply` options mirror the old script (`--machine-user`, `--namespace`, `--skip-idp`, `--truncate`, `--yes`, type-name arguments), plus a new `--upsert` flag to update existing rows instead of failing on duplicate ids.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_9,
    scriptPath: "v2/seed-exec-to-cli-plugin/scripts/transform.js",
    filePatterns: [
      "**/package.json",
      "**/*.{sh,bash,zsh,yml,yaml}",
      "**/*.md",
      "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
    ],
    // The transform declines `fork()` call sites, which need the surrounding
    // async plumbing unwound; `reviewFindings` points at those exact lines.
    // Outside source files `exec.mjs` alone is a generic script name, so the
    // directory-qualified path keeps unrelated runners from being flagged.
    suspiciousPatterns: [/[\w./@~${}-]+\/exec\.mjs/],
    // Source strings keep the bare filename: a forked runner is often assembled
    // (`fork(path.join(distPath, "exec.mjs"))`), leaving no path to match, and
    // `reviewFindings` only reports quoted literal paths.
    sourceStringSuspiciousPatterns: ["exec.mjs"],
    examples: [
      {
        before: '"seed": "node ./seed/exec.mjs",\n"seed:validate": "node ./seed/exec.mjs validate"',
        after: '"seed": "tailor seed apply",\n"seed:validate": "tailor seed validate"',
        lang: "jsonc",
      },
    ],
    prompt: [
      "seedPlugin no longer generates the exec.mjs seed runner in v2. The tailor seed",
      "CLI plugin (@tailor-platform/sdk-plugin-seed) replaces it:",
      "",
      "- Install @tailor-platform/sdk-plugin-seed as a devDependency next to",
      "  @tailor-platform/sdk.",
      "- Replace `node <distPath>/exec.mjs [options] [types...]` invocations with",
      "  `tailor seed apply [options] [types...]` (same options: --machine-user/-m,",
      "  --namespace/-n, --skip-idp, --truncate, --yes, and type-name arguments,",
      "  plus a new --upsert flag to update existing rows instead of failing on",
      "  duplicate ids).",
      "- Replace `node <distPath>/exec.mjs validate [path]` with",
      "  `tailor seed validate [path]`.",
      '- Rewrite `fork("<distPath>/exec.mjs", ...)` call sites (test setup files',
      "  typically fork the runner and await a hand-rolled Promise around",
      '  `child.on("close", ...)`). The plugin is a CLI-dispatched binary rather',
      "  than a forkable JS module, so call it synchronously instead —",
      '  `execSync("npx tailor seed apply", { env, stdio: "inherit" })` — keeping',
      "  the original `env` and `stdio` forwarding, and unwind the surrounding",
      "  Promise wrapper (drop the now-unused `await`, and the `async` keyword when",
      "  nothing else in the function awaits). Note that `execSync` throws on a",
      "  nonzero exit, replacing the wrapper's explicit reject.",
      "- Delete the stale generated `<distPath>/exec.mjs` file; keep the data/",
      "  directory (JSONL data and generated schemas) as-is. Nothing removes it",
      "  automatically, and a leftover runner keeps working while no longer being",
      "  regenerated.",
    ].join("\n"),
  },
  {
    id: "v2/sdk-test-mocks-to-vitest",
    name: "@tailor-platform/sdk/test global mocks → @tailor-platform/sdk/vitest",
    description:
      "The global platform mocks exported from `@tailor-platform/sdk/test` (`setupTailordbMock`, `setupWorkflowMock`, `setupWaitPointMock`, `setupInvokerMock`, `setupTailorErrorsMock`) and the bundled-output helper `createImportMain` are removed in v2. Use the `tailor-runtime` environment from `@tailor-platform/sdk/vitest` together with `mockTailordb` / `mockWorkflow`: the environment injects `TailorErrors` for you, `setWaitHandler` / `setResolveHandler` replace the wait-point stubs, and the invoker is driven through `globalThis.tailor.context.getInvoker` (or passed directly to `.body()` when testing the TypeScript source). No codemod ships for this migration: it replaces per-test global stubs with a Vitest environment plus disposable mocks, which changes the Vitest config, the setup shape, and the assertions of every affected test. The other `@tailor-platform/sdk/test` exports (`createTailorDBHook`, `createStandardSchema`, `unauthenticatedTailorUser`) are unchanged.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_PENDING,
    suspiciousPatterns: [
      "setupTailordbMock",
      "setupWorkflowMock",
      "setupWaitPointMock",
      "setupInvokerMock",
      "setupTailorErrorsMock",
      "createImportMain",
    ],
    examples: [
      {
        caption: "Job mocks move from a global stub to a disposable mock:",
        before:
          'import { setupWorkflowMock } from "@tailor-platform/sdk/test";\n\nconst { startedJobs } = setupWorkflowMock(() => ({ ok: true }));',
        after:
          'import { mockWorkflow } from "@tailor-platform/sdk/vitest";\n\nusing wf = mockWorkflow();\nwf.setJobHandler(() => ({ ok: true }));\n// wf.startedJobs replaces the returned startedJobs array',
      },
    ],
    prompt: [
      "The global platform mocks from @tailor-platform/sdk/test are removed in v2.",
      "Migrate each affected test to the tailor-runtime Vitest environment:",
      "",
      "1. Add the environment for the test files that need platform globals — set",
      '   environment: "tailor-runtime" in the Vitest project config, or add the',
      "   // @vitest-environment tailor-runtime docblock to the file. The environment",
      "   ships in @tailor-platform/sdk/vitest and installs TailorErrors and the base",
      "   tailor/tailordb globals, so setupTailorErrorsMock has no replacement — delete it.",
      "2. Replace setupTailordbMock(resolver) with using db = mockTailordb() and",
      "   configure query results on that mock; read its recorded calls instead of the",
      "   returned executedQueries / createdClients arrays.",
      "3. Replace setupWorkflowMock(handler) with using wf = mockWorkflow() plus",
      "   wf.setJobHandler(handler) (or wf.enqueueResult(...) for order-based results),",
      "   and read wf.startedJobs.",
      "4. Replace setupWaitPointMock({ onWait, onResolve }) with the same mockWorkflow()",
      "   handle: wf.setWaitHandler / wf.setResolveHandler, asserting on wf.waitCalls /",
      "   wf.resolveCalls.",
      "5. Replace setupInvokerMock(invoker) with",
      '   vi.spyOn(globalThis.tailor.context, "getInvoker").mockReturnValue(raw) for a',
      "   bundled test, or pass invoker directly to .body() when unit-testing a",
      "   resolver/executor/workflow job against the TypeScript source.",
      "6. Drop createImportMain and the tests that import bundled output through it.",
      "   Bundling integrity is the SDK's responsibility: unit-test the TypeScript",
      "   source and cover deployed behavior with E2E tests instead.",
      "",
      "See the SDK testing guide for the full environment setup.",
    ].join("\n"),
  },
  {
    id: "v2/cli-typed-options",
    name: "Programmatic CLI name options → workflow/executor definitions",
    description:
      'The name-keyed option types exported from `@tailor-platform/sdk/cli` — `GetWorkflowOptions`, `StartWorkflowOptions`, `ListWorkflowExecutionsOptions`, `GetExecutorOptions`, `TriggerExecutorOptions`, `ListExecutorJobsOptions`, `GetExecutorJobOptions`, `WatchExecutorJobOptions` — are removed in v2, together with the function overloads that accepted them. Pass the workflow or executor definition itself instead: `{ workflow: myWorkflow, invoker: "admin" }` / `{ executor: myExecutor }`, matching the `*TypedOptions` shape that types `arg` and `payload` from the definition. No codemod ships for this migration: rewriting a name string into a definition requires importing the module that defines the workflow or executor, which a source-local transform cannot resolve.',
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_PENDING,
    suspiciousPatterns: [
      ["@tailor-platform/sdk/cli", "executorName"],
      ["@tailor-platform/sdk/cli", "workflowName"],
      ["@tailor-platform/sdk/cli", "GetWorkflowOptions"],
      ["@tailor-platform/sdk/cli", "StartWorkflowOptions"],
      ["@tailor-platform/sdk/cli", "ListWorkflowExecutionsOptions"],
      ["@tailor-platform/sdk/cli", "GetExecutorOptions"],
      ["@tailor-platform/sdk/cli", "TriggerExecutorOptions"],
      ["@tailor-platform/sdk/cli", "ListExecutorJobsOptions"],
      ["@tailor-platform/sdk/cli", "GetExecutorJobOptions"],
      ["@tailor-platform/sdk/cli", "WatchExecutorJobOptions"],
    ],
    examples: [
      {
        before:
          'import { startWorkflow } from "@tailor-platform/sdk/cli";\n\nconst { executionId } = await startWorkflow({ name: "user-sync", machineUser: "admin" });',
        after:
          'import { startWorkflow } from "@tailor-platform/sdk/cli";\nimport userSync from "./workflows/userSync";\n\nconst { executionId } = await startWorkflow({ workflow: userSync, invoker: "admin" });',
      },
      {
        caption: "Executor commands take the executor definition:",
        before: 'const result = await watchExecutorJob({ executorName: "daily-sync", jobId });',
        after: "const result = await watchExecutorJob({ executor: dailySync, jobId });",
      },
    ],
    prompt: [
      "The programmatic CLI functions in @tailor-platform/sdk/cli no longer accept a",
      "workflow or executor name; they take the definition object instead. For each",
      "flagged call site:",
      "",
      "1. Import the workflow or executor definition — the module whose default export",
      "   is createWorkflow(...) or whose export is createExecutor(...) with that name.",
      '2. Replace name: "my-workflow" with workflow: myWorkflow, and',
      '   executorName: "my-executor" with executor: myExecutor. For',
      "   listWorkflowExecutions, workflowName becomes workflow.",
      "3. startWorkflow's machine user moves from machineUser to the required",
      "   invoker, typed against the machine users declared in tailor.config.ts.",
      "4. Replace imported option types with the *TypedOptions equivalent",
      "   (e.g. GetWorkflowOptions → GetWorkflowTypedOptions<typeof myWorkflow>).",
      "   Note that arg (startWorkflow) and payload (triggerExecutor) are now typed",
      "   from the definition, so a mistyped argument becomes a type error.",
      "",
      "When the name is only known at runtime (read from argv or an environment",
      "variable), the CLI command itself — `tailor workflow start <name>` /",
      "`tailor executor trigger <name>` — remains the name-keyed entry point.",
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
  {
    id: "v2/remove-legacy-bundle-cleanup",
    name: "Legacy bundle artifact cleanup removed from deploy",
    description:
      "`tailor deploy` no longer deletes on-disk bundle artifacts (`.entry.js` files, workflow-job bundles, and the `hooks-validate-scripts/` directory) left in the SDK output directory (`.tailor` by default) by SDK versions that predate the current in-memory bundling approach. Current bundlers no longer write these files. No source change is required; if such stale files remain from a very old SDK version, delete only those specific files/directories manually — do not delete the output directory itself, since it also holds deploy state (e.g. `secrets-state/`, `*.context.json`) that existing secrets and Auth Connections depend on.",
    since: "1.0.0",
    until: "2.0.0",
    notice: true,
  },
  {
    id: "v2/dts-env-value-types",
    name: "tailor.d.ts Env uses value types instead of literal values",
    description:
      "The `Env` interface in `tailor.d.ts` is generated from the type of each `defineConfig({ env })` value (`string`, `number`, or `boolean`) instead of the value itself, so the generated file no longer carries whatever the config resolved to when it was generated. Keys that aren't valid TypeScript identifiers are quoted, which previously produced a file that failed to parse. Run `tailor generate` to refresh the file, then widen any code that depended on the old literal types. If a `tailor.d.ts` you already committed contains a sensitive value, treat that value as exposed and rotate it; keep secrets in Secret Manager rather than `env`.",
    since: "1.0.0",
    until: "2.0.0",
    prereleaseUntil: V2_NEXT_PENDING,
    examples: [
      {
        lang: "ts",
        caption: "An env value can no longer stand in for a literal union; narrow it explicitly:",
        before: 'const stage: "production" | "staging" = env.STAGE;',
        after: 'const stage = env.STAGE === "staging" ? "staging" : "production";',
      },
    ],
    prompt: [
      "Tailor SDK v2 generates the `Env` interface in `tailor.d.ts` from the type of",
      "each `defineConfig({ env })` value (`string`, `number`, `boolean`) instead of",
      "the resolved value, so `Env` properties no longer carry literal types.",
      "",
      "Run `tailor generate` first to refresh `tailor.d.ts`, then review the places",
      "that depended on the old literal types:",
      "",
      "- An env value assigned or passed where a literal union is required, e.g.",
      '  `const stage: "production" | "staging" = env.STAGE`. Narrow it with a',
      "  comparison or a validation helper instead of relying on the declared type.",
      "- A generic argument, conditional type, or template-literal type parameterized",
      "  by an env value.",
      "- `as const` / `satisfies` assertions that assumed one specific literal.",
      "",
      'Plain comparisons (`env.STAGE === "production"`) and arithmetic on numeric env',
      "values keep working and need no change. Do not restore the old behavior by",
      "editing `tailor.d.ts`: it is generated and will be overwritten, and embedding",
      "env values there is what leaked configured secrets into version control.",
    ].join("\n"),
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

function reachesCodemodBoundary(toVersion: string, codemod: CodemodPackage): boolean {
  if (gte(toVersion, codemod.until)) {
    return true;
  }
  if (
    codemod.prereleaseUntil === undefined ||
    codemod.prereleaseUntil === V2_NEXT_PENDING ||
    !gte(toVersion, codemod.prereleaseUntil)
  ) {
    return false;
  }

  const target = parse(toVersion)!;
  const boundary = parse(codemod.until)!;

  return (
    target.prerelease.length > 0 &&
    target.major === boundary.major &&
    target.minor === boundary.minor &&
    target.patch === boundary.patch
  );
}

/**
 * The version a codemod's migration is due by: its `prereleaseUntil` while that
 * names a concrete prerelease, and `until` otherwise.
 * @param codemod - The registered codemod
 * @returns The version its boundary sits at
 */
export function effectiveCodemodBoundary(codemod: CodemodPackage): string {
  if (codemod.prereleaseUntil === V2_NEXT_PENDING) {
    return codemod.until;
  }
  return codemod.prereleaseUntil ?? codemod.until;
}

function assertCodemodBoundaries(codemods: CodemodPackage[]): void {
  for (const codemod of codemods) {
    if (valid(codemod.since) === null) {
      throw new Error(
        `Codemod ${codemod.id} since must be a valid semver version: ${codemod.since}`,
      );
    }
    const boundary = parse(codemod.until);
    if (boundary === null) {
      throw new Error(
        `Codemod ${codemod.id} until must be a valid semver version: ${codemod.until}`,
      );
    }
    if (boundary.prerelease.length > 0) {
      throw new Error(`Codemod ${codemod.id} until must be a stable version: ${codemod.until}`);
    }
    if (codemod.prereleaseUntil === undefined || codemod.prereleaseUntil === V2_NEXT_PENDING) {
      assertNonEmptyRange(codemod);
      continue;
    }

    const prereleaseBoundary = parse(codemod.prereleaseUntil);
    if (prereleaseBoundary === null) {
      throw new Error(
        `Codemod ${codemod.id} prereleaseUntil must be a valid semver version: ${codemod.prereleaseUntil}`,
      );
    }
    if (prereleaseBoundary.prerelease.length === 0) {
      throw new Error(
        `Codemod ${codemod.id} prereleaseUntil must be a prerelease version: ${codemod.prereleaseUntil}`,
      );
    }
    if (
      prereleaseBoundary.major !== boundary.major ||
      prereleaseBoundary.minor !== boundary.minor ||
      prereleaseBoundary.patch !== boundary.patch
    ) {
      throw new Error(
        `Codemod ${codemod.id} prereleaseUntil must target the same version as until: ${codemod.prereleaseUntil}`,
      );
    }
    assertNonEmptyRange(codemod);
  }
}

/**
 * A codemod applies while `since <= from < boundary`, so a `since` at or past the
 * boundary leaves an empty range and the codemod can never apply. The boundary is
 * `prereleaseUntil` once that names a concrete prerelease, which is earlier than
 * `until` — comparing against `until` alone would let that case through.
 * @param codemod - The registered codemod, with its boundaries already validated
 */
function assertNonEmptyRange(codemod: CodemodPackage): void {
  const boundary = effectiveCodemodBoundary(codemod);
  if (!lt(codemod.since, boundary)) {
    throw new Error(
      `Codemod ${codemod.id} since must be older than the boundary it applies up to: ${codemod.since} >= ${boundary}`,
    );
  }
}

/**
 * Get codemod packages applicable for a version range.
 * A codemod applies when: since <= fromVersion < boundary <= toVersion.
 * A target prerelease reaches `until` only when the codemod declares `prereleaseUntil`.
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
  assertCodemodBoundaries(allCodemods);

  return allCodemods.filter(
    (codemod) =>
      gte(fromVersion, codemod.since) &&
      lt(fromVersion, effectiveCodemodBoundary(codemod)) &&
      reachesCodemodBoundary(toVersion, codemod),
  );
}
