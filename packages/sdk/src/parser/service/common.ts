import {
  RESOURCE_NAME_PATTERN,
  RESOURCE_NAME_PATTERN_SOURCE,
} from "@tailor-platform/shared/resource-name";
import { z } from "zod";

// Use `z.custom` instead of `z.function`, since `z.function` changes `toString` representation.
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const functionSchema: z.ZodType<Function, Function> = z.custom<Function>(
  (val) => typeof val === "function",
);

/**
 * Drop the entries of a record whose value is `null` or `undefined`.
 * @param record - Record to filter
 * @returns The record without those entries
 */
export function omitNullishValues<V>(
  record: Record<string, V | null | undefined>,
): Record<string, V> {
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, V] => entry[1] != null),
  );
}

export const resourceNameSchema = z
  .string()
  .regex(
    RESOURCE_NAME_PATTERN,
    "must be 3-63 lowercase letters, digits, or hyphens, starting and ending with a letter or digit",
  );

export const STATIC_WEBSITE_ORIGIN_PLACEHOLDER_PATTERN = new RegExp(
  `^${RESOURCE_NAME_PATTERN_SOURCE}:url$`,
);
