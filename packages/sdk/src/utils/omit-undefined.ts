type Opaque =
  | bigint
  | Date
  | Uint8Array
  | RegExp
  | Error
  | AbortSignal
  | Promise<unknown>
  | ReadonlyMap<unknown, unknown>
  | ReadonlySet<unknown>
  | ((...args: never[]) => unknown);

type DeepOmitUndefined<T> = T extends Opaque
  ? T
  : T extends readonly (infer U)[]
    ? DeepOmitUndefined<U>[]
    : T extends object
      ? OmitUndefined<T>
      : T;

type OmitUndefined<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: DeepOmitUndefined<T[K]>;
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: DeepOmitUndefined<
    Exclude<T[K], undefined>
  >;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function omitUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitUndefinedDeep);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, omitUndefinedDeep(entry)]),
  );
}

export function omitUndefined<T extends object>(value: T): OmitUndefined<T> {
  return omitUndefinedDeep(value) as OmitUndefined<T>;
}
