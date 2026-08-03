import { brandValue } from "#/utils/brand";
import {
  attachWaitPointInvoker,
  attachWaitPointKey,
  createWaitPointInvoker,
  type WaitPointInvoker,
} from "./wait-point-invoker";
import type { JsonCompatible, Prettify, TypeLevelError } from "#/types/helpers";

const KEY_REGEX = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const LITERAL_SEGMENT_REGEX = /^[a-z0-9]+$/;
const PARAM_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PARAM_VALUE_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const MAX_KEY_LENGTH = 63;
const KEY_GRAMMAR = "[a-z0-9-] (3-63 characters; must start and end with [a-z0-9])";

/**
 * A single wait point instance with typed `.wait()` and `.resolve()` methods.
 *
 * - `.wait(payload?)` suspends execution until resolved. Returns the result from `.resolve()`.
 * - `.resolve(executionId, callback)` resumes a suspended execution.
 *
 * Both `Payload` and `Result` must be JsonValue-compatible (primitives, plain objects, arrays).
 * Functions and objects with a `toJSON` method are rejected at the type level.
 */
export interface WaitPointInstance<Payload = undefined, Result = undefined> {
  wait: [Payload] extends [undefined]
    ? () => Promise<Result>
    : (payload: Payload) => Promise<Result>;
  resolve: (
    executionId: string,
    callback: (
      payload: [Payload] extends [undefined] ? undefined : Payload,
    ) => Result | Promise<Result>,
  ) => Promise<void>;
}

/**
 * A wait point whose key carries `$params`, so the runtime key is built per call.
 *
 * `.with(params)` substitutes the params into the declared key and returns the
 * same two-method surface as an unparameterized wait point.
 */
export interface ParameterizedWaitPointInstance<
  Params extends object,
  Payload = undefined,
  Result = undefined,
> {
  /**
   * Bind runtime values to the key's `$params`.
   * @param params - One value per `$param` in the declared key
   * @returns A wait point bound to the resulting key
   * @throws If a param value is empty, contains characters outside `[a-z0-9-]`,
   * starts or ends with `-`, or makes the resulting key exceed 63 characters
   */
  with(params: Params): WaitPointInstance<Payload, Result>;
}

interface InternalWaitPointInstance {
  wait: (payload?: unknown) => Promise<unknown>;
  resolve: (
    executionId: string,
    callback: (payload: unknown) => unknown | Promise<unknown>,
  ) => Promise<void>;
}

interface WaitPointWithSetter {
  instance: InternalWaitPointInstance;
  setKey: (key: string) => void;
}

interface ParsedKey {
  segments: readonly string[];
  paramNames: readonly string[];
}

function parseKey(key: string): ParsedKey {
  const segments = key.split("-");
  return {
    segments,
    paramNames: segments.filter((s) => s.startsWith("$")).map((s) => s.slice(1)),
  };
}

function validateKey(key: string): ParsedKey {
  const parsed = parseKey(key);
  const seen = new Set<string>();
  let literals = 0;

  for (const segment of parsed.segments) {
    if (segment.startsWith("$")) {
      const name = segment.slice(1);
      if (!PARAM_NAME_REGEX.test(name)) {
        throw new Error(
          `Invalid wait point key "${key}": "${segment}" is not a usable parameter name. Use letters, digits and underscores, starting with a letter or underscore.`,
        );
      }
      if (seen.has(name)) {
        throw new Error(
          `Invalid wait point key "${key}": parameter "$${name}" appears more than once.`,
        );
      }
      seen.add(name);
      continue;
    }
    // An empty segment comes from a run of hyphens, which the key grammar allows
    // inside a key. Leave the placement rules to the whole-key checks below.
    if (segment === "") continue;
    if (!LITERAL_SEGMENT_REGEX.test(segment)) {
      throw new Error(
        `Invalid wait point key "${key}": segment "${segment}" may only contain [a-z0-9]. Wait point keys accept ${KEY_GRAMMAR}, with $params standing in for runtime values.`,
      );
    }
    literals += 1;
  }

  // Only a key that actually carries $params can be identity-less in this
  // sense; without them, an empty run of segments is a plain grammar failure.
  if (literals === 0 && parsed.paramNames.length > 0) {
    throw new Error(
      `Invalid wait point key "${key}": it needs at least one literal segment alongside its $params, otherwise the key carries no identity of its own and can collide with an unrelated wait point.`,
    );
  }

  if (parsed.paramNames.length === 0) {
    if (!KEY_REGEX.test(key)) {
      throw new Error(`Invalid wait point key "${key}": must match ${KEY_GRAMMAR}.`);
    }
    return parsed;
  }

  // Every param value is itself `[a-z0-9]`-bounded, so the shortest instance of
  // the pattern is valid exactly when every instance is.
  const shortest = parsed.segments.map((s) => (s.startsWith("$") ? "0" : s)).join("-");
  if (shortest.length > MAX_KEY_LENGTH) {
    throw new Error(
      `Wait point key "${key}" cannot fit in ${MAX_KEY_LENGTH} characters: even single-character parameter values produce ${shortest.length}.`,
    );
  }
  if (!KEY_REGEX.test(shortest)) {
    throw new Error(`Invalid wait point key "${key}": must match ${KEY_GRAMMAR}.`);
  }
  return parsed;
}

