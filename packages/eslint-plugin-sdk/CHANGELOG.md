# @tailor-platform/eslint-plugin-sdk

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
