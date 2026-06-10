# @tailor-platform/sdk-codemod

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
