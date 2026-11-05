type TypedArrayConstructor = { from(source: ArrayLike<unknown>): ArrayBufferView };

export function cloneDeep<T>(value: T): T {
  return clone(value, new WeakMap());
}

function clone<T>(value: T, seen: WeakMap<object, unknown>): T {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (seen.has(value)) {
    return seen.get(value) as T;
  }

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    copy.length = value.length;
    seen.set(value, copy);
    value.forEach((item, index) => {
      copy[index] = clone(item, seen);
    });
    return copy as T;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }
  if (value instanceof Number || value instanceof String || value instanceof Boolean) {
    return Object.setPrototypeOf(Object(value.valueOf()), Object.getPrototypeOf(value)) as T;
  }
  if (value instanceof RegExp) {
    const copy = new RegExp(value.source, value.flags);
    copy.lastIndex = value.lastIndex;
    return copy as T;
  }
  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    value.forEach((v, k) => copy.set(k, clone(v, seen)));
    return copy as T;
  }
  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    value.forEach((v) => copy.add(clone(v, seen)));
    return copy as T;
  }
  if (value instanceof ArrayBuffer) {
    return value.slice(0) as T;
  }
  if (value instanceof DataView) {
    return new DataView(
      clone(value.buffer, seen) as ArrayBuffer,
      value.byteOffset,
      value.byteLength,
    ) as T;
  }
  if (ArrayBuffer.isView(value)) {
    return (value.constructor as unknown as TypedArrayConstructor).from(
      value as unknown as ArrayLike<unknown>,
    ) as T;
  }

  const copy = Object.create(Object.getPrototypeOf(value));
  seen.set(value, copy);
  if (value instanceof Error) {
    for (const key of ["message", "stack", "cause"] as const) {
      if (Object.hasOwn(value, key)) {
        Object.defineProperty(copy, key, {
          value: clone(value[key], seen),
          configurable: true,
          enumerable: false,
          writable: true,
        });
      }
    }
  }
  const keys: (string | symbol)[] = Object.keys(value);
  for (const symbol of Object.getOwnPropertySymbols(value)) {
    if (Object.prototype.propertyIsEnumerable.call(value, symbol)) keys.push(symbol);
  }
  for (const key of keys) {
    const cloned = clone((value as Record<string | symbol, unknown>)[key], seen);
    if (key === "__proto__") {
      Object.defineProperty(copy, key, {
        value: cloned,
        configurable: true,
        enumerable: true,
        writable: true,
      });
    } else {
      copy[key] = cloned;
    }
  }
  return copy;
}
