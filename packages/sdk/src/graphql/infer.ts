/**
 * Type-level inference utilities for mapping TailorDB type definitions
 * to GraphQL input/output types without code generation.
 *
 * These types enable `InferCreateInput<typeof myType>` to produce
 * the expected GraphQL input type for create mutations, and
 * `ExtractRootField<Q>` to extract the operation name from a query string.
 */

import type { TailorAnyDBField, TailorAnyDBType } from "@/configure/services/tailordb/schema";
import type { Prettify } from "@/configure/types/helpers";

// === Nested output transformation ===

/**
 * Check if K is an optional key in T.
 * `{} extends Pick<T, K>` is true when K is optional, false when required.
 */
type IsOptionalKey<T, K extends keyof T> = object extends Pick<T, K> ? true : false;

/**
 * Transform InferFieldsOutput to GraphQL format.
 * Unlike Kysely, dates stay as `string` since GraphQL serializes them.
 */
type OutputToGql<T> = {
  [K in keyof T]-?: IsOptionalKey<T, K> extends true
    ? GqlTransformFieldValue<NonNullable<T[K]>> | null
    : GqlTransformFieldValue<T[K]>;
};

/**
 * Convert field values to GraphQL types:
 * - `string | Date` (datetime) -> string (GraphQL ISO strings)
 * - Arrays -> recurse into element type
 * - Nested objects -> recurse
 * - Everything else -> pass through
 */
type GqlTransformFieldValue<T> = Date extends T
  ? string
  : T extends (infer E)[]
    ? GqlTransformFieldValue<E>[]
    : T extends Record<string, unknown>
      ? OutputToGql<T>
      : T;

// === Base type mapping ===

/** Strip null and array wrappers to get the base output type */
type StripNullAndArray<T> = T extends (infer E)[] ? Exclude<E, null> : Exclude<T, null>;

/**
 * Map TailorDBField's `_defined.type` to the corresponding GraphQL base type.
 *
 * | _defined.type     | GraphQL TS type            |
 * |-------------------|----------------------------|
 * | string, uuid      | string                     |
 * | integer, float    | number                     |
 * | boolean           | boolean                    |
 * | date, datetime    | string                     |
 * | time              | string                     |
 * | enum              | literal union from _output |
 * | nested            | recursive object           |
 */
type MapGqlFieldBaseType<F extends TailorAnyDBField> = F["_defined"]["type"] extends
  | "string"
  | "uuid"
  ? string
  : F["_defined"]["type"] extends "integer" | "float"
    ? number
    : F["_defined"]["type"] extends "boolean"
      ? boolean
      : F["_defined"]["type"] extends "date" | "datetime" | "time"
        ? string
        : F["_defined"]["type"] extends "enum"
          ? StripNullAndArray<F["_output"]>
          : F["_defined"]["type"] extends "nested"
            ? OutputToGql<StripNullAndArray<F["_output"]>>
            : string;

// === Modifier application ===

type WithGqlArray<Base, F extends TailorAnyDBField> = F["_defined"]["array"] extends true
  ? Base[]
  : Base;

type WithGqlNull<T, F extends TailorAnyDBField> = null extends F["_output"] ? T | null : T;

/** Infer a single GraphQL column type from a TailorDBField */
type InferGqlColumn<F extends TailorAnyDBField> = WithGqlNull<
  WithGqlArray<MapGqlFieldBaseType<F>, F>,
  F
>;

// === Field filtering for inputs ===

/** Check if a field has a create hook via the type-level _hooksMeta */
type HasCreateHookMeta<
  T extends TailorAnyDBType,
  K extends string,
> = K extends keyof T["_hooksMeta"]
  ? T["_hooksMeta"][K] extends { create: true }
    ? true
    : false
  : false;

/** Check if a field has serial from _defined */
type IsSerial<F extends TailorAnyDBField> = F["_defined"] extends { serial: true } ? true : false;

