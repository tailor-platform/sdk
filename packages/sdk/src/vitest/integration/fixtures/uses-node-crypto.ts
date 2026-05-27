import { randomUUID } from "node:crypto";

/**
 * Generate a unique ID using node:crypto (should be blocked by tailor-runtime).
 * @returns UUID string
 */
export function generateId(): string {
  return randomUUID();
}
