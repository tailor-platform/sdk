/**
 * Generate a unique ID using Web Crypto API (should work in tailor-runtime).
 * @returns UUID string
 */
export function generateId(): string {
  return crypto.randomUUID();
}
