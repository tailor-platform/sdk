export function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(clonePlain) as T;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clonePlain(v)])) as T;
  }
  return value;
}
