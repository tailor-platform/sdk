# @tailor-platform/tailor-sdk

## 0.0.82

### Patch Changes

- [#563](https://github.com/tailor-platform/tailor-sdk/pull/563) [`14333f9`](https://github.com/tailor-platform/tailor-sdk/commit/14333f9eac7eb53f4856388c367b8e00e16e86de) Thanks [@remiposo](https://github.com/remiposo)! - Fixed to set more appropriate GraphQL types in pipeline input / output

- [#565](https://github.com/tailor-platform/tailor-sdk/pull/565) [`dbaa31e`](https://github.com/tailor-platform/tailor-sdk/commit/dbaa31e74522fd34dde3bd3e3b71b4190cfdf514) Thanks [@remiposo](https://github.com/remiposo)! - fix: ensure the vault and secret exist

- [#558](https://github.com/tailor-platform/tailor-sdk/pull/558) [`ce877a1`](https://github.com/tailor-platform/tailor-sdk/commit/ce877a1ff421e8f3f902d3902cfa66b3ea2bae51) Thanks [@remiposo](https://github.com/remiposo)! - feat: Remove client from exectutor args when dbNamespace is not specified

## 0.0.81

### Patch Changes

- [#552](https://github.com/tailor-platform/tailor-sdk/pull/552) [`c9f10c5`](https://github.com/tailor-platform/tailor-sdk/commit/c9f10c5ca80ebb1e282b3639e2b7a24b4aefba7d) Thanks [@toiroakr](https://github.com/toiroakr)! - Simplified permission definitions with automatic type generation

## 0.0.80

### Patch Changes

- [#548](https://github.com/tailor-platform/tailor-sdk/pull/548) [`ce834be`](https://github.com/tailor-platform/tailor-sdk/commit/ce834bec7c7d80a3f56a520339a569fef9225888) Thanks [@toiroakr](https://github.com/toiroakr)! - kysely-type generator: support assertNonNull

## 0.0.79

### Patch Changes

- [#545](https://github.com/tailor-platform/tailor-sdk/pull/545) [`e82a038`](https://github.com/tailor-platform/tailor-sdk/commit/e82a038b022ebf58dd377a247b7bdf1fa608701c) Thanks [@remiposo](https://github.com/remiposo)! - chore: Add LICENSE

## 0.0.78

### Patch Changes

- [#535](https://github.com/tailor-platform/tailor-sdk/pull/535) [`fd011ba`](https://github.com/tailor-platform/tailor-sdk/commit/fd011ba2a0c3719d87a3e5434f86aacc11a52ba8) Thanks [@remiposo](https://github.com/remiposo)! - fix: remove unusable variables from executeFunction/executeJobFunction

- [#527](https://github.com/tailor-platform/tailor-sdk/pull/527) [`f9eae29`](https://github.com/tailor-platform/tailor-sdk/commit/f9eae29e80238e9783e831a7ec02c5a3583d03b6) Thanks [@remiposo](https://github.com/remiposo)! - refactor: Executor service

## 0.0.77

### Patch Changes

- [#524](https://github.com/tailor-platform/tailor-sdk/pull/524) [`5f0272a`](https://github.com/tailor-platform/tailor-sdk/commit/5f0272a35b6ab24b69f781123477bc42e50e02cd) Thanks [@remiposo](https://github.com/remiposo)! - test: add incomingWebhookTrigger test cases

## 0.0.76

### Patch Changes

- [#521](https://github.com/tailor-platform/tailor-sdk/pull/521) [`f380645`](https://github.com/tailor-platform/tailor-sdk/commit/f3806455815ed4efd80cfe11428bd7862c77b401) Thanks [@remiposo](https://github.com/remiposo)! - chore: Update CHANGELOG.md format

## 0.0.75

### Patch Changes

- dca9f5b: Separate generator config from defineConfig

## 0.0.74

### Patch Changes

- e41001c: refactor: Remove any related to relation
- c1a972a: fix: Fixed the issue where fn arguments became never for scheduleTrigger

## 0.0.73

### Patch Changes

- 9be7344: Change defineConfig to be tailored specifically for a single app
- 6d5b956: Fixed deps so that the cron type for schedule triggers works properly

## 0.0.72

### Patch Changes

- ea06320: Fixed the issue where relations couldn't be set to fields other than `id`

  Fixed deployment errors caused by always trying to set foreign keys to `id`, and now foreign keys are set to the correct fields.

## 0.0.71

### Patch Changes

- 9f7a52c: Add CHANGELOG.md
