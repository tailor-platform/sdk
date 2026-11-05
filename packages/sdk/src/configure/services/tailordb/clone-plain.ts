export function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(clonePlain) as T;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }
  if (typeof value === "object" && value !== null) {
    const copy = Object.create(Object.getPrototypeOf(value));
    for (const [k, v] of Object.entries(value)) {
      copy[k] = clonePlain(v);
    }
    return copy;
  }
  return value;
}
