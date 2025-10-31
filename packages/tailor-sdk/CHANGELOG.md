# @tailor-platform/tailor-sdk

## 0.1.1

### Patch Changes

- [#647](https://github.com/tailor-platform/tailor-sdk/pull/647) [`b3f744b`](https://github.com/tailor-platform/tailor-sdk/commit/b3f744bd0db1751951389f013f6c2e4a6b97e743) Thanks [@remiposo](https://github.com/remiposo)! - Added show command

  Added a command to retrieve information about deployed applications. This can be used to obtain application endpoints after deployment in CI and similar environments.

  ```bash
  tailor-sdk apply --workspace-id <your-workspace-id>
  tailor-sdk show --workspace-id <your-workspace-id> -f json | jq -r '.url'
  ```

- [#649](https://github.com/tailor-platform/tailor-sdk/pull/649) [`46e0b7b`](https://github.com/tailor-platform/tailor-sdk/commit/46e0b7bf56243ea72ae24a477ef9b48779245d49) Thanks [@remiposo](https://github.com/remiposo)! - Added machineuser commands

  ```bash
  tailor-sdk machineuser list --workspace-id <your-workspace-id>
  tailor-sdk machineuser token <machine-user-name> --workspace-id <your-workspace-id>
  ```

## 0.1.0

### Minor Changes

- [#643](https://github.com/tailor-platform/tailor-sdk/pull/643) [`793a792`](https://github.com/tailor-platform/tailor-sdk/commit/793a7924bd6df4b5c23c5747e1935772ada0c152) Thanks [@toiroakr](https://github.com/toiroakr)! - feat!: remove assertNonNull option

  ## Breaking Changes

  ### Removed `assertNonNull` option from field definitions

  The `assertNonNull` option has been removed from field configurations. This option was previously used with `.hooks()` to ensure fields always return non-null values in resolver outputs, even when marked as `optional: true`.

  **Before:**

  ```typescript
  const model = db.type("Model", {
    field: db.string({ optional: true, assertNonNull: true }).hooks({
      create: () => "default-value",
    }),
  });
  ```

  **After:**

  ```typescript
  const model = db.type("Model", {
    field: db.string().hooks({
      create: () => "default-value",
    }),
  });
  ```

  When you use `.hooks()` with a `create` hook that always provides a value, the field should be defined as non-nullable (without `optional: true`).

  ### Serial fields must be non-nullable

  The `.serial()` method can now only be used on non-nullable fields. If you were using `serial()` with `optional: true`, you must remove the `optional: true` option.

  **Before:**

  ```typescript
  const invoice = db.type("Invoice", {
    invoiceNumber: db.string({ optional: true }).serial({
      start: 1000,
      format: "INV-%05d",
    }),
  });
  ```

  **After:**

  ```typescript
  const invoice = db.type("Invoice", {
    invoiceNumber: db.string().serial({
      start: 1000,
      format: "INV-%05d",
    }),
  });
  ```

  ### Hook function argument types

  The `data` parameter in hook functions now treats all fields as optional (`T | null | undefined`), regardless of whether they are required in the schema.

  **Before:**

  ```typescript
  fullAddress: db.string({ optional: true }).hooks({
    create: ({ data }) => `〒${data.postalCode} ${data.address} ${data.city}`,
    // data.postalCode was guaranteed to be present
  });
  ```

  **After:**

  ```typescript
  fullAddress: db.string({ optional: true }).hooks({
    create: ({ data }) =>
      `〒${data.postalCode ?? ""} ${data.address ?? ""} ${data.city ?? ""}`,
    // All fields may be undefined - use ?? or add null checks
  });
  ```

## 0.0.99

### Patch Changes

- [#641](https://github.com/tailor-platform/tailor-sdk/pull/641) [`fd8b630`](https://github.com/tailor-platform/tailor-sdk/commit/fd8b630a7c92263ee377c8bc2a83f76c338d78e4) Thanks [@remiposo](https://github.com/remiposo)! - Rename workspace destory command

- [#645](https://github.com/tailor-platform/tailor-sdk/pull/645) [`738a904`](https://github.com/tailor-platform/tailor-sdk/commit/738a904d77e5e3f1a65543f2859b0d7f543b2437) Thanks [@remiposo](https://github.com/remiposo)! - Changed to display ID of created workspace

  Made it easier to retrieve the ID of workspaces created with `tailor-sdk workspace create`.
  This is useful for cases where you want to apply after creating a workspace in CI environments and similar scenarios.

  ```bash
  tailor-sdk workspace create --name "my-workspace" --region asia-northeast --format json | jq -r '.id'
  ```

## 0.0.98

### Patch Changes

- [#639](https://github.com/tailor-platform/tailor-sdk/pull/639) [`07ef858`](https://github.com/tailor-platform/tailor-sdk/commit/07ef85825b51e4a83ab437bad4148d1b33d7a0f1) Thanks [@remiposo](https://github.com/remiposo)! - Adjusted the output format of user commands

## 0.0.97

### Patch Changes

- [#636](https://github.com/tailor-platform/tailor-sdk/pull/636) [`ffc1ef7`](https://github.com/tailor-platform/tailor-sdk/commit/ffc1ef74e02e9bcf711431709088d1ff2997dd65) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: export generator types

## 0.0.96

### Patch Changes

- [#626](https://github.com/tailor-platform/tailor-sdk/pull/626) [`b176af1`](https://github.com/tailor-platform/tailor-sdk/commit/b176af18c0ab23a4832517921b233d7206a2e6e6) Thanks [@remiposo](https://github.com/remiposo)! - Changed how workspaceID and authentication credentials are specified

  Previously, authentication credentials were stored in the tailorctl config file (`~/.tailorctl/config`), but we've changed to store them in a new format file (`~/.config/tailor-platform/config.yaml`). When you run SDK commands, migration happens automatically, so generally no user action is required.
  We've also changed how workspaceID is specified during apply. Previously, you specified workspaceID in the configuration file (`tailor.config.ts`), but we've removed this. Instead, please specify `--workspace-id` flag or `TAILOR_PLATFORM_WORKSPACE_ID` environment variable when running the apply command.

  ```bash
  tailor-sdk apply --workspace-id <your-workspace-id>
  # or
  TAILOR_PLATFORM_WORKSPACE_ID=<your-workspace-id> tailor-sdk apply
  ```

- [#634](https://github.com/tailor-platform/tailor-sdk/pull/634) [`9b86782`](https://github.com/tailor-platform/tailor-sdk/commit/9b8678220375725f0f872deb37ed60a12a1ba124) Thanks [@remiposo](https://github.com/remiposo)! - Added user and profile management commands

  These commands are primarily for making it easier to manage multiple Tailor Platform accounts. The configured content is saved in `.config/tailor-platform/config.yaml` along with authentication credentials.

  ```bash
  # Login to Tailor Platform (add a new user)
  tailor-sdk login

  # Create a new profile
  tailor-sdk profile create <profile-name> --user <user-email> --workspace-id <workspace-id>

  # Apply using a specific profile (no need to specify workspace ID or user credentials)
  tailor-sdk apply --profile <profile-name>
  # or
  TAILOR_PLATFORM_PROFILE=<profile-name> tailor-sdk apply
  ```

## 0.0.95

### Patch Changes

- [#627](https://github.com/tailor-platform/tailor-sdk/pull/627) [`6582379`](https://github.com/tailor-platform/tailor-sdk/commit/6582379d81c7d5469e27d672c9313a1cb9b81c50) Thanks [@toiroakr](https://github.com/toiroakr)! - feat!: unnest resolver input type

  ## Breaking Changes

  The structure of resolver input arguments in GraphQL queries/mutations has changed. Previously, all input fields were nested under a single `input` argument, but now they are passed as flat, top-level arguments.

  ### Migration Guide

  You have two migration options:

  #### Option 1: Update GraphQL queries

  Update your GraphQL queries to pass arguments as flat parameters.

  **Before:**

  ```gql
  query {
    add(input: { a: 1, b: 2 }) {
      result
    }
  }
  ```

  **After:**

  ```gql
  query {
    add(a: 1, b: 2) {
      result
    }
  }
  ```

  #### Option 2: Wrap input type to maintain existing GraphQL API

  If you need to maintain backward compatibility with existing GraphQL queries, wrap your input type in a single `input` field:

  ```typescript
  createResolver({
    name: "add",
    operation: "query",
    input: t.type({
      input: t.object({
        a: t.int(),
        b: t.int(),
      }),
    }),
    body: (context) => {
      return { result: context.input.input.a + context.input.input.b };
    },
    output: t.type({ result: t.int() }),
  });
  ```

  This way, your existing GraphQL queries with `add(input: { a: 1, b: 2 })` will continue to work.

## 0.0.94

### Patch Changes

- [#623](https://github.com/tailor-platform/tailor-sdk/pull/623) [`452a5d7`](https://github.com/tailor-platform/tailor-sdk/commit/452a5d7904d1b04b26638fce337d865b358f1f5b) Thanks [@remiposo](https://github.com/remiposo)! - Made all commands accept the --env-file flag

- [#621](https://github.com/tailor-platform/tailor-sdk/pull/621) [`6291874`](https://github.com/tailor-platform/tailor-sdk/commit/629187471b0189331445ad179f9cfae91902a0a4) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: validate resolver input

- [#625](https://github.com/tailor-platform/tailor-sdk/pull/625) [`d08ec14`](https://github.com/tailor-platform/tailor-sdk/commit/d08ec14886f91a71c6358d58db7e0f16d3f06ebe) Thanks [@remiposo](https://github.com/remiposo)! - Display stack trace only when the --verbose flag is specified

## 0.0.93

### Patch Changes

- [#617](https://github.com/tailor-platform/tailor-sdk/pull/617) [`d45fe83`](https://github.com/tailor-platform/tailor-sdk/commit/d45fe834398426c94e5239e9bc94a5736df87016) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add tailordb.Client mock for apply

- [#613](https://github.com/tailor-platform/tailor-sdk/pull/613) [`62c8fe3`](https://github.com/tailor-platform/tailor-sdk/commit/62c8fe35e50e14778db57ccd8e517b1b44dbdfbd) Thanks [@remiposo](https://github.com/remiposo)! - chore: Update documentation structure

## 0.0.92

### Patch Changes

- [#607](https://github.com/tailor-platform/tailor-sdk/pull/607) [`ab2cadd`](https://github.com/tailor-platform/tailor-sdk/commit/ab2cadd9f92ac488ae1963d0768e2ca96ec66e0f) Thanks [@toiroakr](https://github.com/toiroakr)! - refactor: move inflection to out of configuration

## 0.0.91

### Patch Changes

- [#601](https://github.com/tailor-platform/tailor-sdk/pull/601) [`4f2803a`](https://github.com/tailor-platform/tailor-sdk/commit/4f2803a1ab00a28d466f86764955656e8ea23829) Thanks [@remiposo](https://github.com/remiposo)! - Add workspace management comand

- [#606](https://github.com/tailor-platform/tailor-sdk/pull/606) [`f1be4bf`](https://github.com/tailor-platform/tailor-sdk/commit/f1be4bf0f324e5ea1896fa4c1a9415b48eb0b134) Thanks [@toiroakr](https://github.com/toiroakr)! - feat!: kysely-db generator renewal

- [#604](https://github.com/tailor-platform/tailor-sdk/pull/604) [`491626b`](https://github.com/tailor-platform/tailor-sdk/commit/491626b65bbde4bfebe45b542ef3bcea7b13fde1) Thanks [@remiposo](https://github.com/remiposo)! - Add login/logout command

## 0.0.90

### Patch Changes

- [#598](https://github.com/tailor-platform/tailor-sdk/pull/598) [`7b2ffaf`](https://github.com/tailor-platform/tailor-sdk/commit/7b2ffaf47b8f324bf489c7734f566be320dd69cc) Thanks [@toiroakr](https://github.com/toiroakr)! - chore: improve url schema

- [#600](https://github.com/tailor-platform/tailor-sdk/pull/600) [`ec16341`](https://github.com/tailor-platform/tailor-sdk/commit/ec16341c0d5aaf5c786f03216ab5642ff4fe7683) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: remove callbackUrl from defineStaticWebsite

## 0.0.89

### Patch Changes

- [#597](https://github.com/tailor-platform/tailor-sdk/pull/597) [`36ea41c`](https://github.com/tailor-platform/tailor-sdk/commit/36ea41c4fea9c4d6ff4b5b1d7fd8582ceae09c89) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: stricter define function types

- [#595](https://github.com/tailor-platform/tailor-sdk/pull/595) [`2d3f019`](https://github.com/tailor-platform/tailor-sdk/commit/2d3f01977bcf271a8874fc5f6d273d6c1c1561f8) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add defineIdp

## 0.0.88

### Patch Changes

- [#594](https://github.com/tailor-platform/tailor-sdk/pull/594) [`ac244cd`](https://github.com/tailor-platform/tailor-sdk/commit/ac244cd7769cfe92a962ea48918559dd403991df) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add defineStaticWebsite

- [#589](https://github.com/tailor-platform/tailor-sdk/pull/589) [`5195548`](https://github.com/tailor-platform/tailor-sdk/commit/5195548158aa61fe7b33a75a4812d5345adde3da) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: type guard for workspaceId

## 0.0.87

### Patch Changes

- [#585](https://github.com/tailor-platform/tailor-sdk/pull/585) [`3f13d44`](https://github.com/tailor-platform/tailor-sdk/commit/3f13d4463047862cfe438f71d87629e49320c6eb) Thanks [@toiroakr](https://github.com/toiroakr)! - chore: update resolver schema

## 0.0.86

### Patch Changes

- [#575](https://github.com/tailor-platform/tailor-sdk/pull/575) [`0d64a86`](https://github.com/tailor-platform/tailor-sdk/commit/0d64a869766049ffb8462dace6222db53e23dbce) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: strict resolver output type

## 0.0.85

### Patch Changes

- [#573](https://github.com/tailor-platform/tailor-sdk/pull/573) [`11cae3e`](https://github.com/tailor-platform/tailor-sdk/commit/11cae3e8aa89fc8d71993a0bb9e28c02123f185f) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: generated type reference

## 0.0.84

### Patch Changes

- [#570](https://github.com/tailor-platform/tailor-sdk/pull/570) [`20b760e`](https://github.com/tailor-platform/tailor-sdk/commit/20b760e9b3f85e200ed9ec7d1bef73efbc2f1299) Thanks [@remiposo](https://github.com/remiposo)! - Use type import in kysely generator

## 0.0.83

### Patch Changes

- [#559](https://github.com/tailor-platform/tailor-sdk/pull/559) [`ebcb667`](https://github.com/tailor-platform/tailor-sdk/commit/ebcb6674bbc1fc3ac819bb0e2930255a660ade1b) Thanks [@toiroakr](https://github.com/toiroakr)! - Remove steps from resolver

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