/**
 * Check if a field has hooks.create from _defined.
 * Uses indexed access with NonNullable to handle optional hooks property
 * (`hooks?:` in TailorDBField._defined is optional after intersection with Prettify).
 */
type HasDefinedCreateHook<F extends TailorAnyDBField> = "hooks" extends keyof F["_defined"]
  ? NonNullable<F["_defined"]["hooks"]> extends { create: true }
    ? true
    : false
  : false;

/** Check if a field should be excluded from create/update input */
type IsExcludedFromInput<T extends TailorAnyDBType, K extends string> = K extends "id"
  ? true
  : K extends keyof T["fields"]
    ? IsSerial<T["fields"][K]> extends true
      ? true
      : HasDefinedCreateHook<T["fields"][K]> extends true
        ? true
        : HasCreateHookMeta<T, K> extends true
          ? true
          : false
    : false;

/** Keys that are included in CreateInput (not excluded) */
type CreateInputKeys<T extends TailorAnyDBType> = {
  [K in keyof T["fields"] & string]: IsExcludedFromInput<T, K> extends true ? never : K;
}[keyof T["fields"] & string];

/** Keys that are required in CreateInput (not nullable/optional) */
type RequiredCreateInputKeys<T extends TailorAnyDBType> = {
  [K in CreateInputKeys<T>]: null extends T["fields"][K]["_output"] ? never : K;
}[CreateInputKeys<T>];

/** Keys that are optional in CreateInput */
type OptionalCreateInputKeys<T extends TailorAnyDBType> = Exclude<
  CreateInputKeys<T>,
  RequiredCreateInputKeys<T>
>;

// === String utilities ===

/** Trim leading whitespace from a template literal type */
type TrimStart<S extends string> = S extends ` ${infer R}`
  ? TrimStart<R>
  : S extends `\n${infer R}`
    ? TrimStart<R>
    : S extends `\t${infer R}`
      ? TrimStart<R>
      : S extends `\r${infer R}`
        ? TrimStart<R>
        : S;

/** Trim trailing whitespace from a template literal type */
type TrimEnd<S extends string> = S extends `${infer R} `
  ? TrimEnd<R>
  : S extends `${infer R}\n`
    ? TrimEnd<R>
    : S extends `${infer R}\t`
      ? TrimEnd<R>
      : S extends `${infer R}\r`
        ? TrimEnd<R>
        : S;

/** Trim both leading and trailing whitespace */
type Trim<S extends string> = TrimStart<TrimEnd<S>>;

/** Extract leading identifier (before `(`, ` `, `{`, `}`, or newline) */
type ExtractIdentifier<S extends string> = S extends `${infer Name}(${string}`
  ? Name
  : S extends `${infer Name} ${string}`
    ? Name
    : S extends `${infer Name}\n${string}`
      ? Name
      : S extends `${infer Name}\t${string}`
        ? Name
        : S extends `${infer Name}{${string}`
          ? Name
          : S extends `${infer Name}}${string}`
            ? Name
            : S;

// === Public API ===

/**
 * Extract the root field name from a GraphQL query/mutation string.
 * Finds the first identifier after the opening `{` of the selection set.
 * @example
 * ```ts
 * type T1 = ExtractRootField<"mutation { createFoo(input: $input) { id } }">;
 * //   ^? "createFoo"
 * type T2 = ExtractRootField<"query { salesOrder(id: $id) { id } }">;
 * //   ^? "salesOrder"
 * ```
 */
export type ExtractRootField<Q extends string> = string extends Q // Q is `string` (not a literal) -> fallback
  ? string
  : Q extends `${string}{${infer Rest}`
    ? ExtractIdentifier<TrimStart<Rest>>
    : string;

/**
 * Infer the GraphQL CreateInput type from a TailorDB type definition.
 * Excludes id, serial, and hooked fields. Required fields stay required,
 * optional fields become `T | null | undefined`.
 * @example
 * ```ts
 * const user = db.type("User", { name: db.string(), age: db.int({ optional: true }) });
 * type Input = InferCreateInput<typeof user>;
 * // { name: string; age?: number | null }
 * ```
 */
