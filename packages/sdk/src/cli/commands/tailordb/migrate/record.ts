/**
 * Define a record entry as an own data property so special keys do not invoke inherited setters.
 * @param record - Record to update
 * @param key - Entry key
 * @param value - Entry value
 */
export function defineRecordEntry<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