function composeKey(key: string, parsed: ParsedKey, params: Record<string, unknown>): string {
  const composed = parsed.segments
    .map((segment) => {
      if (!segment.startsWith("$")) return segment;
      const name = segment.slice(1);
      const value = params[name];
      if (typeof value !== "string") {
        throw new Error(
          `Wait point "${key}" needs a string for parameter "${name}" but received ${value === undefined ? "undefined" : typeof value}.`,
        );
      }
      if (!PARAM_VALUE_REGEX.test(value)) {
        throw new Error(
          `Wait point "${key}" cannot use ${JSON.stringify(value)} for parameter "${name}": values may only contain [a-z0-9-] and cannot be empty or start or end with "-".`,
        );
      }
      return value;
    })
    .join("-");

  if (composed.length > MAX_KEY_LENGTH) {
    throw new Error(
      `Wait point key "${composed}" built from "${key}" is ${composed.length} characters; the limit is ${MAX_KEY_LENGTH}.`,
    );
  }
  if (!KEY_REGEX.test(composed)) {
    throw new Error(`Wait point key "${composed}" built from "${key}" must match ${KEY_GRAMMAR}.`);
  }
  return composed;
}

function createBoundWaitPoint(invoker: WaitPointInvoker, readKey: () => string) {
  return {
    wait(payload?: unknown) {
      return Promise.resolve(invoker.wait(readKey(), payload));
    },
    async resolve(executionId: string, callback: (payload: unknown) => unknown | Promise<unknown>) {
      await invoker.resolve(readKey(), executionId, callback);
    },
  };
}

// One value has to serve both of `define`'s call shapes: `define<P, R>()` uses
// it directly, while `define(key)<P, R>()` calls it — so calling returns the
// same instance rather than building a new one.
function asSelfReturning<T extends object>(props: T): T {
  const self = function () {
    return self;
  } as unknown as T;
  return Object.assign(self, props);
}

/**
 * Create a WaitPointInstance that delegates to the platform runtime.
 * Use `mockWorkflow` from `@tailor-platform/sdk/vitest` to mock
 * `globalThis.tailor.workflow.wait/resolve` in tests.
 * @param initialKey - Initial key (can be updated via the returned setter)
 * @returns The instance and a setter to update the key after construction
 */
function createWaitPointInstance(initialKey: string): WaitPointWithSetter {
  let key = initialKey;
  const invoker = createWaitPointInvoker();
  const instance = brandValue(
    asSelfReturning(createBoundWaitPoint(invoker, () => key)),
    "wait-point",
  ) as InternalWaitPointInstance;
  attachWaitPointInvoker(instance, invoker);

  return {
    instance,
    setKey: (k: string) => {
      key = k;
    },
  };
}

function createParameterizedWaitPointInstance(key: string, parsed: ParsedKey): object {
  const invoker = createWaitPointInvoker();
  const unbound = () => {
    throw new Error(
      `Wait point key "${key}" has $params, so it identifies no single suspension on its own. Bind them first: waitPoint.with({ ... }).wait(...).`,
    );
  };
  const instance = brandValue(
    asSelfReturning({
      with(params: Record<string, unknown>) {
        const composed = composeKey(key, parsed, params);
        return attachWaitPointKey(
          createBoundWaitPoint(invoker, () => composed),
          composed,
        );
      },
      wait: unbound,
      resolve: unbound,
    }),
    "wait-point",
  );
  attachWaitPointInvoker(instance, invoker);
  return instance;
}

// `NonEmptyString` keeps a bare "$" out of the param union: `string & {}` stops
// the template literal from collapsing to `string`, so "" no longer matches.
type NonEmptyString = `${string & {}}${string}`;

type KeySegments<Key extends string> = Key extends `${infer Head}-${infer Tail}`
  ? Head | KeySegments<Tail>
  : Key;

