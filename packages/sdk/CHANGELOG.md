# @tailor-platform/sdk

## 0.12.1

### Patch Changes

- [#94](https://github.com/tailor-platform/sdk/pull/94) [`7262efa`](https://github.com/tailor-platform/sdk/commit/7262efa4a4783e10003b0b46208e7ae22043cdc9) Thanks [@remiposo](https://github.com/remiposo)! - Added oauth2client commands

  Added commands to retrieve OAuth2 client credentials (clientId and clientSecret) after deployment.
  For security, clientSecret is only shown in the `get` command.

  ```sh
  tailor-sdk oauth2client list
  tailor-sdk oauth2client get <name>
  ```

- [#95](https://github.com/tailor-platform/sdk/pull/95) [`e394176`](https://github.com/tailor-platform/sdk/commit/e3941762da3a5aca68ab63f214c32c4f6fd6a582) Thanks [@toiroakr](https://github.com/toiroakr)! - chore: improve user-defined types

## 0.12.0

### Minor Changes

- [#86](https://github.com/tailor-platform/sdk/pull/86) [`20a816e`](https://github.com/tailor-platform/sdk/commit/20a816e149c1ff14a7f505accf69216da6d5e245) Thanks [@toiroakr](https://github.com/toiroakr)! - Improve seed generator with Windows compatibility and IdP user support
  - Generate `exec.mjs` instead of `exec.sh` for cross-platform compatibility
  - Add IdP user seed generation (`_User` entity) when `BuiltInIdP` is configured
    - Generates `_User.schema.ts`, `_User.graphql`, `_User.json` mapping files
    - Includes foreign key to user profile type and unique index on `name` field
    - Automatically sets dependency order (User → \_User)

### Patch Changes

- [#70](https://github.com/tailor-platform/sdk/pull/70) [`94e2f1c`](https://github.com/tailor-platform/sdk/commit/94e2f1cf9036bd69c6f691c6536841a693afe616) Thanks [@riku99](https://github.com/riku99)! - Simplify generator architecture to single-application model

## 0.11.3

### Patch Changes

- [#75](https://github.com/tailor-platform/sdk/pull/75) [`d05e581`](https://github.com/tailor-platform/sdk/commit/d05e58142c3741c35a731ec1fe770a24d7aa3377) Thanks [@riku99](https://github.com/riku99)! - Fix build script to work on Windows by adding cross-env

## 0.11.2

### Patch Changes

- [#59](https://github.com/tailor-platform/sdk/pull/59) [`c1e926d`](https://github.com/tailor-platform/sdk/commit/c1e926d61c8d2f73b36133f8b8c67f7617455d80) Thanks [@remiposo](https://github.com/remiposo)! - Added the remove command

  Added the remove command to delete all managed resources.

  ```bash
  tailor-sdk remove [options]
  ```

  **Options:**
  - `-w, --workspace-id` - ID of the workspace to remove resources from
  - `-p, --profile` - Workspace profile to use
  - `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
  - `-y, --yes` - Skip confirmation prompt

## 0.11.1

### Patch Changes

- [#55](https://github.com/tailor-platform/sdk/pull/55) [`c61651e`](https://github.com/tailor-platform/sdk/commit/c61651ef0f7bf43f4bae7fe3bd75aac539d0c12f) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Fix unportable type error that `createResolver` raises in bundling.

  Bundling files that export the return values of `createResolver` function has been causing `he inferred type of "X" cannot be named without a reference to "Y". This is likely not portable. A type annotation is necessary.` error. It was caused the return type of `Executor` type that is used internally by `createResolver` function is not exported.

- [#58](https://github.com/tailor-platform/sdk/pull/58) [`e2fc8c0`](https://github.com/tailor-platform/sdk/commit/e2fc8c0d3ce38b6270f319879ec05f1da8f9fb6c) Thanks [@toiroakr](https://github.com/toiroakr)! - chore: remove warning message

## 0.11.0

### Minor Changes

- [#50](https://github.com/tailor-platform/sdk/pull/50) [`7c325c7`](https://github.com/tailor-platform/sdk/commit/7c325c7b6fc1d9d07585a960d1b64994eafb7fc4) Thanks [@toiroakr](https://github.com/toiroakr)! - Add workflow service support
  - Add `createWorkflow()` and `createWorkflowJob()` APIs for orchestrating multiple jobs
  - Support job dependencies via `deps` array with type-safe access (hyphen names converted to underscores)
  - Workflow must be default exported, all jobs must be named exports

### Patch Changes

- [#26](https://github.com/tailor-platform/sdk/pull/26) [`7e6701b`](https://github.com/tailor-platform/sdk/commit/7e6701b9d9c8b3df10d4e4e6788aadd28dd69d42) Thanks [@riku99](https://github.com/riku99)! - Add automated bundle size tracking with octocov

## 0.10.4

### Patch Changes

- [#49](https://github.com/tailor-platform/sdk/pull/49) [`8fef369`](https://github.com/tailor-platform/sdk/commit/8fef369ab65ea34d85aef24a38ac3d0124626a41) Thanks [@remiposo](https://github.com/remiposo)! - Use Controlplane OAuth2 client for login/logout

## 0.10.3

### Patch Changes

- [#40](https://github.com/tailor-platform/sdk/pull/40) [`314543f`](https://github.com/tailor-platform/sdk/commit/314543fc8edeefff944f024a52a89142646329b4) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Export types that `db.type` function uses internally.

  This enables users to bundle Tailor DB type definition as an independent package without using forced type assertion using `any`.

## 0.10.2

### Patch Changes

- [#45](https://github.com/tailor-platform/sdk/pull/45) [`efba21f`](https://github.com/tailor-platform/sdk/commit/efba21f0991a3ee9068684d13407dbdb0b19c425) Thanks [@remiposo](https://github.com/remiposo)! - Callback to localhost on WSL environments

  Adjusted the redirect_uri value to fix an issue where login fails on WSL environments.

## 0.10.1

### Patch Changes

- [#34](https://github.com/tailor-platform/sdk/pull/34) [`ed71900`](https://github.com/tailor-platform/sdk/commit/ed719007420794d50d26eb2a3f1f77c5bb3e60a9) Thanks [@remiposo](https://github.com/remiposo)! - Reference external resources

  You can now add resources managed by Terraform or other SDK projects to your application's subgraph for shared use.
  In this case, the resources themselves are not deployed.

  ```typescript
  defineConfig({
    name: "ref-app",
    db: {
      "shared-db": { external: true },
    },
    resolver: { "shared-resolver": { external: true } },
    auth: { name: "shared-auth", external: true },
    idp: [{ name: "shared-idp", external: true }],
  });
  ```

- [#36](https://github.com/tailor-platform/sdk/pull/36) [`00701da`](https://github.com/tailor-platform/sdk/commit/00701da46ceb9624b58c123fcf0ff19e4dc513f5) Thanks [@remiposo](https://github.com/remiposo)! - Allow specifying the path where types are generated

  By default, types are generated inside `node_modules/@tailor-platform/sdk` based on env and attribute settings, but you can now change the path with `TAILOR_PLATFORM_SDK_TYPE_PATH`.
  This is primarily an option for developers, preventing type definitions from being overridden when working with multiple SDK projects simultaneously.

## 0.10.0

### Minor Changes

- [#25](https://github.com/tailor-platform/sdk/pull/25) [`50069ae`](https://github.com/tailor-platform/sdk/commit/50069aeebeb1c0e09cf66f660367cd26cc565f29) Thanks [@haru0017](https://github.com/haru0017)! - Define environment variables in `defineConfig()` and access them in resolvers and executors via the `env` parameter.

  ```typescript
  export default defineConfig({
    name: "my-app",
    env: { logLevel: "debug", cacheTtl: 3600 },
  });

  // Access in resolver
  body: ({ input, env }) => {
    // env.logLevel, env.cacheTtl available with full type safety
  };
  ```

### Patch Changes

- [#33](https://github.com/tailor-platform/sdk/pull/33) [`1f73bd1`](https://github.com/tailor-platform/sdk/commit/1f73bd1d7abaa0a55358086a0d1b7f7c00cccbf3) Thanks [@remiposo](https://github.com/remiposo)! - Confirm important resource deletion

  Added a confirmation prompt when attempting to delete resources that would result in data loss (tailordb and staticwebsite).
  This can be skipped with the `--yes` flag.

- [#31](https://github.com/tailor-platform/sdk/pull/31) [`5fc5594`](https://github.com/tailor-platform/sdk/commit/5fc5594e0b7b1cdf72dadce505aa58a8ae2e5f4a) Thanks [@remiposo](https://github.com/remiposo)! - Make appName for the Executor's GraphQL target optional

  The default value is its own application name.

## 0.9.0

### Minor Changes

- [#16](https://github.com/tailor-platform/sdk/pull/16) [`7bb9d3a`](https://github.com/tailor-platform/sdk/commit/7bb9d3ae0b1568075867ddf2c2027a636037ee09) Thanks [@remiposo](https://github.com/remiposo)! - Set labels for resource management

  Previously, apply operations targeted all resources in the workspace, so any resources not listed in the config were deleted during apply. This made it practically impossible to create resources managed by Terraform or other SDK applications in the same workspace.

  With this change, resources generated by the SDK are now automatically labeled. By only targeting resources with appropriate labels for deletion, coexistence with resources managed elsewhere is now possible. While this label is currently internal, it should become visible in the console in the future.

  **Breaking Changes:**

  Existing applications are not labeled, so the following warning will appear when you apply for the first time after updating.
  Please confirm or pass the `--yes` flag.

  ```
  WARN  Unmanaged resources detected:

    Resources:
      • TailorDB service "my-db"
      • Auth service "my-auth"
      ...

    These resources are not managed by any application.

  ❯ Add these resources to "my-app"?
  ○ Yes / ● No
  ```

### Patch Changes

- [#16](https://github.com/tailor-platform/sdk/pull/16) [`7bb9d3a`](https://github.com/tailor-platform/sdk/commit/7bb9d3ae0b1568075867ddf2c2027a636037ee09) Thanks [@remiposo](https://github.com/remiposo)! - Load resolver and executor files only once

  By reusing the results when files have already been loaded, file loading logs are no longer displayed multiple times during apply.

## 0.8.6

### Patch Changes

- [#24](https://github.com/tailor-platform/sdk/pull/24) [`ffa71fe`](https://github.com/tailor-platform/sdk/commit/ffa71feba26b36be84292dbaaadc0d2a37dc6b96) Thanks [@riku99](https://github.com/riku99)! - Fix generator bugs with multiple TailorDB namespaces and refactor to object-based data passing

## 0.8.5

### Patch Changes

- [#22](https://github.com/tailor-platform/sdk/pull/22) [`a0bf525`](https://github.com/tailor-platform/sdk/commit/a0bf5259af8a87415d0d731c7995c2612ccc1046) Thanks [@remiposo](https://github.com/remiposo)! - Force excess property checking in defineConfig

## 0.8.4

### Patch Changes

- [#19](https://github.com/tailor-platform/sdk/pull/19) [`58e3486`](https://github.com/tailor-platform/sdk/commit/58e34866f5af9027c05d80f9164ffba8b1d1ff55) Thanks [@toiroakr](https://github.com/toiroakr)! - chore: remove unused Serial type and track utility type usage in Kysely generator

## 0.8.3

### Patch Changes

- [#17](https://github.com/tailor-platform/sdk/pull/17) [`4705799`](https://github.com/tailor-platform/sdk/commit/47057990e183fb9eea132d8802d3d3ec65f07487) Thanks [@remiposo](https://github.com/remiposo)! - Fixed an issue where resolvers returning scalar values didn't work properly

## 0.8.2

### Patch Changes

- [#12](https://github.com/tailor-platform/sdk/pull/12) [`d861a04`](https://github.com/tailor-platform/sdk/commit/d861a0448081566cd7e9ae1ba7eb837f1634c6a9) Thanks [@riku99](https://github.com/riku99)! - Add enum-constants and file-utils built-in generators for type-safe code generation

## 0.8.1

### Patch Changes

- [#11](https://github.com/tailor-platform/sdk/pull/11) [`64436f0`](https://github.com/tailor-platform/sdk/commit/64436f00d936631a239c8229c1c94be4c8230ece) Thanks [@haru0017](https://github.com/haru0017)! - Make `sp_cert_base64` and `sp_key_base64` optional.

## 0.8.0

### Minor Changes

- [#3](https://github.com/tailor-platform/sdk/pull/3) [`b9c3dba`](https://github.com/tailor-platform/sdk/commit/b9c3dbaa4b1df4beb27f5b1da7fe23a83a278637) Thanks [@toiroakr](https://github.com/toiroakr)! - chore!: rename tailor-sdk to sdk

## 0.7.6

### Patch Changes

- [#730](https://github.com/tailor-platform/sdk/pull/730) [`c737903`](https://github.com/tailor-platform/sdk/commit/c73790316fb70924cfe47ea447782648691eb78e) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: generate watch mode

## 0.7.5

### Patch Changes

- [#723](https://github.com/tailor-platform/sdk/pull/723) [`c9233ea`](https://github.com/tailor-platform/sdk/commit/c9233eae05a0c6d09bfb02891f283b278119290c) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add tailordb command with truncate functionality

  see `tailor-sdk tailordb --help`

## 0.7.4

### Patch Changes

- [#721](https://github.com/tailor-platform/sdk/pull/721) [`d83ca38`](https://github.com/tailor-platform/sdk/commit/d83ca38cd9e3f40cbecd342fad6c7d36ece68d5d) Thanks [@remiposo](https://github.com/remiposo)! - Improve Built-in IdP not found error message

## 0.7.3

### Patch Changes

- [#718](https://github.com/tailor-platform/sdk/pull/718) [`857811e`](https://github.com/tailor-platform/sdk/commit/857811e3d57b3b86b45bfe3bb0f9a8b231ff28f5) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add personal access token management commands

  see `tailor-sdk user pat --help`

## 0.7.2

### Patch Changes

- [#716](https://github.com/tailor-platform/sdk/pull/716) [`9e094fa`](https://github.com/tailor-platform/sdk/commit/9e094fa6831837063f4ea62722882c26d31dd256) Thanks [@remiposo](https://github.com/remiposo)! - Apply concurrently

## 0.7.1

### Patch Changes

- [#713](https://github.com/tailor-platform/sdk/pull/713) [`b1c9e3c`](https://github.com/tailor-platform/sdk/commit/b1c9e3c252d1bbc86701255b92877ba3344ba102) Thanks [@remiposo](https://github.com/remiposo)! - Also accept simple objects instead of `t.object()` in resolver output

  Previously, you had to always use `t.object()`, but now you can specify output in the same format as input.

  ```typescript
  // OK
  createResolver({
    output: t.object({
      name: t.string(),
      age: t.int(),
    }),
  });

  // Also OK (same meaning as above)
  createResolver({
    output: {
      name: t.string(),
      age: t.int(),
    },
  });
  ```

## 0.7.0

### Minor Changes

- [#706](https://github.com/tailor-platform/sdk/pull/706) [`6942868`](https://github.com/tailor-platform/sdk/commit/69428681170f6a4a6ec44bdc630be1da456106f0) Thanks [@remiposo](https://github.com/remiposo)! - Changed the interface for `apply` / `generate`

  **Breaking Changes:**

  When calling `apply` / `generate` as functions, specifying `configPath` as the first argument was mandatory, but We've made it optional to align with other commands.

  before:

  ```ts
  import { apply } from "@tailor-platform/sdk/cli";

  // default
  await apply("tailor.config.ts");
  // custom path
  await apply("./path/to/tailor.config.ts");
  ```

  after:

  ```ts
  import { apply } from "@tailor-platform/sdk/cli";

  // default
  await apply();
  // custom path
  await apply({ configPath: "./path/to/tailor.config.ts" });
  ```

## 0.6.2

### Patch Changes

- [#702](https://github.com/tailor-platform/sdk/pull/702) [`6a4f2b1`](https://github.com/tailor-platform/sdk/commit/6a4f2b174cfaec0e0f76380a4f5855d7b275b916) Thanks [@remiposo](https://github.com/remiposo)! - Apply the default value only when ignores is not specified

- [#700](https://github.com/tailor-platform/sdk/pull/700) [`3ab0b98`](https://github.com/tailor-platform/sdk/commit/3ab0b9820fed04d1b19c38c70d938bca79c8ba1b) Thanks [@remiposo](https://github.com/remiposo)! - Exported some commands as functions

  Exported `tailor-sdk workspace create|delete|list` and `tailor-sdk machineuser list|token` as functions. The allowed options are the same except for CLI-specific ones (e.g., `--format`, `--yes`)

  ```typescript
  import { machineUserToken } from "@tailor-platform/sdk/cli";

  const tokens = await machineUserToken({ name: "admin" });
  ```

## 0.6.1

### Patch Changes

- [#698](https://github.com/tailor-platform/sdk/pull/698) [`c781753`](https://github.com/tailor-platform/sdk/commit/c781753971a8b3443bce1e03e9d629ce9667e5fa) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: time regex

## 0.6.0

### Minor Changes

- [#690](https://github.com/tailor-platform/sdk/pull/690) [`790eb46`](https://github.com/tailor-platform/sdk/commit/790eb46d8830c15e4d76610187da5acd74aad172) Thanks [@remiposo](https://github.com/remiposo)! - Deletion and renaming of builtin generators

  **Breaking Changes:**

  Renamed `@tailor/kysely-type` to `@tailor-platform/kysely-type`. Also deleted `@tailor/db-type`.
  If there are any use cases where you're already using `@tailor/db-type` and its deletion would be problematic, please let me know.
  A type error occurs with `defineGenerators()`, so please change the configuration to resolve it.

  before:

  ```typescript
  defineGenerators(
    ["@tailor/kysely-type", { distPath: "./generated/kysely.ts" }],
    ["@tailor/db-type", { distPath: "./generated/db.ts" }],
  );
  ```

  after:

  ```typescript
  defineGenerators([
    "@tailor-platform/kysely-type",
    { distPath: "./generated/kysely.ts" },
  ]);
  ```

## 0.5.6

### Patch Changes

- [#691](https://github.com/tailor-platform/sdk/pull/691) [`4e949b6`](https://github.com/tailor-platform/sdk/commit/4e949b67291ce8775c189a793a99f768ab8904db) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add seed generator

  Added `@tailor-platform/seed` generator that automatically generates seed data files from TailorDB type definitions. This generator creates:
  - GraphQL Ingest mapping files (`mappings/*.json`) and GraphQL files for bulk data loading via [gql-ingest](https://github.com/jackchuka/gql-ingest)
  - lines-db schema files (`data/*.schema.ts`) for validation via [lines-db](https://github.com/toiroakr/lines-db)
  - Configuration file (`config.yaml`) defining entity dependencies

  **Usage:**

  ```typescript
  import { defineGenerators } from "@tailor-platform/sdk";

  export const generators = defineGenerators([
    ["@tailor-platform/seed", { distPath: "./seed" }],
  ]);
  ```

  This will generate seed data infrastructure based on your TailorDB types, enabling validation with [`lines-db`](https://github.com/toiroakr/lines-db) and data ingestion with [`gql-ingest`](https://github.com/jackchuka/gql-ingest).

## 0.5.5

### Patch Changes

- [#686](https://github.com/tailor-platform/sdk/pull/686) [`e8841b6`](https://github.com/tailor-platform/sdk/commit/e8841b654507b67fcd4b0d1919159bd7c0ab217b) Thanks [@remiposo](https://github.com/remiposo)! - Added ignores option

  When specifying files for db, resolver, and executor, we can now exclude specific files with `ignores`. Test-related files (`**/*.test.ts`, `**/*.spec.ts`) are excluded by default.

  ```typescript
  defineConfig({
    db: {
      "my-db": {
        files: ["db/**/*.ts"],
        ignores: ["db/**/*.draft.ts"],
      },
    },
  });
  ```

## 0.5.4

### Patch Changes

- [#682](https://github.com/tailor-platform/sdk/pull/682) [`7678f09`](https://github.com/tailor-platform/sdk/commit/7678f09909e4d604604e8845d39e86be3e7fa47a) Thanks [@remiposo](https://github.com/remiposo)! - Renamed from Tailor SDK to Tailor Platform SDK

## 0.5.3

## 0.5.2

### Patch Changes

- [#675](https://github.com/tailor-platform/sdk/pull/675) [`8cb1c77`](https://github.com/tailor-platform/sdk/commit/8cb1c77582da17f7fa4171ea15fe4d5aa465a9bd) Thanks [@remiposo](https://github.com/remiposo)! - Added testing guides

## 0.5.1

### Patch Changes

- [#672](https://github.com/tailor-platform/sdk/pull/672) [`4730eb1`](https://github.com/tailor-platform/sdk/commit/4730eb1023b6cb3c74483c419242c7a1a4328897) Thanks [@remiposo](https://github.com/remiposo)! - Use `z.custom<Function>` instead of `z.function`

- [#673](https://github.com/tailor-platform/sdk/pull/673) [`7672c9b`](https://github.com/tailor-platform/sdk/commit/7672c9b7866a3a0864bd04cda114b546e07d5051) Thanks [@remiposo](https://github.com/remiposo)! - Exported Namespace of kysely-type

  Exported Namespace to enable retrieving Kysely types like `Selectable<Namespace["main-db"]["User"]>`.

## 0.5.0

### Minor Changes

- [#664](https://github.com/tailor-platform/sdk/pull/664) [`f3e99fb`](https://github.com/tailor-platform/sdk/commit/f3e99fb0b7848fbaaf25c876e44e387e5138fb09) Thanks [@remiposo](https://github.com/remiposo)! - Aligned `createExecutor` interface with `createResolver`

  **Breaking Changes:**

  `createExecutor` interface has changed significantly.
  Previously, it was defined by chaining `.on` and `.executeFunction`, but it's been changed to simply pass an object similar to `createResolver`.

  before:

  ```typescript
  createExecutor("executor-name", "Executor description")
    .on(recordCreatedTrigger(user, ({ newRecord }) => newRecord.age < 18))
    .executeFunction({
      fn: async ({ newRecord }) => {
        // executor logic here
      },
    });
  ```

  after:

  ```typescript
  createExecutor({
    name: "executor-name",
    description: "Executor description",
    trigger: recordCreatedTrigger({
      type: user,
      condition: ({ newRecord }) => newRecord.age < 18,
    }),
    operation: {
      kind: "function",
      body: async ({ newRecord }) => {
        // executor logic here
      },
    },
  });
  ```

  Additionally, the function set in `body` can now be easily retrieved with typing. This should be useful when you want to execute the function in unit tests, for example.

  ```typescript
  const executor = createExecutor({
    // ...other properties
    operation: {
      kind: "function",
      body: async ({ newRecord }) => {
        // executor logic here
      },
    },
  });

  const body = executor.operation.body;
  ```

## 0.4.0

### Minor Changes

- [#665](https://github.com/tailor-platform/sdk/pull/665) [`16e7cf2`](https://github.com/tailor-platform/sdk/commit/16e7cf2045cfa7dff717ce9001a2925cd5588d5f) Thanks [@toiroakr](https://github.com/toiroakr)! - chore!: rename pipeline -> resolver

## 0.3.0

### Minor Changes

- [#661](https://github.com/tailor-platform/sdk/pull/661) [`bf4583c`](https://github.com/tailor-platform/sdk/commit/bf4583cef16bcc7b88118d2814b2beec28b825dd) Thanks [@t](https://github.com/t)! - feat!: remove TailorType and set typename for resolver

  ## Breaking Changes

  ### Removed `t.type()` - use plain objects for input and `t.object()` for output

  The `t.type()` wrapper has been removed from resolver definitions. Input fields are now passed directly as an object, and output uses `t.object()` instead.

  **Before:**

  ```typescript
  createResolver({
    name: "add",
    operation: "query",
    input: t.type({
      a: t.int(),
      b: t.int(),
    }),
    output: t.type({
      result: t.int(),
    }),
    body: (context) => {
      return { result: context.input.a + context.input.b };
    },
  });
  ```

  **After:**

  ```typescript
  createResolver({
    name: "add",
    operation: "query",
    input: {
      a: t.int(),
      b: t.int(),
    },
    output: t.object({
      result: t.int(),
    }),
    body: (context) => {
      return { result: context.input.a + context.input.b };
    },
  });
  ```

  ## New Feature

  ### Added `typeName()` method for custom GraphQL type names

  You can now set custom GraphQL type names for enum and nested object fields using the `.typeName()` method. This is useful when you want to control the generated GraphQL type names.

  ```typescript
  createResolver({
    name: "stepChain",
    operation: "query",
    input: {

        .object({
          name: t.object({
            first: t.string(),
            last: t.string(),
          }),
          activatedAt: t.datetime({ optional: true }),
        })
        .typeName("StepChainUser"),
    },
    output: t.object({
      result: t.string(),
    }),
    body: (context) => {
      return {
        result: `${context.input.user.name.first} ${context.input.user.name.last}`,
      };
    },
  });
  ```

## 0.2.1

### Patch Changes

- [#658](https://github.com/tailor-platform/sdk/pull/658) [`affac14`](https://github.com/tailor-platform/sdk/commit/affac14e1a33486da3b1540432172018a0e1ca0c) Thanks [@remiposo](https://github.com/remiposo)! - Supported disabling executors

  Made it possible to disable executors by setting the disabled option to true.

  ```typescript
  const disabled = createExecutor("test-executor", {
    disabled: true,
  })
    .on(incomingWebhookTrigger())
    .executeFunction({
      fn: () => {
        // Do something
      },
    });
  ```

## 0.2.0

### Minor Changes

- [#650](https://github.com/tailor-platform/sdk/pull/650) [`fcbcc8d`](https://github.com/tailor-platform/sdk/commit/fcbcc8d35c74b7ae0f458487d4779a07292133aa) Thanks [@remiposo](https://github.com/remiposo)! - Removed unused dbNamespace

  Removed dbNamespace option. While this is a breaking change, it should have minimal impact since it's no longer used. If it's still specified, a type error will occur, so simply remove it.

## 0.1.1

### Patch Changes

- [#647](https://github.com/tailor-platform/sdk/pull/647) [`b3f744b`](https://github.com/tailor-platform/sdk/commit/b3f744bd0db1751951389f013f6c2e4a6b97e743) Thanks [@remiposo](https://github.com/remiposo)! - Added show command

  Added a command to retrieve information about deployed applications. This can be used to obtain application endpoints after deployment in CI and similar environments.

  ```bash
  tailor-sdk apply --workspace-id <your-workspace-id>
  tailor-sdk show --workspace-id <your-workspace-id> -f json | jq -r '.url'
  ```

- [#649](https://github.com/tailor-platform/sdk/pull/649) [`46e0b7b`](https://github.com/tailor-platform/sdk/commit/46e0b7bf56243ea72ae24a477ef9b48779245d49) Thanks [@remiposo](https://github.com/remiposo)! - Added machineuser commands

  ```bash
  tailor-sdk machineuser list --workspace-id <your-workspace-id>
  tailor-sdk machineuser token <machine-user-name> --workspace-id <your-workspace-id>
  ```

## 0.1.0

### Minor Changes

- [#643](https://github.com/tailor-platform/sdk/pull/643) [`793a792`](https://github.com/tailor-platform/sdk/commit/793a7924bd6df4b5c23c5747e1935772ada0c152) Thanks [@toiroakr](https://github.com/toiroakr)! - feat!: remove assertNonNull option

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
    create: ({ data }) => `${data.postalCode} ${data.address} ${data.city}`,
    // data.postalCode was guaranteed to be present
  });
  ```

  **After:**

  ```typescript
  fullAddress: db.string({ optional: true }).hooks({
    create: ({ data }) =>
      `${data.postalCode ?? ""} ${data.address ?? ""} ${data.city ?? ""}`,
    // All fields may be undefined - use ?? or add null checks
  });
  ```

## 0.0.99

### Patch Changes

- [#641](https://github.com/tailor-platform/sdk/pull/641) [`fd8b630`](https://github.com/tailor-platform/sdk/commit/fd8b630a7c92263ee377c8bc2a83f76c338d78e4) Thanks [@remiposo](https://github.com/remiposo)! - Rename workspace destory command

- [#645](https://github.com/tailor-platform/sdk/pull/645) [`738a904`](https://github.com/tailor-platform/sdk/commit/738a904d77e5e3f1a65543f2859b0d7f543b2437) Thanks [@remiposo](https://github.com/remiposo)! - Changed to display ID of created workspace

  Made it easier to retrieve the ID of workspaces created with `tailor-sdk workspace create`.
  This is useful for cases where you want to apply after creating a workspace in CI environments and similar scenarios.

  ```bash
  tailor-sdk workspace create --name "my-workspace" --region asia-northeast --format json | jq -r '.id'
  ```

## 0.0.98

### Patch Changes

- [#639](https://github.com/tailor-platform/sdk/pull/639) [`07ef858`](https://github.com/tailor-platform/sdk/commit/07ef85825b51e4a83ab437bad4148d1b33d7a0f1) Thanks [@remiposo](https://github.com/remiposo)! - Adjusted the output format of user commands

## 0.0.97

### Patch Changes

- [#636](https://github.com/tailor-platform/sdk/pull/636) [`ffc1ef7`](https://github.com/tailor-platform/sdk/commit/ffc1ef74e02e9bcf711431709088d1ff2997dd65) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: export generator types

## 0.0.96

### Patch Changes

- [#626](https://github.com/tailor-platform/sdk/pull/626) [`b176af1`](https://github.com/tailor-platform/sdk/commit/b176af18c0ab23a4832517921b233d7206a2e6e6) Thanks [@remiposo](https://github.com/remiposo)! - Changed how workspaceID and authentication credentials are specified

  Previously, authentication credentials were stored in the tailorctl config file (`~/.tailorctl/config`), but we've changed to store them in a new format file (`~/.config/tailor-platform/config.yaml`). When you run SDK commands, migration happens automatically, so generally no user action is required.
  We've also changed how workspaceID is specified during apply. Previously, you specified workspaceID in the configuration file (`tailor.config.ts`), but we've removed this. Instead, please specify `--workspace-id` flag or `TAILOR_PLATFORM_WORKSPACE_ID` environment variable when running the apply command.

  ```bash
  tailor-sdk apply --workspace-id <your-workspace-id>
  # or
  TAILOR_PLATFORM_WORKSPACE_ID=<your-workspace-id> tailor-sdk apply
  ```

- [#634](https://github.com/tailor-platform/sdk/pull/634) [`9b86782`](https://github.com/tailor-platform/sdk/commit/9b8678220375725f0f872deb37ed60a12a1ba124) Thanks [@remiposo](https://github.com/remiposo)! - Added user and profile management commands

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

- [#627](https://github.com/tailor-platform/sdk/pull/627) [`6582379`](https://github.com/tailor-platform/sdk/commit/6582379d81c7d5469e27d672c9313a1cb9b81c50) Thanks [@toiroakr](https://github.com/toiroakr)! - feat!: unnest resolver input type

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

- [#623](https://github.com/tailor-platform/sdk/pull/623) [`452a5d7`](https://github.com/tailor-platform/sdk/commit/452a5d7904d1b04b26638fce337d865b358f1f5b) Thanks [@remiposo](https://github.com/remiposo)! - Made all commands accept the --env-file flag

- [#621](https://github.com/tailor-platform/sdk/pull/621) [`6291874`](https://github.com/tailor-platform/sdk/commit/629187471b0189331445ad179f9cfae91902a0a4) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: validate resolver input

- [#625](https://github.com/tailor-platform/sdk/pull/625) [`d08ec14`](https://github.com/tailor-platform/sdk/commit/d08ec14886f91a71c6358d58db7e0f16d3f06ebe) Thanks [@remiposo](https://github.com/remiposo)! - Display stack trace only when the --verbose flag is specified

## 0.0.93

### Patch Changes

- [#617](https://github.com/tailor-platform/sdk/pull/617) [`d45fe83`](https://github.com/tailor-platform/sdk/commit/d45fe834398426c94e5239e9bc94a5736df87016) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add tailordb.Client mock for apply

- [#613](https://github.com/tailor-platform/sdk/pull/613) [`62c8fe3`](https://github.com/tailor-platform/sdk/commit/62c8fe35e50e14778db57ccd8e517b1b44dbdfbd) Thanks [@remiposo](https://github.com/remiposo)! - chore: Update documentation structure

## 0.0.92

### Patch Changes

- [#607](https://github.com/tailor-platform/sdk/pull/607) [`ab2cadd`](https://github.com/tailor-platform/sdk/commit/ab2cadd9f92ac488ae1963d0768e2ca96ec66e0f) Thanks [@toiroakr](https://github.com/toiroakr)! - refactor: move inflection to out of configuration

## 0.0.91

### Patch Changes

- [#601](https://github.com/tailor-platform/sdk/pull/601) [`4f2803a`](https://github.com/tailor-platform/sdk/commit/4f2803a1ab00a28d466f86764955656e8ea23829) Thanks [@remiposo](https://github.com/remiposo)! - Add workspace management comand

- [#606](https://github.com/tailor-platform/sdk/pull/606) [`f1be4bf`](https://github.com/tailor-platform/sdk/commit/f1be4bf0f324e5ea1896fa4c1a9415b48eb0b134) Thanks [@toiroakr](https://github.com/toiroakr)! - feat!: kysely-db generator renewal

- [#604](https://github.com/tailor-platform/sdk/pull/604) [`491626b`](https://github.com/tailor-platform/sdk/commit/491626b65bbde4bfebe45b542ef3bcea7b13fde1) Thanks [@remiposo](https://github.com/remiposo)! - Add login/logout command

## 0.0.90

### Patch Changes

- [#598](https://github.com/tailor-platform/sdk/pull/598) [`7b2ffaf`](https://github.com/tailor-platform/sdk/commit/7b2ffaf47b8f324bf489c7734f566be320dd69cc) Thanks [@toiroakr](https://github.com/toiroakr)! - chore: improve url schema

- [#600](https://github.com/tailor-platform/sdk/pull/600) [`ec16341`](https://github.com/tailor-platform/sdk/commit/ec16341c0d5aaf5c786f03216ab5642ff4fe7683) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: remove callbackUrl from defineStaticWebsite

## 0.0.89

### Patch Changes

- [#597](https://github.com/tailor-platform/sdk/pull/597) [`36ea41c`](https://github.com/tailor-platform/sdk/commit/36ea41c4fea9c4d6ff4b5b1d7fd8582ceae09c89) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: stricter define function types

- [#595](https://github.com/tailor-platform/sdk/pull/595) [`2d3f019`](https://github.com/tailor-platform/sdk/commit/2d3f01977bcf271a8874fc5f6d273d6c1c1561f8) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add defineIdp

## 0.0.88

### Patch Changes

- [#594](https://github.com/tailor-platform/sdk/pull/594) [`ac244cd`](https://github.com/tailor-platform/sdk/commit/ac244cd7769cfe92a962ea48918559dd403991df) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add defineStaticWebsite

- [#589](https://github.com/tailor-platform/sdk/pull/589) [`5195548`](https://github.com/tailor-platform/sdk/commit/5195548158aa61fe7b33a75a4812d5345adde3da) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: type guard for workspaceId

## 0.0.87

### Patch Changes

- [#585](https://github.com/tailor-platform/sdk/pull/585) [`3f13d44`](https://github.com/tailor-platform/sdk/commit/3f13d4463047862cfe438f71d87629e49320c6eb) Thanks [@toiroakr](https://github.com/toiroakr)! - chore: update resolver schema

## 0.0.86

### Patch Changes

- [#575](https://github.com/tailor-platform/sdk/pull/575) [`0d64a86`](https://github.com/tailor-platform/sdk/commit/0d64a869766049ffb8462dace6222db53e23dbce) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: strict resolver output type

## 0.0.85

### Patch Changes

- [#573](https://github.com/tailor-platform/sdk/pull/573) [`11cae3e`](https://github.com/tailor-platform/sdk/commit/11cae3e8aa89fc8d71993a0bb9e28c02123f185f) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: generated type reference

## 0.0.84

### Patch Changes

- [#570](https://github.com/tailor-platform/sdk/pull/570) [`20b760e`](https://github.com/tailor-platform/sdk/commit/20b760e9b3f85e200ed9ec7d1bef73efbc2f1299) Thanks [@remiposo](https://github.com/remiposo)! - Use type import in kysely generator

## 0.0.83

### Patch Changes

- [#559](https://github.com/tailor-platform/sdk/pull/559) [`ebcb667`](https://github.com/tailor-platform/sdk/commit/ebcb6674bbc1fc3ac819bb0e2930255a660ade1b) Thanks [@toiroakr](https://github.com/toiroakr)! - Remove steps from resolver

## 0.0.82

### Patch Changes

- [#563](https://github.com/tailor-platform/sdk/pull/563) [`14333f9`](https://github.com/tailor-platform/sdk/commit/14333f9eac7eb53f4856388c367b8e00e16e86de) Thanks [@remiposo](https://github.com/remiposo)! - Fixed to set more appropriate GraphQL types in pipeline input / output

- [#565](https://github.com/tailor-platform/sdk/pull/565) [`dbaa31e`](https://github.com/tailor-platform/sdk/commit/dbaa31e74522fd34dde3bd3e3b71b4190cfdf514) Thanks [@remiposo](https://github.com/remiposo)! - fix: ensure the vault and secret exist

- [#558](https://github.com/tailor-platform/sdk/pull/558) [`ce877a1`](https://github.com/tailor-platform/sdk/commit/ce877a1ff421e8f3f902d3902cfa66b3ea2bae51) Thanks [@remiposo](https://github.com/remiposo)! - feat: Remove client from exectutor args when dbNamespace is not specified

## 0.0.81

### Patch Changes

- [#552](https://github.com/tailor-platform/sdk/pull/552) [`c9f10c5`](https://github.com/tailor-platform/sdk/commit/c9f10c5ca80ebb1e282b3639e2b7a24b4aefba7d) Thanks [@toiroakr](https://github.com/toiroakr)! - Simplified permission definitions with automatic type generation

## 0.0.80

### Patch Changes

- [#548](https://github.com/tailor-platform/sdk/pull/548) [`ce834be`](https://github.com/tailor-platform/sdk/commit/ce834bec7c7d80a3f56a520339a569fef9225888) Thanks [@toiroakr](https://github.com/toiroakr)! - kysely-type generator: support assertNonNull

## 0.0.79

### Patch Changes

- [#545](https://github.com/tailor-platform/sdk/pull/545) [`e82a038`](https://github.com/tailor-platform/sdk/commit/e82a038b022ebf58dd377a247b7bdf1fa608701c) Thanks [@remiposo](https://github.com/remiposo)! - chore: Add LICENSE

## 0.0.78

### Patch Changes

- [#535](https://github.com/tailor-platform/sdk/pull/535) [`fd011ba`](https://github.com/tailor-platform/sdk/commit/fd011ba2a0c3719d87a3e5434f86aacc11a52ba8) Thanks [@remiposo](https://github.com/remiposo)! - fix: remove unusable variables from executeFunction/executeJobFunction

- [#527](https://github.com/tailor-platform/sdk/pull/527) [`f9eae29`](https://github.com/tailor-platform/sdk/commit/f9eae29e80238e9783e831a7ec02c5a3583d03b6) Thanks [@remiposo](https://github.com/remiposo)! - refactor: Executor service

## 0.0.77

### Patch Changes

- [#524](https://github.com/tailor-platform/sdk/pull/524) [`5f0272a`](https://github.com/tailor-platform/sdk/commit/5f0272a35b6ab24b69f781123477bc42e50e02cd) Thanks [@remiposo](https://github.com/remiposo)! - test: add incomingWebhookTrigger test cases

## 0.0.76

### Patch Changes

- [#521](https://github.com/tailor-platform/sdk/pull/521) [`f380645`](https://github.com/tailor-platform/sdk/commit/f3806455815ed4efd80cfe11428bd7862c77b401) Thanks [@remiposo](https://github.com/remiposo)! - chore: Update CHANGELOG.md format

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