export type InferCreateInput<T extends TailorAnyDBType> = Prettify<
  {
    [K in RequiredCreateInputKeys<T>]: InferGqlColumn<T["fields"][K]>;
  } & {
    [K in OptionalCreateInputKeys<T>]?: InferGqlColumn<T["fields"][K]> | null;
  }
>;

/**
 * Infer the GraphQL UpdateInput type from a TailorDB type definition.
 * Same fields as CreateInput but all optional.
 * @example
 * ```ts
 * const user = db.type("User", { name: db.string(), age: db.int() });
 * type Input = InferUpdateInput<typeof user>;
 * // { name?: string | null; age?: number | null }
 * ```
 */
export type InferUpdateInput<T extends TailorAnyDBType> = {
  [K in CreateInputKeys<T>]?: InferGqlColumn<T["fields"][K]> | null;
};

/**
 * Infer the GraphQL result type from a TailorDB type definition.
 * Includes all scalar fields (including id) mapped to their output types.
 * Does not include forward-relationship (relation()) fields; those require
 * query-level selection and are out of scope for this base type mapping.
 * @example
 * ```ts
 * const user = db.type("User", { name: db.string(), age: db.int() });
 * type Result = InferGqlResult<typeof user>;
 * // { id: string; name: string; age: number }
 * ```
 */
export type InferGqlResult<T extends TailorAnyDBType> = {
  [K in keyof T["fields"] & string]: K extends "id" ? string : InferGqlColumn<T["fields"][K]>;
};

/**
 * Module augmentation interface for GraphQL schema types.
 * Augmented by `tailor-env.d.ts` via `declare module` to provide
 * type-safe GraphQL operations.
 * @example
 * ```ts
 * // In tailor-env.d.ts (auto-generated):
 * declare module "@tailor-platform/sdk/graphql" {
 *   interface GeneratedGqlSchema {
 *     createUser: {
 *       variables: { input: InferCreateInput<typeof user> };
 *       result: { createUser: InferGqlResult<typeof user> };
 *     };
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Interface required for declaration merging via `declare module`
export interface GeneratedGqlSchema {}

// === Schema lookup helpers ===

/**
 * Check if GeneratedGqlSchema has been augmented with at least one operation.
 * When empty (no tailor-env.d.ts), fall back to permissive mode.
 */
type IsSchemaPopulated = keyof GeneratedGqlSchema extends never ? false : true;

/** Error type for unregistered GraphQL operations. Shows a descriptive message in IDE. */
type UnknownGqlOperation<OpName extends string> = {
  readonly __error: `Unknown GraphQL operation: "${OpName}". Run type generation to register it in GeneratedGqlSchema.`;
};

/**
 * Look up the variables type for a GraphQL operation by name.
 * - Non-literal `string`: permissive fallback (`Record<string, unknown>`)
 * - Empty schema (no tailor-env.d.ts): permissive fallback
 * - Literal + registered: strict type from schema
 * - Literal + NOT registered: `UnknownGqlOperation` error type
 */
export type GqlVariables<OpName extends string> = string extends OpName
  ? Record<string, unknown>
  : IsSchemaPopulated extends false
    ? Record<string, unknown>
    : OpName extends keyof GeneratedGqlSchema
      ? GeneratedGqlSchema[OpName] extends { variables: infer V }
        ? V
        : Record<string, unknown>
      : UnknownGqlOperation<OpName>;

/**
 * Look up the result type for a GraphQL operation by name.
 * - Non-literal `string`: `unknown` fallback
 * - Empty schema (no tailor-env.d.ts): `unknown` fallback
 * - Literal + registered: strict type from schema
 * - Literal + NOT registered: `UnknownGqlOperation` error type
 */
export type GqlResult<OpName extends string> = string extends OpName
  ? unknown
  : IsSchemaPopulated extends false
    ? unknown
    : OpName extends keyof GeneratedGqlSchema
      ? GeneratedGqlSchema[OpName] extends { result: infer R }
        ? R
        : unknown
      : UnknownGqlOperation<OpName>;