type KeySegmentList<Key extends string> = Key extends `${infer Head}-${infer Tail}`
  ? [Head, ...KeySegmentList<Tail>]
  : [Key];

type ParamSegments<Key extends string> = Extract<KeySegments<Key>, `$${NonEmptyString}`>;

// Stripping the sigil in its own distributive alias matters: feeding `never`
// into a `${infer Name}` conditional widens Name to `string`, which would turn
// a param-less key into an index signature instead of `never`.
type ParamName<Segment extends string> = Segment extends `$${infer Name}` ? Name : never;

type KeyParams<Key extends string> = [ParamSegments<Key>] extends [never]
  ? undefined
  : Prettify<{ [Name in ParamName<ParamSegments<Key>>]: string }>;

type HasLiteralSegment<Segments extends readonly string[]> = Segments extends readonly [
  infer Head extends string,
  ...infer Tail extends readonly string[],
]
  ? Head extends `$${string}`
    ? HasLiteralSegment<Tail>
    : true
  : false;

type HasDuplicateParam<Segments extends readonly string[]> = Segments extends readonly [
  infer Head extends string,
  ...infer Tail extends readonly string[],
]
  ? Head extends `$${string}`
    ? Head extends Tail[number]
      ? true
      : HasDuplicateParam<Tail>
    : HasDuplicateParam<Tail>
  : false;

/**
 * Resolves to `Instance` when both `Payload` and `Result` are JsonValue-compatible,
 * or to a type-level error that surfaces at the call site.
 */
type ValidatedWaitPoint<Payload, Result, Instance> = [null] extends [Payload]
  ? TypeLevelError<"Payload cannot be null at the top level">
  : [undefined] extends [Result]
    ? TypeLevelError<"Result cannot be (or include) undefined (resolve callback must return a value)">
    : [Payload] extends [undefined]
      ? [Result] extends [JsonCompatible<Result>]
        ? Instance
        : TypeLevelError<"Result must be JsonValue-compatible (plain objects/arrays; no class instances or functions)">
      : [undefined] extends [Payload]
        ? TypeLevelError<"Payload cannot include undefined at the top level">
        : [Payload] extends [JsonCompatible<Payload>]
          ? [Result] extends [JsonCompatible<Result>]
            ? Instance
            : TypeLevelError<"Result must be JsonValue-compatible (plain objects/arrays; no class instances or functions)">
          : TypeLevelError<"Payload must be JsonValue-compatible (plain objects/arrays; no class instances or functions)">;

/**
 * The type produced by `define<Payload, Result>()` (the no-key form inside `createWaitPoints`).
 */
type WaitPointDef<Payload, Result> = ValidatedWaitPoint<
  Payload,
  Result,
  WaitPointInstance<Payload, Result>
>;

/**
 * The type produced by `define(key)<Payload, Result>()`. Keys containing
 * `$params` resolve to a {@link ParameterizedWaitPointInstance}; plain keys
 * resolve to a {@link WaitPointInstance}, so the same call shape covers both.
 */
type WaitPointKeyDef<Key extends string, Payload, Result> = string extends Key
  ? TypeLevelError<"Wait point key must be a string literal">
  : HasDuplicateParam<KeySegmentList<Key>> extends true
    ? TypeLevelError<"Wait point key repeats a $param name">
    : HasLiteralSegment<KeySegmentList<Key>> extends false
      ? TypeLevelError<"Wait point key needs at least one literal segment alongside its $params">
      : [KeyParams<Key>] extends [undefined]
        ? ValidatedWaitPoint<Payload, Result, WaitPointInstance<Payload, Result>>
        : KeyParams<Key> extends infer Params extends object
          ? ValidatedWaitPoint<
              Payload,
              Result,
              ParameterizedWaitPointInstance<Params, Payload, Result>
            >
          : never;

/**
 * The factory returned when a key is passed before the type arguments.
 * Calling it yields the wait point the key describes.
 */
type WaitPointFactory<Key extends string> = <
  Payload = undefined,
  Result = undefined,
>() => WaitPointKeyDef<Key, Payload, Result>;

/**
 * The `define` function passed to the `createWaitPoints` builder callback.
 *
 * Called with no arguments, the property name becomes the key. Called with a
 * key, that key is used verbatim — and any `$params` in it become the argument
 * of `.with()`. The key comes first so TypeScript can infer it as a literal;
 * `Payload` / `Result` follow on the returned factory.
 *
 * JSON validation is encoded in the return type rather than in type-parameter
 * constraints, because tsgo rejects self-referential constraints like
 * `Payload extends JsonCompatible<Payload>` as circular.
 */
