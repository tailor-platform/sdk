# @tailor-platform/create-tailor-sdk

## 0.7.5

## 0.7.4

## 0.7.3

## 0.7.2

## 0.7.1

## 0.7.0

## 0.6.2

### Patch Changes

- [#701](https://github.com/tailor-platform/tailor-sdk/pull/701) [`1d9e798`](https://github.com/tailor-platform/tailor-sdk/commit/1d9e798c667e75734da9b9119770442ce62a48ac) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: seed generator

## 0.6.1

## 0.6.0

## 0.5.6

### Patch Changes

- [#691](https://github.com/tailor-platform/tailor-sdk/pull/691) [`4e949b6`](https://github.com/tailor-platform/tailor-sdk/commit/4e949b67291ce8775c189a793a99f768ab8904db) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add seed generator

  Added `@tailor-platform/seed` generator that automatically generates seed data files from TailorDB type definitions. This generator creates:
  - GraphQL Ingest mapping files (`mappings/*.json`) and GraphQL files for bulk data loading via [gql-ingest](https://github.com/jackchuka/gql-ingest)
  - lines-db schema files (`data/*.schema.ts`) for validation via [lines-db](https://github.com/toiroakr/lines-db)
  - Configuration file (`config.yaml`) defining entity dependencies

  **Usage:**

  ```typescript
  import { defineGenerators } from "@tailor-platform/tailor-sdk";

  export const generators = defineGenerators([
    ["@tailor-platform/seed", { distPath: "./seed" }],
  ]);
  ```

  This will generate seed data infrastructure based on your TailorDB types, enabling validation with [`lines-db`](https://github.com/toiroakr/lines-db) and data ingestion with [`gql-ingest`](https://github.com/jackchuka/gql-ingest).

## 0.5.5

## 0.5.4

### Patch Changes

- [#682](https://github.com/tailor-platform/tailor-sdk/pull/682) [`7678f09`](https://github.com/tailor-platform/tailor-sdk/commit/7678f09909e4d604604e8845d39e86be3e7fa47a) Thanks [@remiposo](https://github.com/remiposo)! - Renamed from Tailor SDK to Tailor Platform SDK

## 0.5.3

### Patch Changes

- [#680](https://github.com/tailor-platform/tailor-sdk/pull/680) [`4550297`](https://github.com/tailor-platform/tailor-sdk/commit/455029768e43a9d9bffbae0b93fdabd75e905a53) Thanks [@remiposo](https://github.com/remiposo)! - Added @tailor-platform/function-types to testing

## 0.5.2

### Patch Changes

- [#675](https://github.com/tailor-platform/tailor-sdk/pull/675) [`8cb1c77`](https://github.com/tailor-platform/tailor-sdk/commit/8cb1c77582da17f7fa4171ea15fe4d5aa465a9bd) Thanks [@remiposo](https://github.com/remiposo)! - Added testing guides

## 0.5.1

## 0.5.0

## 0.4.0

### Minor Changes

- [#665](https://github.com/tailor-platform/tailor-sdk/pull/665) [`16e7cf2`](https://github.com/tailor-platform/tailor-sdk/commit/16e7cf2045cfa7dff717ce9001a2925cd5588d5f) Thanks [@toiroakr](https://github.com/toiroakr)! - chore!: rename pipeline -> resolver

## 0.3.0

### Minor Changes

- [#661](https://github.com/tailor-platform/tailor-sdk/pull/661) [`bf4583c`](https://github.com/tailor-platform/tailor-sdk/commit/bf4583cef16bcc7b88118d2814b2beec28b825dd) Thanks [@t](https://github.com/t)! - feat!: remove TailorType and set typename for resolver

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

## 0.2.0

## 0.1.1

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

## 0.0.98

## 0.0.97

## 0.0.96

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

## 0.0.93

### Patch Changes

- [#617](https://github.com/tailor-platform/tailor-sdk/pull/617) [`d45fe83`](https://github.com/tailor-platform/tailor-sdk/commit/d45fe834398426c94e5239e9bc94a5736df87016) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add tailordb.Client mock for apply

## 0.0.92

### Patch Changes

- [#607](https://github.com/tailor-platform/tailor-sdk/pull/607) [`ab2cadd`](https://github.com/tailor-platform/tailor-sdk/commit/ab2cadd9f92ac488ae1963d0768e2ca96ec66e0f) Thanks [@toiroakr](https://github.com/toiroakr)! - refactor: move inflection to out of configuration

## 0.0.91

### Patch Changes

- [#606](https://github.com/tailor-platform/tailor-sdk/pull/606) [`f1be4bf`](https://github.com/tailor-platform/tailor-sdk/commit/f1be4bf0f324e5ea1896fa4c1a9415b48eb0b134) Thanks [@toiroakr](https://github.com/toiroakr)! - feat!: kysely-db generator renewal

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

## 0.0.83

### Patch Changes

- [#559](https://github.com/tailor-platform/tailor-sdk/pull/559) [`ebcb667`](https://github.com/tailor-platform/tailor-sdk/commit/ebcb6674bbc1fc3ac819bb0e2930255a660ade1b) Thanks [@toiroakr](https://github.com/toiroakr)! - Remove steps from resolver

## 0.0.82

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

## 0.0.77

## 0.0.76

### Patch Changes

- [#521](https://github.com/tailor-platform/tailor-sdk/pull/521) [`f380645`](https://github.com/tailor-platform/tailor-sdk/commit/f3806455815ed4efd80cfe11428bd7862c77b401) Thanks [@remiposo](https://github.com/remiposo)! - chore: Update CHANGELOG.md format

## 0.0.75

### Patch Changes

- dca9f5b: Separate generator config from defineConfig

## 0.0.74

## 0.0.73

### Patch Changes

- 9be7344: Change defineConfig to be tailored specifically for a single app

## 0.0.72

## 0.0.71

### Patch Changes

- 9f7a52c: Add CHANGELOG.md
