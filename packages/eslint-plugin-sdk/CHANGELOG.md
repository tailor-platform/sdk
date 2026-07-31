# @tailor-platform/eslint-plugin-sdk

## 0.2.0

### Minor Changes

- [#1890](https://github.com/tailor-platform/sdk/pull/1890) [`9fdacdc`](https://github.com/tailor-platform/sdk/commit/9fdacdcbbdcb18f4b324470ac34ca70215f962aa) Thanks [@toiroakr](https://github.com/toiroakr)! - Add a lint rule (`no-execute-script-arg-stringify`) that flags passing a `JSON.stringify(...)` result as `executeScript`'s `arg` option — `executeScript` serializes `arg` internally, so a pre-stringified value silently double-encodes at runtime. Enabled in newly scaffolded projects.

## 0.2.0-next.1

### Minor Changes

- [#1890](https://github.com/tailor-platform/sdk/pull/1890) [`9fdacdc`](https://github.com/tailor-platform/sdk/commit/9fdacdcbbdcb18f4b324470ac34ca70215f962aa) Thanks [@toiroakr](https://github.com/toiroakr)! - Add a lint rule (`no-execute-script-arg-stringify`) that flags passing a `JSON.stringify(...)` result as `executeScript`'s `arg` option — `executeScript` serializes `arg` internally, so a pre-stringified value silently double-encodes at runtime. Enabled in newly scaffolded projects.

## 0.1.0-next.0

### Minor Changes

- [#1737](https://github.com/tailor-platform/sdk/pull/1737) [`e349b9e`](https://github.com/tailor-platform/sdk/commit/e349b9e3d9c61f324f21dea92dd08055493a2c6d) Thanks [@dqn](https://github.com/dqn)! - Add lint rules that flag the external /api prefix in HTTP adapter path patterns and permission settings that grant access unconditionally, and enable them in newly scaffolded projects.

## 0.1.0

### Minor Changes

- [#1737](https://github.com/tailor-platform/sdk/pull/1737) [`e349b9e`](https://github.com/tailor-platform/sdk/commit/e349b9e3d9c61f324f21dea92dd08055493a2c6d) Thanks [@dqn](https://github.com/dqn)! - Add lint rules that flag the external /api prefix in HTTP adapter path patterns and permission settings that grant access unconditionally, and enable them in newly scaffolded projects.
