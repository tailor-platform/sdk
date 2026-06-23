# @tailor-platform/sdk-codemod

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