type DefineFn = {
  <const Key extends string>(key: Key): WaitPointFactory<Key>;
  <Payload = undefined, Result = undefined>(): WaitPointDef<Payload, Result>;
};

function createKeyedWaitPoint(key: string): unknown {
  const parsed = validateKey(key);
  return parsed.paramNames.length > 0
    ? createParameterizedWaitPointInstance(key, parsed)
    : createWaitPointInstance(key).instance;
}

/**
 * Create a single typed wait point with a fixed key.
 *
 * The key must match `[a-z0-9-]` (3-63 characters, starting and ending with
 * `[a-z0-9]`). For a key with `$params`, use {@link createWaitPoints}: binding
 * params needs the key inferred as a literal type, which only its `define`
 * offers.
 *
 * `Payload` and `Result` must be JsonValue-compatible.
 * Functions and objects with a `toJSON` method are rejected at the type level;
 * class instances exposing methods are rejected via the property walk.
 * @param key - The wait point key used to match wait and resolve calls
 * @returns A WaitPointInstance with typed `.wait()` and `.resolve()` methods
 * @throws If the key does not match the wait point key grammar, or carries `$params`
 * @example
 * export const approval = createWaitPoint<{ message: string }, { approved: boolean }>("approval");
 *
 * await approval.wait({ message: "Please approve" });
 */
/* @__NO_SIDE_EFFECTS__ */
export function createWaitPoint<Payload = undefined, Result = undefined>(
  key: string,
): WaitPointDef<Payload, Result> {
  const parsed = validateKey(key);
  if (parsed.paramNames.length > 0) {
    throw new Error(
      `Invalid wait point key "${key}": createWaitPoint takes its type arguments first, which stops TypeScript inferring the key as a literal, so it cannot type the $params. Declare it through createWaitPoints instead: createWaitPoints((define) => ({ myWaitPoint: define("${key}")<Payload, Result>() })).`,
    );
  }
  return createWaitPointInstance(key).instance as unknown as WaitPointDef<Payload, Result>;
}

/**
 * Create a group of typed wait points for human-in-the-loop workflows.
 * Property names become the wait point keys, so they must match
 * `[a-z0-9-]` — pass an explicit key to `define` when they do not.
 *
 * The return type is the same as the builder's return type, so JSDoc on each
 * property is preserved and visible in IDE autocompletion.
 *
 * `Payload` and `Result` must be JsonValue-compatible.
 * Functions and objects with a `toJSON` method are rejected at the type level;
 * class instances exposing methods are rejected via the property walk.
 * @param builder - Callback that receives a `define` factory and returns an object of wait points
 * @returns The same object returned by the builder (with correct keys set on each instance)
 * @throws If a property name or explicit key does not match the wait point key grammar
 * @example
 * export const waitPoints = createWaitPoints(define => ({
 *   // Preceding JSDoc on this property is shown in IDE autocompletion
 *   approval: define<{ message: string }, { approved: boolean }>(),
 *   // A key with $params is bound per call through `.with()`
 *   lineApproval: define("line-approval-$lineId")<{ message: string }, { approved: boolean }>(),
 * }));
 *
 * await waitPoints.approval.wait({ message: "Please approve" });
 * await waitPoints.lineApproval.with({ lineId: line.id }).wait({ message: "Please approve" });
 *
 * // For 2-level access, use destructured export with JSDoc attached to the export itself.
 */
/* @__NO_SIDE_EFFECTS__ */
/* oxlint-disable no-explicit-any -- constraint needs `any` for assignability */
export function createWaitPoints<
  T extends Record<
    string,
    WaitPointInstance<any, any> | ParameterizedWaitPointInstance<any, any, any>
  >,
>(builder: (define: DefineFn) => T): T {
  /* oxlint-enable no-explicit-any */
  const setters = new Map<object, (key: string) => void>();

  const define = ((key?: string) => {
    if (key === undefined) {
      const { instance, setKey } = createWaitPointInstance("__pending__");
      setters.set(instance, setKey);
      return instance;
    }
    return createKeyedWaitPoint(key);
  }) as DefineFn;

  const result = builder(define);

  for (const propName of Object.keys(result)) {
    const setter = setters.get(result[propName] as unknown as object);
    if (!setter) continue;
    const parsed = validateKey(propName);
    if (parsed.paramNames.length > 0) {
      throw new Error(
        `Invalid wait point key "${propName}": $params cannot come from a property name. Pass the key to define instead, e.g. define("${propName}")<Payload, Result>().`,
      );
    }
    setter(propName);
  }

  return result;
}
