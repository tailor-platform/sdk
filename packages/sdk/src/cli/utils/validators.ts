import { z } from "zod";

/**
 * Check if a string is a valid UUID
 */
export function isUUID(value: string): boolean {
  return z.uuid().safeParse(value).success;
}
