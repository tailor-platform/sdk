export function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(clonePlain) as T;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.keys(value).reduce<Record<string, unknown>>(
      (copy, key) => {
        copy[key] = clonePlain((value as Record<string, unknown>)[key]);
        return copy;
      },
      Object.create(Object.getPrototypeOf(value)),
    ) as T;
  }
  return value;
}
