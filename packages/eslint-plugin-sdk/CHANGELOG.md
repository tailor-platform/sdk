# @tailor-platform/eslint-plugin-sdk

## 0.5.0

### Minor Changes

- [#3016](https://github.com/tailor-platform/sdk/pull/3016) [`cd01a32`](https://github.com/tailor-platform/sdk/commit/cd01a32754ea877bc1cf979e4450fdd6dd1a4417) Thanks [@dqn](https://github.com/dqn)! - Add the `no-unused-resolver-input` lint rule, which reports a resolver `input` field that `body` never reads, since a caller may expect it to take effect. A field that `permission` compares with the caller or that declares a `validate` counts as used, and a resolver whose `body` passes its input on in a way that hides which fields it reads is not reported. Silence a field kept on purpose with `eslint-disable-next-line`. Enabled in the ESLint `recommended` config and in newly scaffolded projects; existing Oxlint projects add `"tailor-sdk/no-unused-resolver-input": "warn"` to `.oxlintrc.json`.

- [#3015](https://github.com/tailor-platform/sdk/pull/3015) [`0d690dc`](https://github.com/tailor-platform/sdk/commit/0d690dcef12d53582f01a550ffa9739f8f21b072) Thanks [@dqn](https://github.com/dqn)! - Add the `no-unbound-caller-id-input` lint rule, which reports a resolver mutation's `t.uuid()` or `db.uuid()` input named like the caller's ID, such as `approverId`, `requesterId`, or `createdBy`, unless every `permit: true` policy of its `permission` compares the input with the caller; otherwise a caller can act as another user by sending that user's ID. Enabled in newly scaffolded projects and in the ESLint `recommended` config; add `"tailor-sdk/no-unbound-caller-id-input": "warn"` to the `rules` of an existing `.oxlintrc.json` to enable it there.

- [#3087](https://github.com/tailor-platform/sdk/pull/3087) [`6ca179d`](https://github.com/tailor-platform/sdk/commit/6ca179ddfb0b83d1ce6669bd17136e33458604b2) Thanks [@dqn](https://github.com/dqn)! - Add a `check` option to `no-node-builtin-imports` and `no-node-only-globals`. With `{ "check": "all-files" }` in an override whose `files` cover the code bundled into your functions, the rules also report Node built-in imports and Node-only globals in helper modules that define no resolver, executor, workflow job, or HTTP adapter, so you see them while editing the helper instead of at `tailor generate` or `deploy`. Since a helper may be bundled into an HTTP adapter, its messages omit the suggested alternatives, which are written for `body` functions. The default, `"definition-files"`, keeps the current behavior.

## 0.4.0

### Minor Changes

- [#3017](https://github.com/tailor-platform/sdk/pull/3017) [`df8f3e4`](https://github.com/tailor-platform/sdk/commit/df8f3e439b93878c48ffaf6076cf8a1e03deff27) Thanks [@dqn](https://github.com/dqn)! - Add a lint rule (`no-plain-tailor-any-field-param`) that flags a helper parameter typed with `TailorAnyField` itself, such as `field: TailorAnyField` or `fields: Record<string, TailorAnyField>`. When the helper uses a field passed to it to build another field, such as with `t.object()`, that field's output type becomes `any`; constrain a type parameter instead, such as `<F extends TailorAnyField>(field: F)`. Enabled in newly scaffolded projects.

- [#3014](https://github.com/tailor-platform/sdk/pull/3014) [`3af9d37`](https://github.com/tailor-platform/sdk/commit/3af9d37c2d7d34a53fa00a9771e0c0ca1cbb37fc) Thanks [@dqn](https://github.com/dqn)! - `valid-resolver-permission` accepts `{ input: "<field>" }` operands compared with a `user` operand using `=`, and reports one compared with anything else or with `!=`, used in a `permit: false` policy, or used in `defaultPermission`.

## 0.3.2

### Patch Changes

- [#2784](https://github.com/tailor-platform/sdk/pull/2784) [`9b00301`](https://github.com/tailor-platform/sdk/commit/9b00301211902826ae78e608f8251e8df238d361) Thanks [@dqn](https://github.com/dqn)! - Fix `no-unconditional-permit` reporting an imported unsafe constant twice when it is re-exported with `export { name }`, and `no-node-only-globals` flagging export names such as `export { proc as process }` and re-exports from other modules such as `export { process } from "./pipeline"` and `export * as process from "./pipeline"`.

## 0.3.1

### Patch Changes

- [#2730](https://github.com/tailor-platform/sdk/pull/2730) [`a0ad6c2`](https://github.com/tailor-platform/sdk/commit/a0ad6c29f6ab30707a4c85d434071c09ffda27ab) Thanks [@dqn](https://github.com/dqn)! - Fix no-unconditional-permit missing unrestricted permissions on db.table chains

## 0.3.0

### Minor Changes

- [#2313](https://github.com/tailor-platform/sdk/pull/2313) [`9817890`](https://github.com/tailor-platform/sdk/commit/98178900a5208a734fb3977eeab94fa103cce6c3) Thanks [@dqn](https://github.com/dqn)! - Add two lint rules that flag, in files defining a resolver, executor, workflow job, or HTTP adapter, the Node-only globals (`no-node-only-globals`) and Node built-in module imports (`no-node-builtin-imports`) that the Tailor Platform runtime does not provide. Both print the same suggested alternative the build does, and both leave configuration, scripts, and tests alone. Enabled in newly scaffolded projects.

- [#2314](https://github.com/tailor-platform/sdk/pull/2314) [`8351e86`](https://github.com/tailor-platform/sdk/commit/8351e866d65a07109b965f11f56d55d8207fbe2c) Thanks [@dqn](https://github.com/dqn)! - Add three lint rules that check literal values against constraints the build otherwise validates only at `tailor generate` / `tailor deploy` time: `valid-execution-policy-definition` (a workflow execution policy `name` or `key` outside the platform grammar), `valid-workflow-retry-policy` (a `retryPolicy` outside the platform limits, such as `initialBackoff` greater than `maxBackoff`), and `valid-resolver-permission` (a permission with no `permit: true` policy, or a condition that does not compare exactly one `user` operand to a string or a boolean). Values the rules cannot resolve to literals are left to the build. Enabled in newly scaffolded projects.

- [#2312](https://github.com/tailor-platform/sdk/pull/2312) [`c2ae1ac`](https://github.com/tailor-platform/sdk/commit/c2ae1acd688dd13df0a0d21d8d76ebc756415ab4) Thanks [@dqn](https://github.com/dqn)! - Add lint rules that catch workflow mistakes the build otherwise reports only at `tailor generate` / `tailor deploy` time: `valid-workflow-job-definition` (a `createWorkflowJob` `name` that is not a string literal or a `body` that is not an inline function), `no-job-start-outside-body` (a job's `.start()` called outside any job body in the same file), `no-direct-exec-job-function` (calling `execJobFunction` directly instead of `.start()`), and `valid-workflow-exports` (a `createWorkflow` result that is not the default export, or a job that is not a named export). Enabled in newly scaffolded projects.

## 0.2.3

### Patch Changes

- [#2138](https://github.com/tailor-platform/sdk/pull/2138) [`870c8cd`](https://github.com/tailor-platform/sdk/commit/870c8cdaa007adcbb8f565fe9b4d238d98c00e6d) Thanks [@dqn](https://github.com/dqn)! - Stop exporting internal declarations that were only used within their own module.

## 0.2.2

### Patch Changes

- [#2001](https://github.com/tailor-platform/sdk/pull/2001) [`ed82efa`](https://github.com/tailor-platform/sdk/commit/ed82efa17cf37e2e15caa4a81dce400f8216dad2) Thanks [@toiroakr](https://github.com/toiroakr)! - Build the package during install so the plugin entry point exists without running a separate build step first.

## 0.2.1

### Patch Changes

- [#1986](https://github.com/tailor-platform/sdk/pull/1986) [`d512707`](https://github.com/tailor-platform/sdk/commit/d512707767bdc5f8241188053a68415e7cae4f04) Thanks [@dqn](https://github.com/dqn)! - Keep exported rule names and plugin types aligned with the published lint rules.

## 0.2.0

### Minor Changes

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`152a2de`](https://github.com/tailor-platform/sdk/commit/152a2de92db8565791dc1ec8aab29f2a75c94913) Thanks [@toiroakr](https://github.com/toiroakr)! - Add a lint rule (`no-execute-script-arg-stringify`) that flags passing a `JSON.stringify(...)` result as `executeScript`'s `arg` option — `executeScript` serializes `arg` internally, so a pre-stringified value silently double-encodes at runtime. Enabled in newly scaffolded projects.

## 0.2.0-next.1

### Minor Changes

- [#1890](https://github.com/tailor-platform/sdk/pull/1890) [`9fdacdc`](https://github.com/tailor-platform/sdk/commit/9fdacdcbbdcb18f4b324470ac34ca70215f962aa) Thanks [@toiroakr](https://github.com/toiroakr)! - Add a lint rule (`no-execute-script-arg-stringify`) that flags passing a `JSON.stringify(...)` result as `executeScript`'s `arg` option — `executeScript` serializes `arg` internally, so a pre-stringified value silently double-encodes at runtime. Enabled in newly scaffolded projects.

## 0.1.0-next.0

### Minor Changes

- [#1737](https://github.com/tailor-platform/sdk/pull/1737) [`e349b9e`](https://github.com/tailor-platform/sdk/commit/e349b9e3d9c61f324f21dea92dd08055493a2c6d) Thanks [@dqn](https://github.com/dqn)! - Add lint rules that flag the external /api prefix in HTTP adapter path patterns and permission settings that grant access unconditionally, and enable them in newly scaffolded projects.

## 0.1.0

### Minor Changes

- [#1737](https://github.com/tailor-platform/sdk/pull/1737) [`e349b9e`](https://github.com/tailor-platform/sdk/commit/e349b9e3d9c61f324f21dea92dd08055493a2c6d) Thanks [@dqn](https://github.com/dqn)! - Add lint rules that flag the external /api prefix in HTTP adapter path patterns and permission settings that grant access unconditionally, and enable them in newly scaffolded projects.