// === Variable declaration parser ===

/**
 * Extract the variable block from a GraphQL operation.
 * Finds the first `(...)` that precedes `{` and whose content starts with `$`.
 * This correctly skips field arguments like `createFoo(input: $input)`.
 * Assumes no nested parentheses in variable declarations, which holds for
 * standard GraphQL (e.g., `($x: Int = (1))` is not supported).
 */
type _ExtractVarBlock<Q extends string> = Q extends `${string}(${infer VarsAndRest}`
  ? VarsAndRest extends `${infer Block})${string}{${string}`
    ? TrimStart<Block> extends `$${string}`
      ? Block
      : never
    : never
  : never;

/**
 * Split a string at the next `$` variable declaration boundary.
 * Returns [typePartBeforeSplit, remaining] where remaining starts with `$`.
 */
type _SplitAtNextVar<S extends string> = S extends `${infer Before}$${infer After}`
  ? [TrimEnd<Before> extends `${infer R},` ? Trim<R> : Trim<Before>, `$${After}`]
  : [S, ""];

/**
 * Extract variable names as a union type from a variable declaration block.
 * Only parses names — does not resolve GraphQL type names.
 */
type _ExtractVarNames<S extends string> =
  Trim<S> extends `$${infer Rest}`
    ? Rest extends `${infer Name}:${infer AfterColon}`
      ? _SplitAtNextVar<Trim<AfterColon>> extends [string, infer Remaining extends string]
        ? Remaining extends ""
          ? Trim<Name>
          : Trim<Name> | _ExtractVarNames<Remaining>
        : Trim<Name>
      : never
    : never;

/**
 * End-to-end extraction: parse variable names from a query string.
 * Resolves to `never` when no variable block or no valid names are found.
 */
type _ParsedVarNames<Q extends string> = [_ExtractVarBlock<Q>] extends [never]
  ? never
  : _ExtractVarNames<_ExtractVarBlock<Q>>;

// === Unified variable resolution ===

/** Pick Names from Schema, mapping unknown keys to `never`. */
type _PickFromSchema<Names extends string, Schema> = Prettify<{
  [K in Names]: K extends keyof Schema ? Schema[K] : never;
}>;

/**
 * Merge parsed variable names with schema-based types.
 * Uses variable names from query parsing and types from GeneratedGqlSchema.
 * Keys present in the query but absent in the schema resolve to `never` (type error).
 *
 * When declared names are a proper subset of schema keys, returns the full schema
 * so that missing required variables still produce type errors at the call site.
 */
type _MergeVarNamesWithSchema<Names extends string, Schema> = Schema extends {
  readonly __error: string;
}
  ? Schema
  : [Exclude<Names, keyof Schema & string>] extends [never]
    ? [Exclude<keyof Schema & string, Names>] extends [never]
      ? _PickFromSchema<Names, Schema>
      : Schema
    : _PickFromSchema<Names, Schema>;

/**
 * Resolve GraphQL variables from a query string.
 * Parses variable names from the query and looks up types from the schema.
 * No code generation required — works with any populated GeneratedGqlSchema.
 *
 * - Non-literal `string`: permissive fallback (`Record<string, unknown>`)
 * - Empty schema: permissive fallback
 * - Variable declarations present: parsed names merged with schema types
 * - No variable declarations: schema lookup via `GqlVariables`
 */
export type ResolvedGqlVariables<Q extends string> = string extends Q
  ? Record<string, unknown>
  : IsSchemaPopulated extends false
    ? Record<string, unknown>
    : [_ParsedVarNames<Q>] extends [never]
      ? GqlVariables<ExtractRootField<Q>>
      : _MergeVarNamesWithSchema<_ParsedVarNames<Q>, GqlVariables<ExtractRootField<Q>>>;

// === Query validation ===

