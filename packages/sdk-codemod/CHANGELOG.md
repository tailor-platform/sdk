# @tailor-platform/sdk-codemod

## 0.8.7

### Patch Changes

- [#2243](https://github.com/tailor-platform/sdk/pull/2243) [`353ff98`](https://github.com/tailor-platform/sdk/commit/353ff98c3e8702ac21244ce92a4cd66795bd9ba8) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @ast-grep/napi to v0.45.3

## 0.8.6

### Patch Changes

- [#2229](https://github.com/tailor-platform/sdk/pull/2229) [`f13dbac`](https://github.com/tailor-platform/sdk/commit/f13dbacb0c13fddaed0fb7ea99e541237e8b1218) Thanks [@renovate](https://github.com/apps/renovate)! - Upgrade zod dependency to v4.5.4

## 0.8.5

### Patch Changes

- [#2225](https://github.com/tailor-platform/sdk/pull/2225) [`4a295de`](https://github.com/tailor-platform/sdk/commit/4a295dee514408339bf511129d01cffe3a42da2d) Thanks [@dqn](https://github.com/dqn)! - Keep package script migrations consistent across codemods.

## 0.8.4

### Patch Changes

- [#2190](https://github.com/tailor-platform/sdk/pull/2190) [`b358644`](https://github.com/tailor-platform/sdk/commit/b35864405973390a40b4ca202ce1d887689d6603) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency picomatch to v4.0.7

## 0.8.3

### Patch Changes

- [#2205](https://github.com/tailor-platform/sdk/pull/2205) [`1cff028`](https://github.com/tailor-platform/sdk/commit/1cff028c263be7b42e58e3dbc5278f444df802aa) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update @inquirer

## 0.8.2

### Patch Changes

- [#2186](https://github.com/tailor-platform/sdk/pull/2186) [`d39fa40`](https://github.com/tailor-platform/sdk/commit/d39fa40291f08e8f8d0b8a14aa3b1edfeb348efc) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @ast-grep/napi to v0.45.2

## 0.8.1

### Patch Changes

- [#2153](https://github.com/tailor-platform/sdk/pull/2153) [`07ac5d0`](https://github.com/tailor-platform/sdk/commit/07ac5d019a14143438bf1072fe2bf7a7e9f6980c) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @inquirer/prompts to v8.6.0

## 0.8.0

### Minor Changes

- [#2136](https://github.com/tailor-platform/sdk/pull/2136) [`6fba096`](https://github.com/tailor-platform/sdk/commit/6fba09676fc20e08e3325c26c0e72dc9ed4fd8f6) Thanks [@toiroakr](https://github.com/toiroakr)! - `.relation()`'s `toward.type` option is renamed to `toward.table`, since it names a target table rather than a TypeScript/GraphQL type — matching the `db.type()` → `db.table()` rename. The old spelling keeps working as a deprecated alias until v3; `tailor upgrade` offers the `v3/relation-toward-table` codemod to rewrite `toward: { type: ... }` to `toward: { table: ... }` across TypeScript/JavaScript sources. The relation's own `type` (its cardinality, e.g. `"n-1"`) is unchanged.

### Patch Changes

- [#2135](https://github.com/tailor-platform/sdk/pull/2135) [`5b7b676`](https://github.com/tailor-platform/sdk/commit/5b7b676740350dfe35ae479aa73da1f67c4d4f2f) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency politty to v0.11.9

## 0.7.0

### Minor Changes

- [#2088](https://github.com/tailor-platform/sdk/pull/2088) [`c9f91d9`](https://github.com/tailor-platform/sdk/commit/c9f91d944e4b041250979ec4438c36cabf818e14) Thanks [@dqn](https://github.com/dqn)! - The `--branch` option of `tailor setup branch` is renamed to `--target`, so it no longer collides with the subcommand name. The old spelling keeps working as a deprecated alias until v3 and prints a deprecation warning when used; `tailor upgrade` offers the `v3/setup-branch-flag-rename` codemod to rewrite `setup branch --branch` invocations across package.json scripts, shell and Windows scripts, YAML, Markdown, and JavaScript/TypeScript sources. The `--branch` option of `setup tag`, `setup preview`, and `setup coordinate` is unchanged.

### Patch Changes

- [#2137](https://github.com/tailor-platform/sdk/pull/2137) [`d38497a`](https://github.com/tailor-platform/sdk/commit/d38497ac214f547483028e2622d53dbf1414ecb2) Thanks [@dqn](https://github.com/dqn)! - Keep LLM review detection working in multi-major upgrades: each codemod's review detector and suspicious patterns now inspect the file as of that codemod's position in the transform chain, so a later codemod's rewrite can no longer silently hide an earlier codemod's review findings.

- [#2138](https://github.com/tailor-platform/sdk/pull/2138) [`870c8cd`](https://github.com/tailor-platform/sdk/commit/870c8cdaa007adcbb8f565fe9b4d238d98c00e6d) Thanks [@dqn](https://github.com/dqn)! - Stop exporting internal declarations that were only used within their own module.

- [#2089](https://github.com/tailor-platform/sdk/pull/2089) [`90948e6`](https://github.com/tailor-platform/sdk/commit/90948e6f6e1f3624a9c30595b3ff3a46ffbbced0) Thanks [@toiroakr](https://github.com/toiroakr)! - Add a targeted hint to the `Remote schema drift detected` error when every reported drift is a missing script hash — the pattern left by an environment last deployed with the pre-v2 CLI, which never wrote script hashes. The hint points at `migration sync <N>`, which is already listed as one of the general resolution options. The v2 migration guide (`docs/migration/v2.md`) now also documents that the first `tailor deploy` against such an environment needs a `migration sync` first.

## 0.6.0

### Minor Changes

- [#2075](https://github.com/tailor-platform/sdk/pull/2075) [`bd0e397`](https://github.com/tailor-platform/sdk/commit/bd0e39720015248e6ebb2c31efca49f9238b7060) Thanks [@dqn](https://github.com/dqn)! - `tailor function test-run` is renamed to `tailor function run`. The old name keeps working as a deprecated alias until v3 and prints a deprecation warning when used; `tailor upgrade` offers the `v3/function-test-run-rename` codemod to rewrite `function test-run` invocations across package.json scripts, shell and Windows scripts, YAML, Markdown, and JavaScript/TypeScript sources.

### Patch Changes

- [#2031](https://github.com/tailor-platform/sdk/pull/2031) [`ecc18ee`](https://github.com/tailor-platform/sdk/commit/ecc18eebc4e5c03c78e362a9b17bacc31bc88a31) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @ast-grep/napi to v0.45.1

- [#2065](https://github.com/tailor-platform/sdk/pull/2065) [`5a3a0e1`](https://github.com/tailor-platform/sdk/commit/5a3a0e1ce8bfadb769dc4540ef257e944f0c077e) Thanks [@toiroakr](https://github.com/toiroakr)! - Raise the minimum supported Node.js version to 22.18.0 (from 22.15.0).
  
  `tailor seed validate` crashed on Node 22.15.0–22.17.x with `Expected a string, an ArrayBuffer, or a TypedArray to be returned for the "source" from the "load" hook but got null`. This is a Node.js bug ([nodejs/node#58607](https://github.com/nodejs/node/issues/58607)): requiring a `node:`-scheme-only builtin (`node:sqlite`, used internally by the seed validator) while both a synchronous `resolve` and `load` hook are registered via `module.registerHooks()` crashes the loader on those versions. The SDK always registers both hooks, so any project on Node 22.15.0–22.17.x hit this. Node fixed it upstream in 22.18.0 ([nodejs/node#58612](https://github.com/nodejs/node/pull/58612)); this release raises `engines.node` to match, since Node 22.15.0–22.17.x never actually supported `tailor seed validate`.

## 0.5.0

### Minor Changes

- [#2023](https://github.com/tailor-platform/sdk/pull/2023) [`9dc826f`](https://github.com/tailor-platform/sdk/commit/9dc826fc0a83aa926de5b07245513f67c1ace877) Thanks [@dqn](https://github.com/dqn)! - Guide users through the v2 type-only import requirement. The CLI loads TypeScript by stripping types from each file in isolation, so a plain import of a type-only export fails at load time with `SyntaxError: ... does not provide an export named '<name>'` and no indication that the import form is the cause.
  
  - The CLI now appends a suggestion to that error: import the name with `import type` and set `"verbatimModuleSyntax": true` in tsconfig.json to catch violations at typecheck.
  - Projects scaffolded by `tailor init` now enable `verbatimModuleSyntax` in their tsconfig.json, so new projects catch violations at typecheck instead of at load time.
  - The v2 migration guide gains a `v2/type-only-imports` entry documenting the requirement, the failure mode, and the migration steps, offered by `tailor upgrade` when crossing the v2 boundary.

## 0.4.2

### Patch Changes

- [#1934](https://github.com/tailor-platform/sdk/pull/1934) [`2a3ec7b`](https://github.com/tailor-platform/sdk/commit/2a3ec7b108275410bf5b35d23784b07aa147c5ea) Thanks [@toiroakr](https://github.com/toiroakr)! - Drop the `chalk` dependency in favor of Node's built-in styling, and decide color support per output stream. Diagnostics on stderr now keep their colors when you redirect stdout (`tailor executor list > out.txt`), and stop writing escape codes into the file when you redirect stderr (`tailor deploy 2> log.txt`). `NO_COLOR`, `FORCE_COLOR` and non-TTY detection keep working as before.
  
  `@tailor-platform/sdk-codemod`, `@tailor-platform/sdk-plugin-seed` and `@tailor-platform/sdk-plugin-tailordb-erd` now declare the Node and Bun versions they need (`node >=22.15.0`, `bun >=1.2.0`), matching `@tailor-platform/sdk`. Installing them on an older runtime reports the mismatch instead of failing once the CLI runs.

- [#2008](https://github.com/tailor-platform/sdk/pull/2008) [`f2135ab`](https://github.com/tailor-platform/sdk/commit/f2135ab6dd3d130d88803b9829a26024de930ed3) Thanks [@toiroakr](https://github.com/toiroakr)! - Consistently call a TailorDB schema definition a "table" instead of a "type" across the docs, matching the `db.type()` → `db.table()` rename. Also fix three leftover `db.type(...)` code samples in `docs/services/tailordb.md` that should have read `db.table(...)`.
  
  Update the `v2/idp-publish-events-rename` codemod registry description to say "tables" instead of "types", matching the same wording fix.

## 0.4.1

### Patch Changes

- [#1957](https://github.com/tailor-platform/sdk/pull/1957) [`a465547`](https://github.com/tailor-platform/sdk/commit/a465547df712ca8c607c1e42cf12c15fe3e830d1) Thanks [@toiroakr](https://github.com/toiroakr)! - Invoke the CLI as `npx @tailor-platform/sdk <command>` wherever an invocation is written for you. `npx` resolves a command it cannot find locally as a package name, so `npx tailor` fell through to an unrelated `tailor` package on npm whenever the SDK was not installed in the project — including in CI, where npm installs without prompting. Omitting the version specifier keeps using the project's installed SDK when there is one.
  
  - Setup examples in the README, the quickstart, and the scaffolded project READMEs now use the package-runner form. Bun examples use `bun tailor <command>`, which resolves the local binary without fetching from the registry.
  - Workflows generated by `tailor setup` use `npx @tailor-platform/sdk` for npm projects and `bun run tailor` for Bun projects. `tailor setup check` reports the template as outdated so existing projects regenerate; re-run `tailor setup` to pick it up.
  - The `v2/seed-exec-to-cli-plugin` and `v2/sdk-skills-shim` codemods write the package-runner form when the invocation they produce goes through a runner that installs from the registry (`npx`, `bunx`, `pnpm`/`yarn dlx`, `npm exec`). A runner that resolves project binaries, such as `pnpm exec`, still gets the bare `tailor` binary.

## 0.4.0

### Minor Changes

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`23904bc`](https://github.com/tailor-platform/sdk/commit/23904bcb1807f96ecd3026e72d9b4de44eb8705f) Thanks [@toiroakr](https://github.com/toiroakr)! - Add the `v2/principal-unify` codemod so `tailor-sdk upgrade` can migrate SDK principal APIs to `TailorPrincipal`.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`20aa5a9`](https://github.com/tailor-platform/sdk/commit/20aa5a95167d370b4b3cc7352cb60a22a695d673) Thanks [@toiroakr](https://github.com/toiroakr)! - Remove the APIs that were marked `@deprecated` on the way to v2, so 2.0.0 ships without deprecated aliases. Each removal has migration coverage in `tailor upgrade`:
  
  - `@tailor-platform/sdk/cli` no longer re-exports `kyselyTypePlugin`, `enumConstantsPlugin`, `fileUtilsPlugin`, and `seedPlugin`. Import them from `@tailor-platform/sdk/plugin/kysely-type`, `/plugin/enum-constants`, `/plugin/file-utils`, and `/plugin/seed` (codemod `v2/plugin-cli-import`).
  - `tailor.workflow.startJobFunction` and the `StartJobFunctionOptions` type are removed; use the canonical `execJobFunction` / `ExecJobFunctionOptions` (new codemod `v2/exec-job-function-rename`). `mockWorkflow()` no longer exposes the `startJobFunction` alias — assert on its `execJobFunction` mock instead — and `v2/workflow-trigger-rename` now rewrites `triggerJobFunction` straight to `execJobFunction`.
  - `@tailor-platform/sdk/test` no longer exports the platform-global mocks `setupTailordbMock`, `setupWorkflowMock`, `setupWaitPointMock`, `setupInvokerMock`, and `setupTailorErrorsMock`, nor the bundled-output helper `createImportMain`. Use the `tailor-runtime` environment from `@tailor-platform/sdk/vitest` with `mockTailordb` / `mockWorkflow` (migration guidance: `v2/sdk-test-mocks-to-vitest`). `createTailorDBHook`, `createStandardSchema`, and `unauthenticatedTailorUser` are unchanged.
  - The programmatic CLI functions no longer accept name-keyed options: `GetWorkflowOptions`, `StartWorkflowOptions`, `ListWorkflowExecutionsOptions`, `GetExecutorOptions`, `TriggerExecutorOptions`, `ListExecutorJobsOptions`, `GetExecutorJobOptions`, and `WatchExecutorJobOptions` are removed along with the overloads that took them. Pass the definition itself — `startWorkflow({ workflow: myWorkflow, invoker: "admin" })`, `watchExecutorJob({ executor: myExecutor, jobId })` — which also types `arg` and `payload` from the definition (migration guidance: `v2/cli-typed-options`). The name-keyed entry points remain available as CLI commands (`tailor workflow start <name>`, `tailor executor trigger <name>`).

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`b3ff0b4`](https://github.com/tailor-platform/sdk/commit/b3ff0b43bfbfc69eea797541292eff840e1d8f87) Thanks [@toiroakr](https://github.com/toiroakr)! - The `v2/seed-exec-to-cli-plugin` migration now rewrites generated seed runner invocations automatically. `node <distPath>/exec.mjs [options] [types...]` becomes `tailor seed apply [options] [types...]` and `node <distPath>/exec.mjs validate` becomes `tailor seed validate`, in package.json scripts, shell scripts, CI configs, docs, and TypeScript sources, carrying node's `--env-file` / `--env-file-if-exists` over to the CLI flag form in both the `=` and space-separated spellings. Each invocation must sit on one line, so a command split across YAML sequence items or markdown bullets is reported for review rather than rewritten. Files that `fork()` the runner are left untouched and reported with their exact line, because replacing the forked child with a CLI call also unwinds the surrounding `await`/Promise plumbing; the migration prompt now covers that rewrite and the stale `exec.mjs` deletion.

### Patch Changes

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`0379fe8`](https://github.com/tailor-platform/sdk/commit/0379fe8c2e7acb927d94f56204b39cf58fa4ac2a) Thanks [@toiroakr](https://github.com/toiroakr)! - Rewrite `tailor-sdk apply` to `tailor-sdk deploy` in source files that contain embedded CLI command strings.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`6519a54`](https://github.com/tailor-platform/sdk/commit/6519a5434f0cc664a609ef2cae2398b19cad4673) Thanks [@toiroakr](https://github.com/toiroakr)! - Rename auth attribute module augmentation from `AttributeMap` to `Attributes`.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`5e35c59`](https://github.com/tailor-platform/sdk/commit/5e35c59032156eadeb45ac4c1b1453ecad79163c) Thanks [@toiroakr](https://github.com/toiroakr)! - Add LLM-assisted review support to the codemod runner. A codemod can declare `suspiciousPatterns` plus a `prompt`; after running, files whose post-transform content still matches a suspicious pattern are reported as `llmReviews` (in the JSON output and on stderr) together with the codemod's migration prompt. This surfaces the cases a deterministic transform cannot safely complete (e.g. a value reached through a variable) so they can be finished with an LLM. The `auth.invoker(...)` codemod adopts this for its non-literal-argument cases.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`8b918f6`](https://github.com/tailor-platform/sdk/commit/8b918f68867240b5713c5f8340836971d1c30882) Thanks [@toiroakr](https://github.com/toiroakr)! - Generate the v2 migration guide (`packages/sdk/docs/migration/v2.md`) from the codemod registry, which is the single source of truth. Each entry renders its name, automation level (Automatic / Partially automatic / Manual), description, optional before/after `examples`, and — for changes the codemods cannot fully migrate on their own — the LLM/manual migration prompt. Run `pnpm codemod:docs:update` to regenerate and `pnpm codemod:docs:check` (wired into `pnpm check`) to verify it is in sync.
  
  `scriptPath` is now optional, so the registry can also describe codemod-less ("manual") migrations that ship only guidance (`examples` / `prompt` / `suspiciousPatterns`) with no automatic transform. A manual entry with a `prompt` but no scoping pattern is surfaced as a project-wide `llmReviews` entry at runtime.
  
  Add a `sdk-codemod list` command that prints every registered rule (id, name, kind, version range).

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`bfb9451`](https://github.com/tailor-platform/sdk/commit/bfb945122720cec94be23484e23d7ce7607257d8) Thanks [@toiroakr](https://github.com/toiroakr)! - Reduce false-positive v2 codemod warnings and LLM-review prompts from source comments, string literals, and identifier substring matches.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`752ca9d`](https://github.com/tailor-platform/sdk/commit/752ca9dea12c7ba56ac1ed8091efc3fb6e7812be) Thanks [@toiroakr](https://github.com/toiroakr)! - Report the codemod runner identity in the JSON summary, including the source checkout commit and local build command when run from a branch build, so prerelease migration validation can distinguish exact npm packages from branch-head behavior.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`1a055c9`](https://github.com/tailor-platform/sdk/commit/1a055c9909ac951f807fc2249c9abc1d5805398f) Thanks [@toiroakr](https://github.com/toiroakr)! - Rename the TailorDB schema builder from `db.type()` to `db.table()`.
  
  Update TailorDB definitions:
  
  ```diff
   import { db } from "@tailor-platform/sdk";
  
  -export const user = db.type("User", {
  +export const user = db.table("User", {
     name: db.string(),
   });
  ```

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`982dee1`](https://github.com/tailor-platform/sdk/commit/982dee1bb73d8ca1faf35f7d256eba0c5ed86957) Thanks [@toiroakr](https://github.com/toiroakr)! - Make the deprecation process mechanical: an `@deprecated` tag in the SDK now states the version it shipped in and the codemod that migrates callers off it (`@deprecated since 2.1.0 — use {@link newApi} instead. codemod: v2/old-to-new`), and `pnpm check:deprecations` fails when a tag misses either half, names a codemod that is not registered, or outlives its codemod's boundary — so the release PR that bumps to a major turns red while an API due for removal is still declared, instead of the alias shipping and being noticed releases later. While the shipping version is still undecided the tag carries the literal `NEXT_RELEASE`, which the release workflow rewrites to the version the release PR bumps to — the same step that already resolves `prereleaseUntil: V2_NEXT_PENDING` codemod boundaries.
  
  Registered codemods are validated more strictly too: a `since` that is not valid semver, or that is not older than `until`, now fails fast instead of surfacing as a semver error partway through `tailor upgrade` or as a codemod whose empty version range silently matches nothing.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`039389d`](https://github.com/tailor-platform/sdk/commit/039389d17ddf3014fc53ffdb756ec6ea1425826c) Thanks [@toiroakr](https://github.com/toiroakr)! - Generate the `Env` interface in `tailor.d.ts` from the type of each `defineConfig({ env })` value instead of the value itself. The resolved value used to be written in as a literal type, so running `generate` or `deploy` with real environment variables loaded stamped those values into a file that is normally committed.
  
  ```diff
   interface Env {
  -  API_BASE: "https://api.example.com";
  -  RETRIES: 3;
  -  VERBOSE: true;
  +  API_BASE: string;
  +  RETRIES: number;
  +  VERBOSE: boolean;
   }
  ```
  
  `env` keys that aren't valid TypeScript identifiers (for example `"API-BASE"`) are now quoted as well; previously they were emitted bare and produced a `tailor.d.ts` that failed to parse.
  
  Run `tailor generate` after upgrading to refresh the file. Code that relied on the literal narrowing — comparing `env.STAGE` against a literal union, for example — has to widen its own types or read the value through a local narrowing check. If a `tailor.d.ts` you already committed contains a sensitive value, treat that value as exposed and rotate it; keep secrets in [Secret Manager](https://github.com/tailor-platform/sdk/blob/main/packages/sdk/docs/services/secret.md) rather than `env`.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`a6038e2`](https://github.com/tailor-platform/sdk/commit/a6038e25151bf32694cc2d20fd3845b1ed959ccc) Thanks [@toiroakr](https://github.com/toiroakr)! - Move the TailorDB `erdSite` setting out of the core config schema into the ERD plugin's own configuration. `db.<namespace>.erdSite` is no longer accepted in `tailor.config.ts`; configure the ERD deploy target on the plugin instead:
  
  ```ts
  import { definePlugins } from "@tailor-platform/sdk";
  import { tailordbErdPlugin } from "@tailor-platform/sdk-plugin-tailordb-erd";
  
  export const plugins = definePlugins(
    // TailorDB namespace name → static website name
    tailordbErdPlugin({ sites: { tailordb: "my-erd-site" } }),
  );
  ```
  
  The `tailor tailordb erd` commands resolve deploy targets from `tailordbErdPlugin({ sites })` and now validate each namespace against `config.db` and each site name against `staticWebsites`, so typos surface when the config is loaded instead of at deploy time. The `v2/erd-site-to-plugin` codemod migrates existing configs automatically. For programmatic users, `loadTailorDBNamespaces()` additionally returns the config module's registered `plugins`, and namespace selector callbacks receive them as a second argument.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`4022203`](https://github.com/tailor-platform/sdk/commit/40222035a5de08e1d0d3e7b8d96047fdbd2b2d19) Thanks [@toiroakr](https://github.com/toiroakr)! - `executeScript` now takes its `arg` as a JSON-serializable value instead of a pre-serialized JSON string. Pass the value directly (e.g. `arg: { a: 1 }`) instead of `arg: JSON.stringify({ a: 1 })`.
  
  Add the `v2/execute-script-arg` codemod, which unwraps `JSON.stringify(...)` passed as the `executeScript` `arg` option. Indirect forms (a stringified value held in a variable, etc.) cannot be rewritten automatically and are surfaced as an LLM-assisted review task with a migration prompt.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`078418a`](https://github.com/tailor-platform/sdk/commit/078418afde150fc971aa7fec7eb87ffff014e134) Thanks [@toiroakr](https://github.com/toiroakr)! - Reduce noisy `executeScript` LLM-review prompts by flagging files only when unresolved `arg` stringification remains likely.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`54f4d08`](https://github.com/tailor-platform/sdk/commit/54f4d085e077913ae3a923bcb520362b9e57d876) Thanks [@toiroakr](https://github.com/toiroakr)! - `seedPlugin` no longer generates the `exec.mjs` seed runner. Seeding and validation move to the `tailor seed` commands provided by the `@tailor-platform/sdk-plugin-seed` CLI plugin: install it with `npm install -D @tailor-platform/sdk-plugin-seed`, replace `node <distPath>/exec.mjs` with `tailor seed apply` and `node <distPath>/exec.mjs validate` with `tailor seed validate`, and delete the stale generated `exec.mjs`. Seed data and schema generation (`data/*.jsonl`, `data/*.schema.ts`) is unchanged. Because the plugin reads the config at run time, `machineUserName` changes in seedPlugin options now take effect without regenerating. `@tailor-platform/sdk/cli` gains `loadSeedContext` (and `SeedContext` types) for this, `SeedData` is now JSON-typed, and `executeScript` accepts a plain object `invoker` (`ScriptInvoker`).

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`c8778f2`](https://github.com/tailor-platform/sdk/commit/c8778f22b4306705b085602b7c221f4166c31447) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix `tailor upgrade` reporting zero codemods across several v2 prerelease boundaries. `v2/db-type-to-table` and `v2/runtime-subpath-namespace` now trigger at `2.0.0-next.4` (where they actually shipped) instead of `2.0.0-next.3`, and `v2/forward-relation-name`, `v2/tailordb-validate-simplify`, and `v2/tailordb-hook-redesign` now trigger at `2.0.0-next.5` instead of `2.0.0-next.4`.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`e79dc3f`](https://github.com/tailor-platform/sdk/commit/e79dc3fd6862f7f00df08ef8f2b8721f562afa8c) Thanks [@toiroakr](https://github.com/toiroakr)! - Apply the v2 `rename-bin` codemod to SDK CLI command strings in TypeScript and JavaScript source files.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`d69add3`](https://github.com/tailor-platform/sdk/commit/d69add3f24e944dd7153eef9da6e0c36a5e4a989) Thanks [@toiroakr](https://github.com/toiroakr)! - Run v2 codemods when the target version is a v2 prerelease.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`b6340d0`](https://github.com/tailor-platform/sdk/commit/b6340d086822fbf5bd6fffa16a7dba47ccc3a59a) Thanks [@toiroakr](https://github.com/toiroakr)! - Derive default TailorDB forward relation names from the relation field name by removing a trailing `ID`, `Id`, or `id`, instead of deriving them from the target table name.
  
  The v2 migration review identifies non-self relations without `toward.as`. Add an explicit name to preserve the v1 GraphQL field name, or update consumers to use the new field-based name.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`8cb5bcd`](https://github.com/tailor-platform/sdk/commit/8cb5bcdfe4d2494790b2b9ad72c7e1c43715f9e8) Thanks [@toiroakr](https://github.com/toiroakr)! - Flag `tailor generate --watch` / `-W` invocations and programmatic `generate({ watch })` usage for manual review as part of the v2 migration (the flag and its dependency watcher are removed in `@tailor-platform/sdk` v2).

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`d1405c0`](https://github.com/tailor-platform/sdk/commit/d1405c0b0dbd6205c1817c79b239fe980906c19b) Thanks [@toiroakr](https://github.com/toiroakr)! - Rename the `defineIdp` option `publishUserEvents` to `publishEvents`, so all four services that publish events use one field name. A codemod rewrites the option key on `defineIdp` calls, including aliased and namespace imports, and rewrites a shorthand `{ publishUserEvents }` to `{ publishEvents: publishUserEvents }` so it keeps reading the same local. Occurrences it cannot rewrite — an options object built outside the call, a computed key, or a type declaration of the option — are reported for manual migration.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`cd48fda`](https://github.com/tailor-platform/sdk/commit/cd48fdab46746aa2e8f5d8dd43073e3b4832c07c) Thanks [@toiroakr](https://github.com/toiroakr)! - Rename resolver, executor, workflow trigger, and typed workflow start machine-user options from `authInvoker` to `invoker`.
  
  Update create-sdk templates and the v2 auth invoker codemod to generate the new `invoker` option.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`28c0dde`](https://github.com/tailor-platform/sdk/commit/28c0dde9a33e4db39b04b083e22feb837e3605a7) Thanks [@toiroakr](https://github.com/toiroakr)! - Limit the `openDownloadStream` migration review prompt to files that reference deprecated download stream APIs.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`6374ec6`](https://github.com/tailor-platform/sdk/commit/6374ec64f3602c35ed2b2e45ba2260591327fafb) Thanks [@toiroakr](https://github.com/toiroakr)! - Replace `tailor skills install` with project-local `tailor skills add`, `list`, `remove`, and `sync` commands for bundled Tailor SDK agent skills.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`d9d9c49`](https://github.com/tailor-platform/sdk/commit/d9d9c49ab4c98034c64b0e5c6ba9cf106341a6c3) Thanks [@toiroakr](https://github.com/toiroakr)! - Flag files that need project-specific review after the v2 principal migration, including resolver helper adapters and nullable `caller` follow-ups.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`244fe8d`](https://github.com/tailor-platform/sdk/commit/244fe8d703b35f4aceaf31f918f94fc84e3be789) Thanks [@toiroakr](https://github.com/toiroakr)! - Report precise file-local findings for `principal-unify` review follow-ups, including nullable caller call sites and `context.user` helper adapters.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`5059c27`](https://github.com/tailor-platform/sdk/commit/5059c273d3f14c92239a17d3a7eeb44e0822ed99) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix `v2/principal-unify` review findings for nested SDK field parser invoker values and destructured context helper messages.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`7240c25`](https://github.com/tailor-platform/sdk/commit/7240c252546dc69989755a6f5af26c6062c36883) Thanks [@toiroakr](https://github.com/toiroakr)! - Remove the deprecated `auth.getConnectionToken()` helper from values returned by `defineAuth()`. Use `authconnection.getConnectionToken(...)` from `@tailor-platform/sdk/runtime` in resolvers, executors, and workflows instead. The v2 codemod rewrites direct `auth.getConnectionToken(...)` calls when the `auth` binding is imported from `tailor.config`.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`304a24a`](https://github.com/tailor-platform/sdk/commit/304a24af51cc130268a7f8145a10dc6b165f8d46) Thanks [@toiroakr](https://github.com/toiroakr)! - Remove the v1 runtime globals compatibility layer. Importing from `@tailor-platform/sdk` no longer activates the ambient `tailor.*` / `tailordb.*` declarations; opt into globals with `@tailor-platform/sdk/runtime/globals` or use the typed wrappers from `@tailor-platform/sdk/runtime`.
  
  The capital-cased `Tailordb.*` namespace is removed. If your project still references `Tailordb.QueryResult`, `Tailordb.CommandType`, `Tailordb.Client`, or `typeof Tailordb.Client`, migrate before upgrading: run `pnpm dlx @tailor-platform/sdk-codemod v2/tailordb-namespace` to rewrite them to lowercase `tailordb.*`, then add `import "@tailor-platform/sdk/runtime/globals"` so the rewritten references resolve.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`88db10e`](https://github.com/tailor-platform/sdk/commit/88db10ef57fa575731e1ed557ea74b86edcf5c5c) Thanks [@toiroakr](https://github.com/toiroakr)! - Remove deprecated CLI aliases for the v2 command surface. Use `tailor-sdk deploy` instead of `tailor-sdk apply`, `tailor-sdk crashreport` instead of `tailor-sdk crash-report`, and the hyphenated `--machine-user` option instead of the hidden `--machineuser` alias.
  
  Fix the v2 CLI rename codemod to migrate the hidden `--machineuser` option to `--machine-user`.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`160b406`](https://github.com/tailor-platform/sdk/commit/160b4061ee38675df85dd74af23b7041fe8e4944) Thanks [@toiroakr](https://github.com/toiroakr)! - Rename the CLI binary from `tailor-sdk` to `tailor`.
  
  The output directory default changes from `.tailor-sdk` to `.tailor`, and the GitHub Actions lock file path changes from `.github/tailor-sdk.lock` to `.github/tailor.lock`.
  
  Run the `v2/rename-bin` codemod to migrate `tailor-sdk` invocations in package.json scripts, shell scripts, CI workflows, and documentation:
  
  ```sh
  npx @tailor-platform/sdk-codemod --from 1.x --to 2.0.0
  ```

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`8b03f82`](https://github.com/tailor-platform/sdk/commit/8b03f827642e64f3b3af5a05ecdef405028a803a) Thanks [@toiroakr](https://github.com/toiroakr)! - Standardize SDK-owned environment variables on the `TAILOR_*` namespace.
  
  Replace the removed SDK-specific environment variables with their new names: `TAILOR_CONFIG_PATH`, `TAILOR_DTS_PATH`, `TAILOR_CI_ALLOW_ID_INJECTION`, `TAILOR_DEPLOY_BUILD_ONLY`, `TAILOR_BUILD_OUTPUT_DIR`, `TAILOR_SKILLS_SOURCE`, `TAILOR_TEMPLATE_SDK_VERSION`, `TAILOR_PLATFORM_URL`, `TAILOR_PLATFORM_OAUTH2_CLIENT_ID`, `TAILOR_INLINE_SOURCEMAP`, `TAILOR_QUERY_NEWLINE_ON_ENTER`, and `TAILOR_APP_LOG_LEVEL`. The deprecated `TAILOR_TOKEN` fallback is removed; use `TAILOR_PLATFORM_TOKEN`. The v2 codemod rewrites unambiguous removed SDK environment variable names and flags generic names such as `LOG_LEVEL` and `PLATFORM_URL` for manual review.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`1a8945d`](https://github.com/tailor-platform/sdk/commit/1a8945d183b990aaf1dfb1dd9ca9813a7277a118) Thanks [@toiroakr](https://github.com/toiroakr)! - Add a `V2_NEXT_PENDING` placeholder `prereleaseUntil` for codemods whose exact `2.0.0-next.N` release boundary isn't known yet at implementation time, plus a `pnpm codemod:resolve-pending` step (wired into the release workflow) that resolves it to the real version constant once the release PR bumps `@tailor-platform/sdk`'s version. Prevents codemod boundaries from drifting out of sync with the version they actually ship in, which previously required a manual follow-up fix after each release.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`3dcd82d`](https://github.com/tailor-platform/sdk/commit/3dcd82d54d6c059df90f2dc4788a7059fe4004ab) Thanks [@toiroakr](https://github.com/toiroakr)! - Restore Tailor field outputs for UUID, date, datetime, time, and decimal fields to plain string-compatible types and remove the strict scalar string migration guidance.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`fe1721e`](https://github.com/tailor-platform/sdk/commit/fe1721efa04f15d3d1ac3287c30c4c550220403e) Thanks [@toiroakr](https://github.com/toiroakr)! - Flag JavaScript files and embedded code strings that still reference ambient Tailor runtime globals during v2 migration review.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`5fc3a1d`](https://github.com/tailor-platform/sdk/commit/5fc3a1d027767d60e8a427adf1ff7e5f43dab331) Thanks [@toiroakr](https://github.com/toiroakr)! - Flag files that still reference ambient Tailor runtime globals so the v2 migration can opt them into `@tailor-platform/sdk/runtime/globals`.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`df3a772`](https://github.com/tailor-platform/sdk/commit/df3a77257823e9e8e7b7c89e418b3113964e9b20) Thanks [@toiroakr](https://github.com/toiroakr)! - Automatically migrate simple direct `tailor.idp.Client` runtime global usage to the typed `idp.Client` wrapper during v2 upgrades.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`04ca361`](https://github.com/tailor-platform/sdk/commit/04ca3619c4d2d88afe8ee3b25d4ba47ac799de51) Thanks [@toiroakr](https://github.com/toiroakr)! - Remove flat value and default exports from `@tailor-platform/sdk/runtime/*` subpath modules. Import each subpath through its self-named namespace export instead, for example `import { iconv } from "@tailor-platform/sdk/runtime/iconv"`.
  
  The aggregate `@tailor-platform/sdk/runtime` entry remains named-only, and its deprecated `file.deleteFile` alias is removed in favor of `file.delete`. The v2 codemod rewrites straightforward namespace-star subpath imports, flat named value imports, and aggregate `file.deleteFile` calls to the new namespace-object style.
  
  `TailorContextAPI` and `TailorWorkflowAPI` now describe the SDK wrapper objects. Code that types the platform-provided `globalThis.tailor.context` or `globalThis.tailor.workflow` objects directly must use `PlatformContextAPI` or `PlatformWorkflowAPI` instead.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`c051dab`](https://github.com/tailor-platform/sdk/commit/c051dab12c233de65313c4fcee96a26c604ec5da) Thanks [@toiroakr](https://github.com/toiroakr)! - Mention the `--upsert` flag in the `v2/seed-exec-to-cli-plugin` migration guide's `tailor seed apply` option list.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`eba2728`](https://github.com/tailor-platform/sdk/commit/eba2728a7b473da7caa134cbfdfc53a714d9d328) Thanks [@toiroakr](https://github.com/toiroakr)! - Keep v2 codemods from reusing type-only runtime helper imports when adding runtime value imports.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`add2079`](https://github.com/tailor-platform/sdk/commit/add2079f4c89bcb950c0c7f55312880993b3dc7b) Thanks [@toiroakr](https://github.com/toiroakr)! - Add the `v2/tailor-output-ignore-dir` codemod so SDK upgrades rewrite exact `.tailor-sdk/` ignore-file entries to `.tailor/` while leaving other `.tailor-sdk` paths unchanged.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`b5a0d70`](https://github.com/tailor-platform/sdk/commit/b5a0d70f8e29d58f77809ef2514be9065e0a954f) Thanks [@toiroakr](https://github.com/toiroakr)! - Unify function principal context around `TailorPrincipal`.
  
  Resolver contexts now use `caller` and `invoker` as `TailorPrincipal | null`, workflow and executor invokers also use `TailorPrincipal | null`, and event executor `actor` uses `TailorPrincipal | null` with `id`/`type` fields. The legacy `TailorUser`, `TailorInvoker`, `TailorActor`, `TailorActorType`, and `unauthenticatedTailorUser` exports are removed.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`f1ec5b5`](https://github.com/tailor-platform/sdk/commit/f1ec5b5fbedce73d217830e2c6ac4a243b830a2d) Thanks [@toiroakr](https://github.com/toiroakr)! - Redesign TailorDB hooks and validators with several breaking changes:
  
  - Add shared `now` timestamp to all hooks — multiple fields stamped with the same `Date`
  - Field-level hooks: `{ value, data, invoker }` → create `{ input, invoker, now }` / update `{ input, oldValue, invoker, now }` (`data` removed, `oldValue` added for update only)
  - Type-level hooks: per-field mapping (`Hooks<F>`) → single `{ create, update }` object (`TypeHook<F>`) returning partial field overrides
  - Type-level create hooks no longer receive `oldRecord`; update hooks receive non-nullable `oldRecord`
  - Field-level validators: return type changed from `boolean` to `string | void` (return error message or void to pass); `[fn, message]` tuple form removed
  - Type-level validators: `Validators<F>` per-field record → `TypeValidateFn<F>` single function with `issues(field, message)` callback
  - Add `.default(value)` on fields to set a create-time default (makes required fields optional in create input)
  - Remove exported types: `Hooks<F>`, `Validators<F>`, `ValidateConfig`

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`bf11bf8`](https://github.com/tailor-platform/sdk/commit/bf11bf8d3bad6195c86ed289c764490dc6d680ee) Thanks [@toiroakr](https://github.com/toiroakr)! - Update politty to v0.11.3

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`eeb235d`](https://github.com/tailor-platform/sdk/commit/eeb235debe910c05f755f036486878e7c763cb7e) Thanks [@toiroakr](https://github.com/toiroakr)! - Rename `defineWaitPoint` and `defineWaitPoints` to `createWaitPoint` and `createWaitPoints`.
  
  These functions create runtime instances with `.wait()` and `.resolve()` methods that call the platform API at runtime, so the `create*` prefix is more accurate. Update any usages:
  
  ```diff
  -import { defineWaitPoint, defineWaitPoints } from "@tailor-platform/sdk";
  +import { createWaitPoint, createWaitPoints } from "@tailor-platform/sdk";
  
  -export const approval = defineWaitPoint<Payload, Result>("approval");
  +export const approval = createWaitPoint<Payload, Result>("approval");
  
  -export const waitPoints = defineWaitPoints((define) => ({ ... }));
  +export const waitPoints = createWaitPoints((define) => ({ ... }));
  ```

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`93b68ac`](https://github.com/tailor-platform/sdk/commit/93b68ace83dcb0af2a8b0afa8aa3336cb18c818b) Thanks [@toiroakr](https://github.com/toiroakr)! - Rename `Workflow.trigger()` (returned by `createWorkflow()`) and `WorkflowJob.trigger()` (returned by `createWorkflowJob()`) to `.start()`, aligning the SDK's ergonomic verb with the platform's `start*` RPC vocabulary:
  
  ```diff
   const inventory = checkInventory.trigger({ orderId: input.orderId });
  +const inventory = checkInventory.start({ orderId: input.orderId });
  
  -const workflowRunId = await orderProcessingWorkflow.trigger(args, { invoker: "manager" });
  +const workflowRunId = await orderProcessingWorkflow.start(args, { invoker: "manager" });
  ```
  
  `mockWorkflow()`'s `wf.job(definition)` / `wf.workflow(definition)` now return a mock of the `.start` method, and `wf.setTriggerHandler` / `wf.triggeredJobs` are renamed to `wf.setStartHandler` / `wf.startedJobs`. No codemod ships for the `.trigger()` → `.start()` call-site rename itself — see the `v2/workflow-start-rename` migration guide entry for manual migration steps.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`93b68ac`](https://github.com/tailor-platform/sdk/commit/93b68ace83dcb0af2a8b0afa8aa3336cb18c818b) Thanks [@toiroakr](https://github.com/toiroakr)! - Remove the pre-alignment `tailor.workflow` names `triggerWorkflow`, `triggerJobFunction`, and `resumeWorkflow` (and their `TriggerWorkflowOptions` / `TriggerJobFunctionOptions` option types) from `@tailor-platform/sdk/runtime`, the ambient `@tailor-platform/sdk/runtime/globals` types, and the `mockWorkflow()` test facade. Use the canonical names instead:
  
  ```diff
   import { workflow } from "@tailor-platform/sdk/runtime";
  
  -await workflow.triggerWorkflow("myWorkflow", { data: "value" });
  +await workflow.startWorkflow("myWorkflow", { data: "value" });
  -workflow.triggerJobFunction("myJob", { data: "value" });
  +workflow.startJobFunction("myJob", { data: "value" });
  -await workflow.resumeWorkflow("execution-id");
  +await workflow.resumeWorkflowExecution("execution-id");
  ```
  
  Run the `v2/workflow-trigger-rename` codemod to migrate call sites automatically.

## 0.4.0-next.10

### Minor Changes

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`a4cdee0`](https://github.com/tailor-platform/sdk/commit/a4cdee079707105213f8e5833dcaa613f39c8464) Thanks [@toiroakr](https://github.com/toiroakr)! - Remove the APIs that were marked `@deprecated` on the way to v2, so 2.0.0 ships without deprecated aliases. Each removal has migration coverage in `tailor upgrade`:
  
  - `@tailor-platform/sdk/cli` no longer re-exports `kyselyTypePlugin`, `enumConstantsPlugin`, `fileUtilsPlugin`, and `seedPlugin`. Import them from `@tailor-platform/sdk/plugin/kysely-type`, `/plugin/enum-constants`, `/plugin/file-utils`, and `/plugin/seed` (codemod `v2/plugin-cli-import`).
  - `tailor.workflow.startJobFunction` and the `StartJobFunctionOptions` type are removed; use the canonical `execJobFunction` / `ExecJobFunctionOptions` (new codemod `v2/exec-job-function-rename`). `mockWorkflow()` no longer exposes the `startJobFunction` alias — assert on its `execJobFunction` mock instead — and `v2/workflow-trigger-rename` now rewrites `triggerJobFunction` straight to `execJobFunction`.
  - `@tailor-platform/sdk/test` no longer exports the platform-global mocks `setupTailordbMock`, `setupWorkflowMock`, `setupWaitPointMock`, `setupInvokerMock`, and `setupTailorErrorsMock`, nor the bundled-output helper `createImportMain`. Use the `tailor-runtime` environment from `@tailor-platform/sdk/vitest` with `mockTailordb` / `mockWorkflow` (migration guidance: `v2/sdk-test-mocks-to-vitest`). `createTailorDBHook`, `createStandardSchema`, and `unauthenticatedTailorUser` are unchanged.
  - The programmatic CLI functions no longer accept name-keyed options: `GetWorkflowOptions`, `StartWorkflowOptions`, `ListWorkflowExecutionsOptions`, `GetExecutorOptions`, `TriggerExecutorOptions`, `ListExecutorJobsOptions`, `GetExecutorJobOptions`, and `WatchExecutorJobOptions` are removed along with the overloads that took them. Pass the definition itself — `startWorkflow({ workflow: myWorkflow, invoker: "admin" })`, `watchExecutorJob({ executor: myExecutor, jobId })` — which also types `arg` and `payload` from the definition (migration guidance: `v2/cli-typed-options`). The name-keyed entry points remain available as CLI commands (`tailor workflow start <name>`, `tailor executor trigger <name>`).

- [#1912](https://github.com/tailor-platform/sdk/pull/1912) [`d9f8a52`](https://github.com/tailor-platform/sdk/commit/d9f8a528e2f9f597a71a4c42f004f050d9ef9643) Thanks [@dqn](https://github.com/dqn)! - The `v2/seed-exec-to-cli-plugin` migration now rewrites generated seed runner invocations automatically. `node <distPath>/exec.mjs [options] [types...]` becomes `tailor seed apply [options] [types...]` and `node <distPath>/exec.mjs validate` becomes `tailor seed validate`, in package.json scripts, shell scripts, CI configs, docs, and TypeScript sources, carrying node's `--env-file` / `--env-file-if-exists` over to the CLI flag form in both the `=` and space-separated spellings. Each invocation must sit on one line, so a command split across YAML sequence items or markdown bullets is reported for review rather than rewritten. Files that `fork()` the runner are left untouched and reported with their exact line, because replacing the forked child with a CLI call also unwinds the surrounding `await`/Promise plumbing; the migration prompt now covers that rewrite and the stale `exec.mjs` deletion.

### Patch Changes

- [#1923](https://github.com/tailor-platform/sdk/pull/1923) [`1015816`](https://github.com/tailor-platform/sdk/commit/101581679c4b586a5bfdcb4d72a292b56a81bc2c) Thanks [@toiroakr](https://github.com/toiroakr)! - Make the deprecation process mechanical: an `@deprecated` tag in the SDK now states the version it shipped in and the codemod that migrates callers off it (`@deprecated since 2.1.0 — use {@link newApi} instead. codemod: v2/old-to-new`), and `pnpm check:deprecations` fails when a tag misses either half, names a codemod that is not registered, or outlives its codemod's boundary — so the release PR that bumps to a major turns red while an API due for removal is still declared, instead of the alias shipping and being noticed releases later. While the shipping version is still undecided the tag carries the literal `NEXT_RELEASE`, which the release workflow rewrites to the version the release PR bumps to — the same step that already resolves `prereleaseUntil: V2_NEXT_PENDING` codemod boundaries.
  
  Registered codemods are validated more strictly too: a `since` that is not valid semver, or that is not older than `until`, now fails fast instead of surfacing as a semver error partway through `tailor upgrade` or as a codemod whose empty version range silently matches nothing.

- [#1915](https://github.com/tailor-platform/sdk/pull/1915) [`dc691ec`](https://github.com/tailor-platform/sdk/commit/dc691ec1e2181400c6715233f0588a1b5150038f) Thanks [@toiroakr](https://github.com/toiroakr)! - Generate the `Env` interface in `tailor.d.ts` from the type of each `defineConfig({ env })` value instead of the value itself. The resolved value used to be written in as a literal type, so running `generate` or `deploy` with real environment variables loaded stamped those values into a file that is normally committed.
  
  ```diff
   interface Env {
  -  API_BASE: "https://api.example.com";
  -  RETRIES: 3;
  -  VERBOSE: true;
  +  API_BASE: string;
  +  RETRIES: number;
  +  VERBOSE: boolean;
   }
  ```
  
  `env` keys that aren't valid TypeScript identifiers (for example `"API-BASE"`) are now quoted as well; previously they were emitted bare and produced a `tailor.d.ts` that failed to parse.
  
  Run `tailor generate` after upgrading to refresh the file. Code that relied on the literal narrowing — comparing `env.STAGE` against a literal union, for example — has to widen its own types or read the value through a local narrowing check. If a `tailor.d.ts` you already committed contains a sensitive value, treat that value as exposed and rotate it; keep secrets in [Secret Manager](https://github.com/tailor-platform/sdk/blob/main/packages/sdk/docs/services/secret.md) rather than `env`.

- [#1926](https://github.com/tailor-platform/sdk/pull/1926) [`a7343a5`](https://github.com/tailor-platform/sdk/commit/a7343a5976ece5ae66febe713ae04e97dfd9bee5) Thanks [@toiroakr](https://github.com/toiroakr)! - Rename the `defineIdp` option `publishUserEvents` to `publishEvents`, so all four services that publish events use one field name. A codemod rewrites the option key on `defineIdp` calls, including aliased and namespace imports, and rewrites a shorthand `{ publishUserEvents }` to `{ publishEvents: publishUserEvents }` so it keeps reading the same local. Occurrences it cannot rewrite — an options object built outside the call, a computed key, or a type declaration of the option — are reported for manual migration.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`d8564db`](https://github.com/tailor-platform/sdk/commit/d8564db44a1a59e5269f1f6236fdb75005270063) Thanks [@toiroakr](https://github.com/toiroakr)! - Mention the `--upsert` flag in the `v2/seed-exec-to-cli-plugin` migration guide's `tailor seed apply` option list.

## 0.4.0-next.9

### Patch Changes

- [#1837](https://github.com/tailor-platform/sdk/pull/1837) [`b74966b`](https://github.com/tailor-platform/sdk/commit/b74966bcefa499df1cbb5ef7e36ca76442658579) Thanks [@toiroakr](https://github.com/toiroakr)! - Update politty to v0.11.3

## 0.3.0-next.8

### Patch Changes

- [#1811](https://github.com/tailor-platform/sdk/pull/1811) [`b2fc104`](https://github.com/tailor-platform/sdk/commit/b2fc104d9cdfc52e98c97bc18d80a9e2e9d5f4c2) Thanks [@toiroakr](https://github.com/toiroakr)! - Move the TailorDB `erdSite` setting out of the core config schema into the ERD plugin's own configuration. `db.<namespace>.erdSite` is no longer accepted in `tailor.config.ts`; configure the ERD deploy target on the plugin instead:
  
  ```ts
  import { definePlugins } from "@tailor-platform/sdk";
  import { tailordbErdPlugin } from "@tailor-platform/sdk-plugin-tailordb-erd";
  
  export const plugins = definePlugins(
    // TailorDB namespace name → static website name
    tailordbErdPlugin({ sites: { tailordb: "my-erd-site" } }),
  );
  ```
  
  The `tailor tailordb erd` commands resolve deploy targets from `tailordbErdPlugin({ sites })` and now validate each namespace against `config.db` and each site name against `staticWebsites`, so typos surface when the config is loaded instead of at deploy time. The `v2/erd-site-to-plugin` codemod migrates existing configs automatically. For programmatic users, `loadTailorDBNamespaces()` additionally returns the config module's registered `plugins`, and namespace selector callbacks receive them as a second argument.

- [#1807](https://github.com/tailor-platform/sdk/pull/1807) [`817454f`](https://github.com/tailor-platform/sdk/commit/817454fff35e4093bce5fdcb9e1fcda8bbd1d7ef) Thanks [@dqn](https://github.com/dqn)! - `seedPlugin` no longer generates the `exec.mjs` seed runner. Seeding and validation move to the `tailor seed` commands provided by the `@tailor-platform/sdk-plugin-seed` CLI plugin: install it with `npm install -D @tailor-platform/sdk-plugin-seed`, replace `node <distPath>/exec.mjs` with `tailor seed apply` and `node <distPath>/exec.mjs validate` with `tailor seed validate`, and delete the stale generated `exec.mjs`. Seed data and schema generation (`data/*.jsonl`, `data/*.schema.ts`) is unchanged. Because the plugin reads the config at run time, `machineUserName` changes in seedPlugin options now take effect without regenerating. `@tailor-platform/sdk/cli` gains `loadSeedContext` (and `SeedContext` types) for this, `SeedData` is now JSON-typed, and `executeScript` accepts a plain object `invoker` (`ScriptInvoker`).

## 0.3.0-next.7

### Patch Changes

- [#1787](https://github.com/tailor-platform/sdk/pull/1787) [`898d0b0`](https://github.com/tailor-platform/sdk/commit/898d0b0f809d15ea883a32a78a247eda4ca7caa7) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix `tailor upgrade` reporting zero codemods across several v2 prerelease boundaries. `v2/db-type-to-table` and `v2/runtime-subpath-namespace` now trigger at `2.0.0-next.4` (where they actually shipped) instead of `2.0.0-next.3`, and `v2/forward-relation-name`, `v2/tailordb-validate-simplify`, and `v2/tailordb-hook-redesign` now trigger at `2.0.0-next.5` instead of `2.0.0-next.4`.

- [#1787](https://github.com/tailor-platform/sdk/pull/1787) [`6653afd`](https://github.com/tailor-platform/sdk/commit/6653afd5a0be52f8c9a1dc6fa50e445f0f678dc0) Thanks [@toiroakr](https://github.com/toiroakr)! - Add a `V2_NEXT_PENDING` placeholder `prereleaseUntil` for codemods whose exact `2.0.0-next.N` release boundary isn't known yet at implementation time, plus a `pnpm codemod:resolve-pending` step (wired into the release workflow) that resolves it to the real version constant once the release PR bumps `@tailor-platform/sdk`'s version. Prevents codemod boundaries from drifting out of sync with the version they actually ship in, which previously required a manual follow-up fix after each release.

- [#1782](https://github.com/tailor-platform/sdk/pull/1782) [`c971797`](https://github.com/tailor-platform/sdk/commit/c971797c9bfa035a43771c46f2b1c3bd93f989a9) Thanks [@toiroakr](https://github.com/toiroakr)! - Rename `Workflow.trigger()` (returned by `createWorkflow()`) and `WorkflowJob.trigger()` (returned by `createWorkflowJob()`) to `.start()`, aligning the SDK's ergonomic verb with the platform's `start*` RPC vocabulary:
  
  ```diff
   const inventory = checkInventory.trigger({ orderId: input.orderId });
  +const inventory = checkInventory.start({ orderId: input.orderId });
  
  -const workflowRunId = await orderProcessingWorkflow.trigger(args, { invoker: "manager" });
  +const workflowRunId = await orderProcessingWorkflow.start(args, { invoker: "manager" });
  ```
  
  `mockWorkflow()`'s `wf.job(definition)` / `wf.workflow(definition)` now return a mock of the `.start` method, and `wf.setTriggerHandler` / `wf.triggeredJobs` are renamed to `wf.setStartHandler` / `wf.startedJobs`. No codemod ships for the `.trigger()` → `.start()` call-site rename itself — see the `v2/workflow-start-rename` migration guide entry for manual migration steps.

- [#1782](https://github.com/tailor-platform/sdk/pull/1782) [`c971797`](https://github.com/tailor-platform/sdk/commit/c971797c9bfa035a43771c46f2b1c3bd93f989a9) Thanks [@toiroakr](https://github.com/toiroakr)! - Remove the pre-alignment `tailor.workflow` names `triggerWorkflow`, `triggerJobFunction`, and `resumeWorkflow` (and their `TriggerWorkflowOptions` / `TriggerJobFunctionOptions` option types) from `@tailor-platform/sdk/runtime`, the ambient `@tailor-platform/sdk/runtime/globals` types, and the `mockWorkflow()` test facade. Use the canonical names instead:
  
  ```diff
   import { workflow } from "@tailor-platform/sdk/runtime";
  
  -await workflow.triggerWorkflow("myWorkflow", { data: "value" });
  +await workflow.startWorkflow("myWorkflow", { data: "value" });
  -workflow.triggerJobFunction("myJob", { data: "value" });
  +workflow.startJobFunction("myJob", { data: "value" });
  -await workflow.resumeWorkflow("execution-id");
  +await workflow.resumeWorkflowExecution("execution-id");
  ```
  
  Run the `v2/workflow-trigger-rename` codemod to migrate call sites automatically.

## 0.3.0-next.6

### Patch Changes

- [#1789](https://github.com/tailor-platform/sdk/pull/1789) [`e4db171`](https://github.com/tailor-platform/sdk/commit/e4db171e2a0138ea1a0ba1a972bf895fd0616a28) Thanks [@toiroakr](https://github.com/toiroakr)! - Flag `tailor generate --watch` / `-W` invocations and programmatic `generate({ watch })` usage for manual review as part of the v2 migration (the flag and its dependency watcher are removed in `@tailor-platform/sdk` v2).

## 0.3.0-next.5

### Patch Changes

- [#1719](https://github.com/tailor-platform/sdk/pull/1719) [`4a05aec`](https://github.com/tailor-platform/sdk/commit/4a05aecfb100a1ea7292a6ae5809a2d1e6eddbfe) Thanks [@dqn](https://github.com/dqn)! - Derive default TailorDB forward relation names from the relation field name by removing a trailing `ID`, `Id`, or `id`, instead of deriving them from the target table name.
  
  The v2 migration review identifies non-self relations without `toward.as`. Add an explicit name to preserve the v1 GraphQL field name, or update consumers to use the new field-based name.

- [#1678](https://github.com/tailor-platform/sdk/pull/1678) [`e0e768d`](https://github.com/tailor-platform/sdk/commit/e0e768d77470d13806ed7b2ee2117fe374d51d40) Thanks [@toiroakr](https://github.com/toiroakr)! - Redesign TailorDB hooks and validators with several breaking changes:
  
  - Add shared `now` timestamp to all hooks — multiple fields stamped with the same `Date`
  - Field-level hooks: `{ value, data, invoker }` → create `{ input, invoker, now }` / update `{ input, oldValue, invoker, now }` (`data` removed, `oldValue` added for update only)
  - Type-level hooks: per-field mapping (`Hooks<F>`) → single `{ create, update }` object (`TypeHook<F>`) returning partial field overrides
  - Type-level create hooks no longer receive `oldRecord`; update hooks receive non-nullable `oldRecord`
  - Field-level validators: return type changed from `boolean` to `string | void` (return error message or void to pass); `[fn, message]` tuple form removed
  - Type-level validators: `Validators<F>` per-field record → `TypeValidateFn<F>` single function with `issues(field, message)` callback
  - Add `.default(value)` on fields to set a create-time default (makes required fields optional in create input)
  - Remove exported types: `Hooks<F>`, `Validators<F>`, `ValidateConfig`

## 0.3.0-next.4

### Patch Changes

- [#1693](https://github.com/tailor-platform/sdk/pull/1693) [`4751214`](https://github.com/tailor-platform/sdk/commit/4751214c0923e094a844f9ce322279a47e871075) Thanks [@dqn](https://github.com/dqn)! - Rename the TailorDB schema builder from `db.type()` to `db.table()`.
  
  Update TailorDB definitions:
  
  ```diff
   import { db } from "@tailor-platform/sdk";
  
  -export const user = db.type("User", {
  +export const user = db.table("User", {
     name: db.string(),
   });
  ```

- [#1704](https://github.com/tailor-platform/sdk/pull/1704) [`9c81d9c`](https://github.com/tailor-platform/sdk/commit/9c81d9c18b1d29b3e9307ea17fe54c8ce55f4dda) Thanks [@dqn](https://github.com/dqn)! - Remove flat value and default exports from `@tailor-platform/sdk/runtime/*` subpath modules. Import each subpath through its self-named namespace export instead, for example `import { iconv } from "@tailor-platform/sdk/runtime/iconv"`.
  
  The aggregate `@tailor-platform/sdk/runtime` entry remains named-only, and its deprecated `file.deleteFile` alias is removed in favor of `file.delete`. The v2 codemod rewrites straightforward namespace-star subpath imports, flat named value imports, and aggregate `file.deleteFile` calls to the new namespace-object style.
  
  `TailorContextAPI` and `TailorWorkflowAPI` now describe the SDK wrapper objects. Code that types the platform-provided `globalThis.tailor.context` or `globalThis.tailor.workflow` objects directly must use `PlatformContextAPI` or `PlatformWorkflowAPI` instead.

## 0.3.0-next.3

### Patch Changes

- [#1559](https://github.com/tailor-platform/sdk/pull/1559) [`ff8ef1c`](https://github.com/tailor-platform/sdk/commit/ff8ef1c1323daf81812c182e146fd53da20e676e) Thanks [@dqn](https://github.com/dqn)! - Rename auth attribute module augmentation from `AttributeMap` to `Attributes`.

- [#1584](https://github.com/tailor-platform/sdk/pull/1584) [`7faff07`](https://github.com/tailor-platform/sdk/commit/7faff07982909b63b87185dc1186e2919a06d4bb) Thanks [@dqn](https://github.com/dqn)! - Report the codemod runner identity in the JSON summary, including the source checkout commit and local build command when run from a branch build, so prerelease migration validation can distinguish exact npm packages from branch-head behavior.

- [#1599](https://github.com/tailor-platform/sdk/pull/1599) [`b88f6a2`](https://github.com/tailor-platform/sdk/commit/b88f6a2e1c6d8e25a797bec6ca90428f5be3b1b9) Thanks [@dqn](https://github.com/dqn)! - Apply the v2 `rename-bin` codemod to SDK CLI command strings in TypeScript and JavaScript source files.

- [#1578](https://github.com/tailor-platform/sdk/pull/1578) [`579cb47`](https://github.com/tailor-platform/sdk/commit/579cb4705cb295c1fcf9bff948d205fb245ff4e5) Thanks [@dqn](https://github.com/dqn)! - Run v2 codemods when the target version is a v2 prerelease.

- [#1686](https://github.com/tailor-platform/sdk/pull/1686) [`aecaf8c`](https://github.com/tailor-platform/sdk/commit/aecaf8c1bb7813a32e998ea7d034684541cb1c85) Thanks [@dqn](https://github.com/dqn)! - Replace `tailor skills install` with project-local `tailor skills add`, `list`, `remove`, and `sync` commands for bundled Tailor SDK agent skills.

- [#1585](https://github.com/tailor-platform/sdk/pull/1585) [`1c1ca49`](https://github.com/tailor-platform/sdk/commit/1c1ca499b4fd55a616b1531ec7ab280ceed531d3) Thanks [@dqn](https://github.com/dqn)! - Report precise file-local findings for `principal-unify` review follow-ups, including nullable caller call sites and `context.user` helper adapters.

- [#1601](https://github.com/tailor-platform/sdk/pull/1601) [`144f3e3`](https://github.com/tailor-platform/sdk/commit/144f3e30f2b0c5dac1a3288ff65c9dc5ca82c13b) Thanks [@dqn](https://github.com/dqn)! - Fix `v2/principal-unify` review findings for nested SDK field parser invoker values and destructured context helper messages.

- [#1622](https://github.com/tailor-platform/sdk/pull/1622) [`0fe8bad`](https://github.com/tailor-platform/sdk/commit/0fe8bad9afbb7702bc067ac9635b77c0438497a6) Thanks [@dqn](https://github.com/dqn)! - Remove the deprecated `auth.getConnectionToken()` helper from values returned by `defineAuth()`. Use `authconnection.getConnectionToken(...)` from `@tailor-platform/sdk/runtime` in resolvers, executors, and workflows instead. The v2 codemod rewrites direct `auth.getConnectionToken(...)` calls when the `auth` binding is imported from `tailor.config`.

- [#1557](https://github.com/tailor-platform/sdk/pull/1557) [`7ff575f`](https://github.com/tailor-platform/sdk/commit/7ff575fdfa15c00b5fc6282b28c0cb50bfdf927b) Thanks [@toiroakr](https://github.com/toiroakr)! - Rename the CLI binary from `tailor-sdk` to `tailor`.
  
  The output directory default changes from `.tailor-sdk` to `.tailor`, and the GitHub Actions lock file path changes from `.github/tailor-sdk.lock` to `.github/tailor.lock`.
  
  Run the `v2/rename-bin` codemod to migrate `tailor-sdk` invocations in package.json scripts, shell scripts, CI workflows, and documentation:
  
  ```sh
  npx @tailor-platform/sdk-codemod --from 1.x --to 2.0.0
  ```

- [#1563](https://github.com/tailor-platform/sdk/pull/1563) [`501e8bf`](https://github.com/tailor-platform/sdk/commit/501e8bfdd2bca7201a1c9b036bf72087476da416) Thanks [@dqn](https://github.com/dqn)! - Standardize SDK-owned environment variables on the `TAILOR_*` namespace.
  
  Replace the removed SDK-specific environment variables with their new names: `TAILOR_CONFIG_PATH`, `TAILOR_DTS_PATH`, `TAILOR_CI_ALLOW_ID_INJECTION`, `TAILOR_DEPLOY_BUILD_ONLY`, `TAILOR_BUILD_OUTPUT_DIR`, `TAILOR_SKILLS_SOURCE`, `TAILOR_TEMPLATE_SDK_VERSION`, `TAILOR_PLATFORM_URL`, `TAILOR_PLATFORM_OAUTH2_CLIENT_ID`, `TAILOR_INLINE_SOURCEMAP`, `TAILOR_QUERY_NEWLINE_ON_ENTER`, and `TAILOR_APP_LOG_LEVEL`. The deprecated `TAILOR_TOKEN` fallback is removed; use `TAILOR_PLATFORM_TOKEN`. The v2 codemod rewrites unambiguous removed SDK environment variable names and flags generic names such as `LOG_LEVEL` and `PLATFORM_URL` for manual review.

- [#1684](https://github.com/tailor-platform/sdk/pull/1684) [`de3ef5e`](https://github.com/tailor-platform/sdk/commit/de3ef5e7421a998624154df5e90da62e17664524) Thanks [@dqn](https://github.com/dqn)! - Restore Tailor field outputs for UUID, date, datetime, time, and decimal fields to plain string-compatible types and remove the strict scalar string migration guidance.

- [#1582](https://github.com/tailor-platform/sdk/pull/1582) [`b8b48a3`](https://github.com/tailor-platform/sdk/commit/b8b48a379a73314c26fbf53c74c2181e77f0565b) Thanks [@dqn](https://github.com/dqn)! - Flag JavaScript files and embedded code strings that still reference ambient Tailor runtime globals during v2 migration review.

- [#1583](https://github.com/tailor-platform/sdk/pull/1583) [`006a588`](https://github.com/tailor-platform/sdk/commit/006a5884583f23fc6852714c41e58a7ab6d65a5a) Thanks [@dqn](https://github.com/dqn)! - Automatically migrate simple direct `tailor.idp.Client` runtime global usage to the typed `idp.Client` wrapper during v2 upgrades.

- [#1639](https://github.com/tailor-platform/sdk/pull/1639) [`6616674`](https://github.com/tailor-platform/sdk/commit/6616674eb41a53619138603405a4498e3f09d70b) Thanks [@dqn](https://github.com/dqn)! - Keep v2 codemods from reusing type-only runtime helper imports when adding runtime value imports.

- [#1581](https://github.com/tailor-platform/sdk/pull/1581) [`79780bc`](https://github.com/tailor-platform/sdk/commit/79780bce19864a238602f4dd7a82fcc84e9f8501) Thanks [@dqn](https://github.com/dqn)! - Add the `v2/tailor-output-ignore-dir` codemod so SDK upgrades rewrite exact `.tailor-sdk/` ignore-file entries to `.tailor/` while leaving other `.tailor-sdk` paths unchanged.

- [#1556](https://github.com/tailor-platform/sdk/pull/1556) [`645949e`](https://github.com/tailor-platform/sdk/commit/645949ed64bda8b82fc44c0db54928698b12a2eb) Thanks [@toiroakr](https://github.com/toiroakr)! - Rename `defineWaitPoint` and `defineWaitPoints` to `createWaitPoint` and `createWaitPoints`.
  
  These functions create runtime instances with `.wait()` and `.resolve()` methods that call the platform API at runtime, so the `create*` prefix is more accurate. Update any usages:
  
  ```diff
  -import { defineWaitPoint, defineWaitPoints } from "@tailor-platform/sdk";
  +import { createWaitPoint, createWaitPoints } from "@tailor-platform/sdk";
  
  -export const approval = defineWaitPoint<Payload, Result>("approval");
  +export const approval = createWaitPoint<Payload, Result>("approval");
  
  -export const waitPoints = defineWaitPoints((define) => ({ ... }));
  +export const waitPoints = createWaitPoints((define) => ({ ... }));
  ```

## 0.3.0-next.2
### Minor Changes



- [#1473](https://github.com/tailor-platform/sdk/pull/1473) [`7ddf3c7`](https://github.com/tailor-platform/sdk/commit/7ddf3c716adf85a66a75d554da7730b5406f84b1) Thanks [@dqn](https://github.com/dqn)! - Add the `v2/principal-unify` codemod so `tailor-sdk upgrade` can migrate SDK principal APIs to `TailorPrincipal`.


### Patch Changes



- [#1515](https://github.com/tailor-platform/sdk/pull/1515) [`dcf66a1`](https://github.com/tailor-platform/sdk/commit/dcf66a1e648f5287eaea9ea330eb4ad726a4d363) Thanks [@dqn](https://github.com/dqn)! - Rewrite `tailor-sdk apply` to `tailor-sdk deploy` in source files that contain embedded CLI command strings.



- [#1482](https://github.com/tailor-platform/sdk/pull/1482) [`8b5870e`](https://github.com/tailor-platform/sdk/commit/8b5870e85db1efec7647acb98226f8161e3d1583) Thanks [@toiroakr](https://github.com/toiroakr)! - Add LLM-assisted review support to the codemod runner. A codemod can declare `suspiciousPatterns` plus a `prompt`; after running, files whose post-transform content still matches a suspicious pattern are reported as `llmReviews` (in the JSON output and on stderr) together with the codemod's migration prompt. This surfaces the cases a deterministic transform cannot safely complete (e.g. a value reached through a variable) so they can be finished with an LLM. The `auth.invoker(...)` codemod adopts this for its non-literal-argument cases.



- [#1495](https://github.com/tailor-platform/sdk/pull/1495) [`6234022`](https://github.com/tailor-platform/sdk/commit/6234022d7dc03813b8dade831b86f63a5f7a20e6) Thanks [@toiroakr](https://github.com/toiroakr)! - Generate the v2 migration guide (`packages/sdk/docs/migration/v2.md`) from the codemod registry, which is the single source of truth. Each entry renders its name, automation level (Automatic / Partially automatic / Manual), description, optional before/after `examples`, and — for changes the codemods cannot fully migrate on their own — the LLM/manual migration prompt. Run `pnpm codemod:docs:update` to regenerate and `pnpm codemod:docs:check` (wired into `pnpm check`) to verify it is in sync.

  `scriptPath` is now optional, so the registry can also describe codemod-less ("manual") migrations that ship only guidance (`examples` / `prompt` / `suspiciousPatterns`) with no automatic transform. A manual entry with a `prompt` but no scoping pattern is surfaced as a project-wide `llmReviews` entry at runtime.

  Add a `sdk-codemod list` command that prints every registered rule (id, name, kind, version range).


- [#1517](https://github.com/tailor-platform/sdk/pull/1517) [`a649764`](https://github.com/tailor-platform/sdk/commit/a6497649be2786b3f6e410c8aa98c4247a599258) Thanks [@dqn](https://github.com/dqn)! - Reduce false-positive v2 codemod warnings and LLM-review prompts from source comments, string literals, and identifier substring matches.



- [#1476](https://github.com/tailor-platform/sdk/pull/1476) [`fa83075`](https://github.com/tailor-platform/sdk/commit/fa83075f5e0e91085c0ef0cb44b7058a28a79ec3) Thanks [@toiroakr](https://github.com/toiroakr)! - `executeScript` now takes its `arg` as a JSON-serializable value instead of a pre-serialized JSON string. Pass the value directly (e.g. `arg: { a: 1 }`) instead of `arg: JSON.stringify({ a: 1 })`.

  Add the `v2/execute-script-arg` codemod, which unwraps `JSON.stringify(...)` passed as the `executeScript` `arg` option. Indirect forms (a stringified value held in a variable, etc.) cannot be rewritten automatically and are surfaced as an LLM-assisted review task with a migration prompt.


- [#1518](https://github.com/tailor-platform/sdk/pull/1518) [`ab10b1f`](https://github.com/tailor-platform/sdk/commit/ab10b1fea309ec5496e09bdca394d46d58603f5f) Thanks [@dqn](https://github.com/dqn)! - Reduce noisy `executeScript` LLM-review prompts by flagging files only when unresolved `arg` stringification remains likely.



- [#1509](https://github.com/tailor-platform/sdk/pull/1509) [`7cadaa7`](https://github.com/tailor-platform/sdk/commit/7cadaa7c4987b81130ca80ba80bc5d5b26276394) Thanks [@dqn](https://github.com/dqn)! - Rename resolver, executor, workflow trigger, and typed workflow start machine-user options from `authInvoker` to `invoker`.

  Update create-sdk templates and the v2 auth invoker codemod to generate the new `invoker` option.


- [#1519](https://github.com/tailor-platform/sdk/pull/1519) [`4e3fa47`](https://github.com/tailor-platform/sdk/commit/4e3fa47d24e6bb1145eac13c355e976f2d594851) Thanks [@dqn](https://github.com/dqn)! - Limit the `openDownloadStream` migration review prompt to files that reference deprecated download stream APIs.



- [#1521](https://github.com/tailor-platform/sdk/pull/1521) [`2d0689e`](https://github.com/tailor-platform/sdk/commit/2d0689e8ac0079473294fab367799a5431c130f4) Thanks [@dqn](https://github.com/dqn)! - Flag files that need project-specific review after the v2 principal migration, including resolver helper adapters and nullable `caller` follow-ups.



- [#1525](https://github.com/tailor-platform/sdk/pull/1525) [`425a19d`](https://github.com/tailor-platform/sdk/commit/425a19dd58da6e373b739d3b3e838c2ff3d1736a) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency semver to v7.8.5



- [#1520](https://github.com/tailor-platform/sdk/pull/1520) [`ed3d338`](https://github.com/tailor-platform/sdk/commit/ed3d338ce71d68904ef1fb83afbbd06a7e5f6973) Thanks [@dqn](https://github.com/dqn)! - Flag files that still reference ambient Tailor runtime globals so the v2 migration can opt them into `@tailor-platform/sdk/runtime/globals`.



- [#1439](https://github.com/tailor-platform/sdk/pull/1439) [`c5b10d2`](https://github.com/tailor-platform/sdk/commit/c5b10d2841ded08927285bce538c05220cde5e4c) Thanks [@dqn](https://github.com/dqn)! - Unify function principal context around `TailorPrincipal`.

  Resolver contexts now use `caller` and `invoker` as `TailorPrincipal | null`, workflow and executor invokers also use `TailorPrincipal | null`, and event executor `actor` uses `TailorPrincipal | null` with `id`/`type` fields. The legacy `TailorUser`, `TailorInvoker`, `TailorActor`, `TailorActorType`, and `unauthenticatedTailorUser` exports are removed.

## 0.3.0-next.1
### Patch Changes



- [#1460](https://github.com/tailor-platform/sdk/pull/1460) [`f49c6d1`](https://github.com/tailor-platform/sdk/commit/f49c6d1b5a856969cb4e04ae7d3a87ed34aa020f) Thanks [@dqn](https://github.com/dqn)! - Remove the v1 runtime globals compatibility layer. Importing from `@tailor-platform/sdk` no longer activates the ambient `tailor.*` / `tailordb.*` declarations; opt into globals with `@tailor-platform/sdk/runtime/globals` or use the typed wrappers from `@tailor-platform/sdk/runtime`.

  The capital-cased `Tailordb.*` namespace is removed. If your project still references `Tailordb.QueryResult`, `Tailordb.CommandType`, `Tailordb.Client`, or `typeof Tailordb.Client`, migrate before upgrading: run `pnpm dlx @tailor-platform/sdk-codemod v2/tailordb-namespace` to rewrite them to lowercase `tailordb.*`, then add `import "@tailor-platform/sdk/runtime/globals"` so the rewritten references resolve.


- [#1457](https://github.com/tailor-platform/sdk/pull/1457) [`84325f8`](https://github.com/tailor-platform/sdk/commit/84325f8602a5631b7c323c997b1425235509920e) Thanks [@dqn](https://github.com/dqn)! - Remove deprecated CLI aliases for the v2 command surface. Use `tailor-sdk deploy` instead of `tailor-sdk apply`, `tailor-sdk crashreport` instead of `tailor-sdk crash-report`, and the hyphenated `--machine-user` option instead of the hidden `--machineuser` alias.

  Fix the v2 CLI rename codemod to migrate the hidden `--machineuser` option to `--machine-user`.

## 0.3.0-next.0
### Minor Changes



- [#1435](https://github.com/tailor-platform/sdk/pull/1435) [`49c0cc9`](https://github.com/tailor-platform/sdk/commit/49c0cc99171d7e317a50a18804a21067d89f9493) Thanks [@dqn](https://github.com/dqn)! - Add the `v2/plugin-cli-import` codemod so `tailor-sdk upgrade` rewrites deprecated plugin imports from `@tailor-platform/sdk/cli` (`kyselyTypePlugin`, `enumConstantsPlugin`, `fileUtilsPlugin`, `seedPlugin`) to their dedicated `@tailor-platform/sdk/plugin/*` subpaths, splitting any non-plugin specifiers onto a separate import.

## 0.3.0
### Minor Changes



- [#1435](https://github.com/tailor-platform/sdk/pull/1435) [`49c0cc9`](https://github.com/tailor-platform/sdk/commit/49c0cc99171d7e317a50a18804a21067d89f9493) Thanks [@dqn](https://github.com/dqn)! - Add the `v2/plugin-cli-import` codemod so `tailor-sdk upgrade` rewrites deprecated plugin imports from `@tailor-platform/sdk/cli` (`kyselyTypePlugin`, `enumConstantsPlugin`, `fileUtilsPlugin`, `seedPlugin`) to their dedicated `@tailor-platform/sdk/plugin/*` subpaths, splitting any non-plugin specifiers onto a separate import.

## 0.3.9

### Patch Changes

- [#1901](https://github.com/tailor-platform/sdk/pull/1901) [`7d1974f`](https://github.com/tailor-platform/sdk/commit/7d1974f52952a8f39a7adfc06644404b2510f1c3) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency politty to v0.11.6

- [#1903](https://github.com/tailor-platform/sdk/pull/1903) [`83c5bc4`](https://github.com/tailor-platform/sdk/commit/83c5bc453a77a734599b665ebe2873ff6b305f1d) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @ast-grep/napi to v0.45.0

## 0.3.8

### Patch Changes

- [#1818](https://github.com/tailor-platform/sdk/pull/1818) [`56608cc`](https://github.com/tailor-platform/sdk/commit/56608ccc445c1aeb683ddfd72965446b1062cfbd) Thanks [@toiroakr](https://github.com/toiroakr)! - Adopt Vitest 4.1 `aroundEach`/`aroundAll` hooks across the test suites, and update the TailorDB client mock example in the testing docs to the same style

## 0.3.7

### Patch Changes

- [#1744](https://github.com/tailor-platform/sdk/pull/1744) [`3ca5b48`](https://github.com/tailor-platform/sdk/commit/3ca5b48fca4e8e1f0878350afc11d42d36bf3cab) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency politty to v0.11.2

## 0.3.6

### Patch Changes

- [#1688](https://github.com/tailor-platform/sdk/pull/1688) [`7f67996`](https://github.com/tailor-platform/sdk/commit/7f679963adc1df438e49200f1170415629817f44) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @ast-grep/napi to v0.44.1

## 0.3.5

### Patch Changes

- [#1659](https://github.com/tailor-platform/sdk/pull/1659) [`6ba468f`](https://github.com/tailor-platform/sdk/commit/6ba468f4654a723ab4db01d3f3474ae96c25cc71) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency picomatch to v4.0.5

## 0.3.4

### Patch Changes

- [#1626](https://github.com/tailor-platform/sdk/pull/1626) [`06cc5f2`](https://github.com/tailor-platform/sdk/commit/06cc5f2960c5a09e9783d6b0923ed8c1b3d606a8) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency politty to v0.11.0

## 0.3.3
### Patch Changes



- [#1598](https://github.com/tailor-platform/sdk/pull/1598) [`a5a4c58`](https://github.com/tailor-platform/sdk/commit/a5a4c58cabc24af3088d85c7a0d975d5be459def) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency politty to v0.10.1

## 0.3.2
### Patch Changes



- [#1525](https://github.com/tailor-platform/sdk/pull/1525) [`425a19d`](https://github.com/tailor-platform/sdk/commit/425a19dd58da6e373b739d3b3e838c2ff3d1736a) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency semver to v7.8.5



- [#1533](https://github.com/tailor-platform/sdk/pull/1533) [`e3bc2ce`](https://github.com/tailor-platform/sdk/commit/e3bc2ce65ab30ee53e5de0eb48ca6c24049fcd1b) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency politty to v0.9.2



- [#1554](https://github.com/tailor-platform/sdk/pull/1554) [`a2ca1f9`](https://github.com/tailor-platform/sdk/commit/a2ca1f989a69153138ddef66931f1e8a94c8c3e9) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @ast-grep/napi to v0.44.0

## 0.3.1
### Patch Changes



- [#1428](https://github.com/tailor-platform/sdk/pull/1428) [`753ac38`](https://github.com/tailor-platform/sdk/commit/753ac3876319d007322c23a7052a2399d194fb72) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency semver to v7.8.4

## 0.3.0
### Minor Changes



- [#1435](https://github.com/tailor-platform/sdk/pull/1435) [`49c0cc9`](https://github.com/tailor-platform/sdk/commit/49c0cc99171d7e317a50a18804a21067d89f9493) Thanks [@dqn](https://github.com/dqn)! - Add the `v2/plugin-cli-import` codemod so `tailor-sdk upgrade` rewrites deprecated plugin imports from `@tailor-platform/sdk/cli` (`kyselyTypePlugin`, `enumConstantsPlugin`, `fileUtilsPlugin`, `seedPlugin`) to their dedicated `@tailor-platform/sdk/plugin/*` subpaths, splitting any non-plugin specifiers onto a separate import.

## 0.2.7

### Patch Changes

- [#1412](https://github.com/tailor-platform/sdk/pull/1412) [`ada99e7`](https://github.com/tailor-platform/sdk/commit/ada99e79847239381b29348598df81be4fbe909e) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency semver to v7.8.3

## 0.2.6

### Patch Changes

- [#1380](https://github.com/tailor-platform/sdk/pull/1380) [`2ed1344`](https://github.com/tailor-platform/sdk/commit/2ed1344e5ffff6e78d74ef3a0297fcff4a6201e7) Thanks [@dqn](https://github.com/dqn)! - Internal refactoring: replace mutating array methods (`sort`/`reverse`/`splice`) with non-mutating ES2023 equivalents (`toSorted`/`toReversed`/`toSpliced`). No user-facing behavior change.

## 0.2.5

### Patch Changes

- [#1353](https://github.com/tailor-platform/sdk/pull/1353) [`f0cfb61`](https://github.com/tailor-platform/sdk/commit/f0cfb61dcadb47819a8916da9bcf9b63a4ff5706) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency semver to v7.8.2

## 0.2.4

### Patch Changes

- [#1258](https://github.com/tailor-platform/sdk/pull/1258) [`bffece9`](https://github.com/tailor-platform/sdk/commit/bffece9b592972e2bc5e4a882232b2704623e6f4) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @ast-grep/napi to v0.43.0

## 0.2.3

### Patch Changes

- [#1245](https://github.com/tailor-platform/sdk/pull/1245) [`261a49d`](https://github.com/tailor-platform/sdk/commit/261a49de5d30d3a427a8a484956aa10ee6576abf) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency semver to v7.8.1

## 0.2.2

### Patch Changes

- [#1236](https://github.com/tailor-platform/sdk/pull/1236) [`8b018b8`](https://github.com/tailor-platform/sdk/commit/8b018b8c224e993adc7faf61614242e3f1141f56) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @ast-grep/napi to v0.42.3

- [#1249](https://github.com/tailor-platform/sdk/pull/1249) [`2e11bc2`](https://github.com/tailor-platform/sdk/commit/2e11bc28e76fca4874b9d35454e86253ca53b920) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency zod to v4.4.3

## 0.2.1

### Patch Changes

- [#1131](https://github.com/tailor-platform/sdk/pull/1131) [`f5d3d38`](https://github.com/tailor-platform/sdk/commit/f5d3d38f0b0f5634d4ecd4cb108731f57adc2a57) Thanks [@toiroakr](https://github.com/toiroakr)! - Add `v2/tailordb-namespace` codemod for the `@tailor-platform/function-types` → `@tailor-platform/sdk` vendoring: rewrite references to the deprecated capital-cased `Tailordb` ambient namespace (`Tailordb.QueryResult`, `Tailordb.CommandType`, `Tailordb.Client`, `typeof Tailordb.Client`) to the new lowercase `tailordb.*` namespace re-published by the SDK.

## 0.2.0

### Minor Changes

- [#1104](https://github.com/tailor-platform/sdk/pull/1104) [`3c1571c`](https://github.com/tailor-platform/sdk/commit/3c1571cd76d125854b8379dfb8edcb58c2f517a4) Thanks [@dqn](https://github.com/dqn)! - Add three v2 codemods that the upgrade runner can apply when migrating across the 1.x → 2.x boundary:

  - `v2/test-run-arg-input` strips the deprecated `{ "input": ... }` wrapper from `tailor-sdk function test-run --arg` JSON inside `package.json` scripts, shell scripts, and Markdown code blocks.
  - `v2/sdk-skills-shim` rewrites `tailor-sdk-skills` invocations to `tailor-sdk skills install` across `package.json`, shell, YAML, and Markdown files.
  - `v2/principal-unify` renames `TailorUser` / `TailorActor` / `TailorInvoker` to the unified `TailorPrincipal`, drops `unauthenticatedTailorUser` (replacing standalone value references with `null`; member-access forms are left as-is so the resulting type error points authors at sites that need manual review), and renames `user` to `caller` inside `createResolver` body parameters and member accesses.
  - `v2/apply-to-deploy` rewrites `tailor-sdk apply` invocations in `package.json` scripts, shell scripts, CI YAML, and Markdown to the v2-recommended `tailor-sdk deploy` alias. Optional `@version` pins (`tailor-sdk@latest`, `tailor-sdk@1.45.2`) are preserved.
  - `v2/cli-rename` rewrites `tailor-sdk crash-report` invocations to the v2 single-word `tailor-sdk crashreport` form across `package.json` scripts, shell scripts, CI YAML, and Markdown. Optional `@version` pins are preserved.
  - `v2/auth-invoker-unwrap` replaces `auth.invoker("name")` calls with the bare `"name"` string literal and drops the `auth` import when it has no other reference. Calls whose argument is not a literal string (`auth.invoker(variable)`, template literals) are left untouched so the author can decide.

### Patch Changes

- [#1181](https://github.com/tailor-platform/sdk/pull/1181) [`3da6be2`](https://github.com/tailor-platform/sdk/commit/3da6be28a9df97b7633ada4923564d3c18afbf49) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @ast-grep/napi to v0.42.2

## 0.1.5

### Patch Changes

- [#1127](https://github.com/tailor-platform/sdk/pull/1127) [`79050d4`](https://github.com/tailor-platform/sdk/commit/79050d4606dc695522f2eaa65a0079b20c3d51c8) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency pkg-types to v2.3.1

## 0.1.4

### Patch Changes

- [#1074](https://github.com/tailor-platform/sdk/pull/1074) [`d272f26`](https://github.com/tailor-platform/sdk/commit/d272f2604f31f2b61d880f1e57d2732b18f5c982) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency politty to v0.4.15

## 0.1.3

### Patch Changes

- [#1030](https://github.com/tailor-platform/sdk/pull/1030) [`fc4cc7c`](https://github.com/tailor-platform/sdk/commit/fc4cc7cc4430c545c50eb8bb4b406023c91d8290) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency politty to v0.4.14

- [#1041](https://github.com/tailor-platform/sdk/pull/1041) [`0858d64`](https://github.com/tailor-platform/sdk/commit/0858d64b3a03a3a9d994ebe5cd18a803b9780cac) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update pnpm/action-setup action to v6.0.3

## 0.1.2

### Patch Changes

- [#1001](https://github.com/tailor-platform/sdk/pull/1001) [`2fd4b33`](https://github.com/tailor-platform/sdk/commit/2fd4b33c3c4a02e7adc4b1f52d716a1a97ffb7ec) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): pin dependency @ast-grep/napi to 0.42.1

- [#1003](https://github.com/tailor-platform/sdk/pull/1003) [`66eed51`](https://github.com/tailor-platform/sdk/commit/66eed51a93eec10898250ec625953a5c5a3ec7a1) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @types/picomatch to v4.0.3

- [#1009](https://github.com/tailor-platform/sdk/pull/1009) [`874d709`](https://github.com/tailor-platform/sdk/commit/874d70949c35283e6a015725434cf9a799439e96) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency diff to v9

## 0.1.1

### Patch Changes

- [#941](https://github.com/tailor-platform/sdk/pull/941) [`0a1b538`](https://github.com/tailor-platform/sdk/commit/0a1b53886ac738347e0e7fcb4f94e4c713fad316) Thanks [@toiroakr](https://github.com/toiroakr)! - Add `upgrade` command with codemod.com-based architecture for automated SDK version migrations. Codemod execution is handled by the new `@tailor-platform/sdk-codemod` package.
