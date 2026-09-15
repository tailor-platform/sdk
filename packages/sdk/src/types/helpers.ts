export type Prettify<T> = {
  [K in keyof T as string extends K ? never : K]: T[K];
} & {};

export type TypeLevelError<Message extends string> = {
  readonly $error: Message;
};

export type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

export type IsUnion<T, U extends T = T> = T extends unknown
  ? [U] extends [T]
    ? false
    : true
  : never;

// Naming an ambient global class directly (e.g. `Temporal.PlainDate`) would
// force every consumer's tsc to resolve it to type-check a module that
// mentions the name — even under `skipLibCheck: false`, and even for
// consumers whose code never touches that global — because a public generic
// type alias ships its full definition in the `.d.ts`. Reaching the global
// structurally through `globalThis` instead means a `lib` that doesn't
// declare it makes this resolve to `never` (a silent no-op wherever it's
// unioned in) rather than a compile error, so a type can opt into an
// experimental or optional ambient global without that requirement leaking
// to consumers who never use it.
export type OptionalGlobalInstance<
  Namespace extends PropertyKey,
  Member extends PropertyKey,
> = typeof globalThis extends { [N in Namespace]: infer T }
  ? Member extends keyof T
    ? T[Member] extends new (...args: never[]) => infer Instance
      ? Instance
      : never
    : never
  : never;

export type DeepWritable<T> = T extends
  | Date
  | OptionalGlobalInstance<"Temporal", "PlainDate">
  | RegExp
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  | Function
  ? T
  : T extends object
    ? { -readonly [P in keyof T]: DeepWritable<T[P]> } & {}
    : T;

export type DeepReadonly<T> = T extends
  | Date
  | OptionalGlobalInstance<"Temporal", "PlainDate">
  | RegExp
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  | Function
  ? T
  : T extends readonly (infer E)[]
    ? readonly DeepReadonly<E>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export type output<T> = T extends { _output: infer U } ? DeepWritable<U> : never;

/**
 * Replace `Date` and `Temporal.PlainDate` with `string` throughout a type.
 *
 * Values that reach user code as a parsed JSON payload cannot carry a `Date`
 * or `Temporal.PlainDate` instance, so a type describing such a payload must
 * report the serialized form even when the type it derives from uses one of
 * those representations.
 */
export type SerializeDates<T> = T extends Date | OptionalGlobalInstance<"Temporal", "PlainDate">
  ? string
  : // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    T extends RegExp | Function
    ? T
    : T extends object
      ? { [K in keyof T]: SerializeDates<T[K]> }
      : T;

export type NullableToOptional<T> = {
  [K in keyof T as null extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as null extends T[K] ? K : never]?: T[K];
};

// Return Output type for TailorFields.
// `_output` is intentionally unconstrained across field implementations.
// oxlint-disable-next-line no-explicit-any
export type InferFieldsOutput<F extends Record<string, { _output: any; [key: string]: any }>> =
  DeepWritable<
    Prettify<
      NullableToOptional<{
        [K in keyof F]: output<F[K]>;
      }>
    >
  >;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * A looser version of JsonValue that accepts interfaces.
 * TypeScript interfaces don't have index signatures by default, so they can't
 * be assigned to JsonValue's `{ [key: string]: JsonValue }`. This type uses a
 * recursive structural check instead.
 *
 * Rejection rules:
 * - Functions are rejected (top-level or as property values).
 * - Objects with a `toJSON` method are rejected (can't faithfully round-trip).
 * - Class instances that expose methods are rejected via the property walk
 *   (methods are function-typed properties, which resolve to `never`).
 *
 * Limitation: class instances whose declared type has only data properties
 * (for example `Error`, or user-defined DTO classes) are structurally
 * indistinguishable from plain objects and cannot be rejected here. The
 * platform performs the authoritative check at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export type JsonCompatible<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly (infer U)[]
    ? JsonCompatible<U>[]
    : // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      T extends Function
      ? never
      : T extends object
        ? T extends { toJSON: () => unknown }
          ? never
          : { [K in keyof T]: JsonCompatible<T[K]> }
        : never;