/** Check if the query contains a selection set `{ ... }` */
type _HasSelectionSet<Q extends string> = Q extends `${string}{${string}}${string}` ? true : false;

/** Whitespace, `{`, or `(` that can follow a GraphQL keyword */
type _KeywordBoundary = " " | "\n" | "\t" | "\r" | "{" | "(";

/** Check if the query starts with a valid GraphQL keyword followed by a boundary */
type _HasValidKeyword<Q extends string> =
  Trim<Q> extends
    | `query${_KeywordBoundary}${string}`
    | `mutation${_KeywordBoundary}${string}`
    | `subscription${_KeywordBoundary}${string}`
    | `{${string}`
    ? true
    : false;

/** Count occurrences of character C in string S */
type _CountChar<
  S extends string,
  C extends string,
  Acc extends unknown[] = [],
> = S extends `${infer _}${C}${infer Rest}` ? _CountChar<Rest, C, [...Acc, 0]> : Acc;

/** Check if `{` and `}` counts match */
type _AreBracesBalanced<Q extends string> = _CountChar<Q, "{">["length"] extends _CountChar<
  Q,
  "}"
>["length"]
  ? true
  : false;

/** Check if `(` and `)` counts match */
type _AreParensBalanced<Q extends string> = _CountChar<Q, "(">["length"] extends _CountChar<
  Q,
  ")"
>["length"]
  ? true
  : false;

/** Check if the root field is registered in GeneratedGqlSchema */
type _IsKnownRootField<Q extends string> =
  ExtractRootField<Q> extends keyof GeneratedGqlSchema ? true : false;

/**
 * Validate a GraphQL query string at the type level.
 * Returns `Q` if valid, or an error message string literal if invalid.
 *
 * Validation layers (broad → strict):
 * 1. Non-literal `string` → permissive (returns Q)
 * 2. Empty GeneratedGqlSchema → permissive (returns Q)
 * 3. Syntax: must contain `{ ... }`
 * 4. Keyword: must start with `query`, `mutation`, `subscription`, or `{`
 * 5. Balance: `{`/`}` counts must match
 * 6. Balance: `(`/`)` counts must match
 * 7. Schema: root field must exist in GeneratedGqlSchema
 */
export type ValidateGqlQuery<Q extends string> = string extends Q
  ? Q // non-literal: permissive
  : IsSchemaPopulated extends false
    ? Q // no schema: permissive
    : _HasSelectionSet<Q> extends false
      ? `Error: Invalid GraphQL query. Must contain a selection set "{ ... }".`
      : _HasValidKeyword<Q> extends false
        ? `Error: Invalid GraphQL query. Must start with "query", "mutation", "subscription", or "{".`
        : _AreBracesBalanced<Q> extends false
          ? 'Error: Invalid GraphQL query. Mismatched curly braces "{" and "}".'
          : _AreParensBalanced<Q> extends false
            ? 'Error: Invalid GraphQL query. Mismatched parentheses "(" and ")".'
            : _IsKnownRootField<Q> extends false
              ? `Error: Unknown GraphQL operation: "${ExtractRootField<Q>}". Run type generation to register it in GeneratedGqlSchema.`
              : Q; // all checks passed

// === Strict object checking ===

/**
 * Enforce exact object shape by mapping excess keys to `never`.
 * Used as an intersection `V & StrictKeys<V, Shape>` to reject
 * excess properties in callback return values, where TypeScript's
 * built-in excess property checking does not apply.
 *
 * Recurses into nested objects to catch deep excess properties.
 */
export type StrictKeys<T, Shape> = {
  [K in keyof T]: K extends keyof Shape
    ? T[K] extends readonly unknown[]
      ? T[K] // Array: do not recurse
      : T[K] extends (...args: never[]) => unknown
        ? T[K] // Function: do not recurse
        : T[K] extends object
          ? Shape[K] extends object
            ? StrictKeys<T[K], Shape[K]>
            : T[K]
          : T[K]
    : never;
} & Record<Exclude<keyof T, keyof Shape>, never>;
